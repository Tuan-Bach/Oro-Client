use std::collections::{HashMap, HashSet, VecDeque};
use crate::db::CoworkerTask;

#[derive(Debug, PartialEq, Eq)]
pub enum DagError {
    CycleDetected(Vec<String>),
    MissingDependency { task_id: String, dep_id: String },
    SelfDependency(String),
}

impl std::fmt::Display for DagError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DagError::CycleDetected(path) => {
                write!(f, "Cycle detected in task DAG: {}", path.join(" -> "))
            }
            DagError::MissingDependency { task_id, dep_id } => {
                write!(
                    f,
                    "Task '{}' depends on non-existent task '{}'",
                    task_id, dep_id
                )
            }
            DagError::SelfDependency(id) => {
                write!(f, "Task '{}' depends on itself", id)
            }
        }
    }
}

impl std::error::Error for DagError {}

pub struct TaskDag;

impl TaskDag {
    /// Validates that the provided tasks form a valid Directed Acyclic Graph (DAG).
    /// Returns Ok(()) if no cycles or invalid dependencies exist.
    pub fn validate(tasks: &[CoworkerTask]) -> Result<(), DagError> {
        let task_map: HashMap<&str, &CoworkerTask> =
            tasks.iter().map(|t| (t.id.as_str(), t)).collect();

        // 1. Check for missing or self dependencies
        for task in tasks {
            for dep in &task.dependencies {
                if dep == &task.id {
                    return Err(DagError::SelfDependency(task.id.clone()));
                }
                if !task_map.contains_key(dep.as_str()) {
                    return Err(DagError::MissingDependency {
                        task_id: task.id.clone(),
                        dep_id: dep.clone(),
                    });
                }
            }
        }

        // 2. DFS-based Cycle Detection using 3-color marking (0=unvisited, 1=visiting, 2=visited)
        let mut state: HashMap<&str, u8> = HashMap::new();
        let mut path: Vec<String> = Vec::new();

        for task in tasks {
            if state.get(task.id.as_str()).copied().unwrap_or(0) == 0
                && let Some(cycle) = Self::dfs_cycle(task.id.as_str(), &task_map, &mut state, &mut path) {
                    return Err(DagError::CycleDetected(cycle));
                }
        }

        Ok(())
    }

    fn dfs_cycle<'a>(
        curr: &'a str,
        task_map: &HashMap<&'a str, &'a CoworkerTask>,
        state: &mut HashMap<&'a str, u8>,
        path: &mut Vec<String>,
    ) -> Option<Vec<String>> {
        state.insert(curr, 1); // visiting
        path.push(curr.to_string());

        if let Some(task) = task_map.get(curr) {
            for dep in &task.dependencies {
                let dep_str = dep.as_str();
                let dep_state = state.get(dep_str).copied().unwrap_or(0);
                if dep_state == 1 {
                    // Found cycle! Extract cycle path
                    let mut cycle = Vec::new();
                    let mut found = false;
                    for p in path.iter() {
                        if p == dep_str {
                            found = true;
                        }
                        if found {
                            cycle.push(p.clone());
                        }
                    }
                    cycle.push(dep_str.to_string());
                    return Some(cycle);
                } else if dep_state == 0
                    && let Some(c) = Self::dfs_cycle(dep_str, task_map, state, path) {
                        return Some(c);
                    }
            }
        }

        path.pop();
        state.insert(curr, 2); // visited
        None
    }

    /// Computes all tasks ready for execution:
    /// Status must be 'pending', and all dependencies must have status 'done'.
    pub fn compute_ready_tasks(tasks: &[CoworkerTask]) -> Vec<&CoworkerTask> {
        let task_map: HashMap<&str, &CoworkerTask> =
            tasks.iter().map(|t| (t.id.as_str(), t)).collect();

        let mut ready = Vec::new();

        for task in tasks {
            if task.status != "pending" {
                continue;
            }

            let all_deps_done = task.dependencies.iter().all(|dep_id| {
                task_map
                    .get(dep_id.as_str())
                    .map(|d| d.status == "done")
                    .unwrap_or(false)
            });

            if all_deps_done {
                ready.push(task);
            }
        }

        // Stable sort: prioritize fast tasks first, then by creation time
        ready.sort_by(|a, b| {
            let tier_weight = |tier: &str| match tier {
                "fast" => 0,
                "standard" => 1,
                "reasoning" => 2,
                _ => 3,
            };
            let weight_cmp = tier_weight(&a.model_tier).cmp(&tier_weight(&b.model_tier));
            if weight_cmp == std::cmp::Ordering::Equal {
                a.created_at.cmp(&b.created_at)
            } else {
                weight_cmp
            }
        });

        ready
    }

    /// Computes the transitive closure of dependents when a task is rejected or fails.
    /// All returned task IDs should be marked 'skipped' (independent branches remain unaffected).
    pub fn cascade_skip_dependents(tasks: &[CoworkerTask], failed_task_id: &str) -> Vec<String> {
        // Build reverse dependency graph (parent -> list of children)
        let mut dependents_map: HashMap<&str, Vec<&str>> = HashMap::new();
        for task in tasks {
            for dep in &task.dependencies {
                dependents_map
                    .entry(dep.as_str())
                    .or_default()
                    .push(task.id.as_str());
            }
        }

        let mut skipped_ids = Vec::new();
        let mut visited = HashSet::new();
        let mut queue = VecDeque::new();

        queue.push_back(failed_task_id);

        while let Some(current) = queue.pop_front() {
            if let Some(children) = dependents_map.get(current) {
                for &child_id in children {
                    if visited.insert(child_id) {
                        skipped_ids.push(child_id.to_string());
                        queue.push_back(child_id);
                    }
                }
            }
        }

        skipped_ids
    }
}
