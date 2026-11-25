use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use crate::dag::TaskDag;
use crate::db::CoworkerStore;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShiftState {
    AtDesk,
    SteppingAway,
    Draining,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SchedulerSnapshot {
    pub shift: ShiftState,
    pub active_task_id: Option<String>,
    pub pending_tasks_count: usize,
    pub waiting_approvals_count: usize,
    pub completed_tasks_count: usize,
    pub total_tasks_count: usize,
}

pub struct SafetyGate;

impl SafetyGate {
    /// Determines whether an action requires human approval before execution.
    pub fn is_gated(action_type: &str, payload_json: &str) -> bool {
        match action_type {
            "delete_file" | "git_push" | "destructive_edit" => true,
            "shell_exec" => {
                // Parse payload command if possible
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(payload_json)
                    && let Some(cmd) = val.get("command").and_then(|c| c.as_str()) {
                        let trimmed = cmd.trim();
                        // Whitelist read-only commands
                        if trimmed == "git status"
                            || trimmed == "git diff"
                            || trimmed == "git log"
                            || trimmed.starts_with("node -v")
                            || trimmed.starts_with("npm -v")
                            || trimmed.starts_with("cargo --version")
                        {
                            return false;
                        }
                    }
                true
            }
            _ => false,
        }
    }
}

pub struct CoworkerScheduler {
    store: Arc<Mutex<CoworkerStore>>,
    shift: Arc<Mutex<ShiftState>>,
    active_task: Arc<Mutex<Option<String>>>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SchedulerDecision {
    Idle,
    DispatchedTask { task_id: String, title: String },
    ParkedForApproval { task_id: String, approval_id: String },
    WorkStolen { previous_task_id: String, next_task_id: String },
    GoalCompleted { goal_id: String },
}

impl CoworkerScheduler {
    pub fn new(store: Arc<Mutex<CoworkerStore>>) -> Self {
        Self {
            store,
            shift: Arc::new(Mutex::new(ShiftState::AtDesk)),
            active_task: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set_shift(&self, new_shift: ShiftState) {
        let mut s = self.shift.lock().unwrap();
        *s = new_shift;
    }

    pub fn get_shift(&self) -> ShiftState {
        *self.shift.lock().unwrap()
    }

    pub fn get_active_task_id(&self) -> Option<String> {
        self.active_task.lock().unwrap().clone()
    }

    /// Evaluates a single scheduler cycle:
    /// 1. Verifies if SteppingAway is active.
    /// 2. Queries active goal and tasks.
    /// 3. Computes ready tasks using DAG engine.
    /// 4. Executes work-stealing if a task is waiting for approval.
    pub fn tick(&self) -> Result<SchedulerDecision, Box<dyn std::error::Error>> {
        let current_shift = self.get_shift();
        if current_shift != ShiftState::SteppingAway {
            return Ok(SchedulerDecision::Idle);
        }

        let store = self.store.lock().unwrap();
        let active_goal = match store.get_active_goal()? {
            Some(g) => g,
            None => return Ok(SchedulerDecision::Idle),
        };

        let tasks = store.list_tasks(&active_goal.id)?;
        if tasks.is_empty() {
            return Ok(SchedulerDecision::Idle);
        }

        // Check if all tasks in goal are finished
        let all_done = tasks
            .iter()
            .all(|t| t.status == "done" || t.status == "skipped");
        if all_done {
            store.update_goal_status(&active_goal.id, "completed")?;
            return Ok(SchedulerDecision::GoalCompleted {
                goal_id: active_goal.id,
            });
        }

        // Compute ready tasks
        let ready_tasks = TaskDag::compute_ready_tasks(&tasks);
        if ready_tasks.is_empty() {
            return Ok(SchedulerDecision::Idle);
        }

        // Select next unblocked ready task (work-stealing)
        let candidate = ready_tasks[0];
        let task_id = candidate.id.clone();
        let title = candidate.title.clone();

        // Mark in progress
        store.update_task_status(&task_id, "in_progress", None, None)?;
        drop(store);

        let mut active = self.active_task.lock().unwrap();
        *active = Some(task_id.clone());

        Ok(SchedulerDecision::DispatchedTask { task_id, title })
    }

    /// Simulates interception of a gated action during execution of active task.
    /// Parks active task into 'waiting_approval' and immediately work-steals next ready task.
    pub fn intercept_gated_action(
        &self,
        task_id: &str,
        action_type: &str,
        title: &str,
        payload_json: &str,
    ) -> Result<SchedulerDecision, Box<dyn std::error::Error>> {
        let store = self.store.lock().unwrap();
        let task = store
            .get_task(task_id)?
            .ok_or_else(|| format!("Task {} not found", task_id))?;

        if !SafetyGate::is_gated(action_type, payload_json) {
            return Ok(SchedulerDecision::Idle);
        }

        // 1. Create Approval Record
        let approval = store.create_approval(
            &task.id,
            &task.goal_id,
            action_type,
            title,
            payload_json,
        )?;

        // 2. Checkpoint and park task
        let checkpoint = serde_json::json!({
            "action_type": action_type,
            "payload": payload_json,
            "paused_at": chrono::Utc::now().timestamp_millis()
        })
        .to_string();

        store.update_task_status(
            &task.id,
            "waiting_approval",
            None,
            Some(&checkpoint),
        )?;

        // Clear active task slot
        {
            let mut active = self.active_task.lock().unwrap();
            *active = None;
        }
        drop(store);

        // 3. Work-Stealing: immediately run tick to pick next unblocked task
        match self.tick()? {
            SchedulerDecision::DispatchedTask {
                task_id: next_id, ..
            } => Ok(SchedulerDecision::WorkStolen {
                previous_task_id: task_id.to_string(),
                next_task_id: next_id,
            }),
            _ => Ok(SchedulerDecision::ParkedForApproval {
                task_id: task_id.to_string(),
                approval_id: approval.id,
            }),
        }
    }

    /// Resolves an approval:
    /// - If approved: task resumes or is marked done.
    /// - If rejected: task is marked failed, and DAG cascade skips all transitive dependents.
    pub fn resolve_approval(
        &self,
        approval_id: &str,
        approved: bool,
        note: Option<&str>,
    ) -> Result<Vec<String>, Box<dyn std::error::Error>> {
        let store = self.store.lock().unwrap();
        let approval = store
            .get_approval(approval_id)?
            .ok_or_else(|| format!("Approval {} not found", approval_id))?;

        let status = if approved { "approved" } else { "rejected" };
        store.resolve_approval(approval_id, status, note)?;

        let mut skipped_tasks = Vec::new();

        if approved {
            // Unpause task so it can be resumed
            store.update_task_status(
                &approval.task_id,
                "done",
                Some("Action approved by user and executed"),
                None,
            )?;
        } else {
            // Mark task as failed
            store.update_task_status(
                &approval.task_id,
                "failed",
                Some("Action rejected by user"),
                None,
            )?;

            // Cascade skip all dependents in this goal
            let all_tasks = store.list_tasks(&approval.goal_id)?;
            let to_skip = TaskDag::cascade_skip_dependents(&all_tasks, &approval.task_id);
            for skip_id in &to_skip {
                store.update_task_status(
                    skip_id,
                    "skipped",
                    Some("Skipped due to upstream dependency rejection"),
                    None,
                )?;
            }
            skipped_tasks = to_skip;
        }

        Ok(skipped_tasks)
    }

    /// Snapshot for UI polling / SSE stream.
    pub fn get_snapshot(&self) -> Result<SchedulerSnapshot, Box<dyn std::error::Error>> {
        let shift = self.get_shift();
        let active_task_id = self.get_active_task_id();

        let store = self.store.lock().unwrap();
        if let Some(goal) = store.get_active_goal()? {
            let tasks = store.list_tasks(&goal.id)?;
            let pending_count = tasks.iter().filter(|t| t.status == "pending").count();
            let waiting_count = tasks
                .iter()
                .filter(|t| t.status == "waiting_approval")
                .count();
            let completed_count = tasks
                .iter()
                .filter(|t| t.status == "done" || t.status == "skipped")
                .count();

            Ok(SchedulerSnapshot {
                shift,
                active_task_id,
                pending_tasks_count: pending_count,
                waiting_approvals_count: waiting_count,
                completed_tasks_count: completed_count,
                total_tasks_count: tasks.len(),
            })
        } else {
            Ok(SchedulerSnapshot {
                shift,
                active_task_id,
                pending_tasks_count: 0,
                waiting_approvals_count: 0,
                completed_tasks_count: 0,
                total_tasks_count: 0,
            })
        }
    }
}
