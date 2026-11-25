use std::sync::{Arc, Mutex};
use app_lib::dag::{DagError, TaskDag};
use app_lib::db::{CoworkerStore, CoworkerTask};
use app_lib::scheduler::{CoworkerScheduler, SafetyGate, SchedulerDecision, ShiftState};
use app_lib::vault::fs::VaultFs;
use app_lib::vault::graph::PageRank;
use app_lib::vault::indexer::VaultIndexer;
use app_lib::vault::parser::parse_markdown;

fn dummy_task(id: &str, deps: &[&str], status: &str, tier: &str) -> CoworkerTask {
    CoworkerTask {
        id: id.to_string(),
        goal_id: "goal-test".to_string(),
        title: format!("Task {}", id),
        role: "Coder".to_string(),
        model_tier: tier.to_string(),
        status: status.to_string(),
        dependencies: deps.iter().map(|s| s.to_string()).collect(),
        checkpoint_context: None,
        result_summary: None,
        created_at: 1000,
        started_at: None,
        completed_at: None,
    }
}

fn test_vault_parser() {
    println!("\n=== Running Vault Markdown Parser Tests ===");
    let sample = r#"---
title: "Second Brain Architecture"
tags: [architecture, rust, ai]
---

# Second Brain Architecture

Here is an architectural overview of [[Rust Backend|Native Core]] and [[Tauri 2.0#IPC]].
Also see #systems-design and #performance.

```rust
// Code fence: links here like [[FakeNote]] and #faketag MUST be ignored!
fn dummy() {}
```

Inline code `[[IgnoredInlineLink]]` should also be ignored.

- [ ] Implement Rust Vault engine
- [x] Scaffold Tauri 2.0
- [ ] Connect Monaco editor
"#;

    let parsed = parse_markdown("notes/architecture.md", sample);
    assert_eq!(parsed.title, "Second Brain Architecture");
    assert_eq!(parsed.tags, vec!["ai", "architecture", "performance", "rust", "systems-design"]);

    // Wiki links: should extract 2 links (FakeNote and IgnoredInlineLink skipped)
    assert_eq!(parsed.links.len(), 2);
    assert_eq!(parsed.links[0].target, "Rust Backend");
    assert_eq!(parsed.links[0].alias.as_deref(), Some("Native Core"));
    assert_eq!(parsed.links[1].target, "Tauri 2.0");

    // Headings
    assert_eq!(parsed.headings.len(), 1);
    assert_eq!(parsed.headings[0].text, "Second Brain Architecture");
    assert_eq!(parsed.headings[0].level, 1);

    // Tasks: 2 open, 1 done
    assert_eq!(parsed.tasks.len(), 3);
    assert!(!parsed.tasks[0].done);
    assert_eq!(parsed.tasks[0].text, "Implement Rust Vault engine");
    assert!(parsed.tasks[1].done);
    assert!(!parsed.tasks[2].done);

    println!("  [PASS] Frontmatter, headings, tasks, wiki-links, and tags parsed cleanly");
}

fn test_vault_graph_pagerank() {
    println!("\n=== Running PageRank & Knowledge Graph Tests ===");
    // Star topology: D -> A, E -> A, F -> A, plus cycle A -> B -> C -> A
    let node_ids = vec![
        "A.md".to_string(),
        "B.md".to_string(),
        "C.md".to_string(),
        "D.md".to_string(),
        "E.md".to_string(),
        "F.md".to_string(),
    ];

    let edges = vec![
        ("D.md".to_string(), "A.md".to_string()),
        ("E.md".to_string(), "A.md".to_string()),
        ("F.md".to_string(), "A.md".to_string()),
        ("A.md".to_string(), "B.md".to_string()),
        ("B.md".to_string(), "C.md".to_string()),
        ("C.md".to_string(), "A.md".to_string()),
    ];

    let ranks = PageRank::compute(&node_ids, &edges);
    assert_eq!(ranks.len(), 6);

    let rank_a = ranks["A.md"];
    let rank_d = ranks["D.md"];
    println!("  [PASS] PageRank computed: Rank(A) = {:.4}, Rank(D) = {:.4}", rank_a, rank_d);
    // Node A has the most incoming links, so its PageRank must be strictly greater than leaf D
    assert!(rank_a > rank_d);
}

fn test_vault_fs_and_link_refactoring() {
    println!("\n=== Running Vault FS Manager & Link Refactoring Tests ===");
    let tmp_dir = std::env::temp_dir().join(format!("oro_vault_test_{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&tmp_dir).unwrap();

    // 1. Path escape validation
    assert!(VaultFs::resolve_safe_path(&tmp_dir, "../outside.txt").is_err());
    assert!(VaultFs::resolve_safe_path(&tmp_dir, "valid/note.md").is_ok());
    println!("  [PASS] Path escape attempts correctly rejected");

    // 2. Write and Read
    let write_res = VaultFs::write_file(&tmp_dir, "notes/Alpha.md", "# Alpha\nPoints to [[Beta]].\n").unwrap();
    assert_eq!(write_res.action, "created");
    VaultFs::write_file(&tmp_dir, "notes/Beta.md", "# Beta\nTarget note.\n").unwrap();

    let read_res = VaultFs::read_file(&tmp_dir, "notes/Alpha.md").unwrap();
    assert!(read_res.content.contains("[[Beta]]"));

    // 3. Tree hierarchy
    let tree = VaultFs::get_tree(&tmp_dir, None).unwrap();
    assert_eq!(tree.len(), 1);
    assert_eq!(tree[0].name, "notes");
    assert_eq!(tree[0].children.as_ref().unwrap().len(), 2);
    println!("  [PASS] Directory tree navigation verified");

    // 4. Move & Automatic Wiki-Link Refactoring!
    // Move Beta.md to Gamma.md -> Alpha.md's [[Beta]] MUST be automatically refactored to [[Gamma]]!
    let move_res = VaultFs::move_path(&tmp_dir, "notes/Beta.md", "notes/Gamma.md").unwrap();
    assert_eq!(move_res.updated_links_in, vec!["notes/Alpha.md".to_string()]);

    let alpha_after = VaultFs::read_file(&tmp_dir, "notes/Alpha.md").unwrap();
    assert!(alpha_after.content.contains("[[Gamma]]"));
    assert!(!alpha_after.content.contains("[[Beta]]"));
    println!("  [PASS] Wiki-link refactoring succeeded: [[Beta]] -> [[Gamma]] in referencing files");

    // 5. Soft-delete to .trash
    let trash_path = VaultFs::delete_path(&tmp_dir, "notes/Gamma.md").unwrap();
    assert!(trash_path.starts_with(".trash/"));
    assert!(!tmp_dir.join("notes/Gamma.md").exists());
    println!("  [PASS] Soft-delete to .trash confirmed");

    let _ = std::fs::remove_dir_all(&tmp_dir);
}

fn test_vault_indexing_and_fts5() {
    println!("\n=== Running Vault Indexing & FTS5 Search Tests ===");
    let tmp_dir = std::env::temp_dir().join(format!("oro_vault_fts_{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&tmp_dir).unwrap();

    // Create 3 notes
    VaultFs::write_file(
        &tmp_dir,
        "notes/Rust.md",
        "# Rust Language\nFast, memory-safe systems language with zero-cost abstractions.\nSee [[Tauri]].\n#systems",
    ).unwrap();

    VaultFs::write_file(
        &tmp_dir,
        "notes/Tauri.md",
        "# Tauri Framework\nBuild smaller, faster, and more secure desktop applications with a web frontend.\n#gui",
    ).unwrap();

    VaultFs::write_file(
        &tmp_dir,
        "notes/Oro.md",
        "# Oro Assistant\nAutonomous co-worker and second brain written in [[Rust]] using [[Tauri]].\n#ai",
    ).unwrap();

    let store = CoworkerStore::open_in_memory().unwrap();

    // Run Indexer
    let stats = VaultIndexer::index_all(&tmp_dir, &store).unwrap();
    assert_eq!(stats.notes_count, 3);
    assert_eq!(stats.links_count, 3);
    assert_eq!(stats.broken_links_count, 0); // All links resolved!
    assert_eq!(stats.tags_count, 3);
    println!("  [PASS] Vault indexed: 3 notes, 3 links (0 broken), 3 tags");

    // Backlinks for Tauri.md (linked from Rust.md and Oro.md)
    let backlinks = store.get_backlinks("notes/Tauri.md").unwrap();
    assert_eq!(backlinks.backlinks.len(), 2);
    let sources: Vec<String> = backlinks.backlinks.iter().map(|b| b.source_path.clone()).collect();
    assert!(sources.contains(&"notes/Rust.md".to_string()));
    assert!(sources.contains(&"notes/Oro.md".to_string()));
    println!("  [PASS] Backlinks query matches: Tauri has 2 incoming backlinks");

    // FTS5 Full-Text Search
    let hits = store.search_vault("abstractions").unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].path, "notes/Rust.md");
    assert!(hits[0].snippet.contains("<b>abstractions</b>"));
    println!("  [PASS] FTS5 search found 'abstractions' in Rust.md with highlighted snippet");

    // Knowledge Graph PageRank
    let kg = store.get_knowledge_graph().unwrap();
    assert_eq!(kg.nodes.len(), 3);
    assert_eq!(kg.edges.len(), 3);
    println!("  [PASS] Knowledge graph generated: 3 nodes with PageRank scores and 3 edges");

    let _ = std::fs::remove_dir_all(&tmp_dir);
}

fn test_safety_gate() {
    println!("\n=== Running Safety Gate Tests ===");
    assert!(SafetyGate::is_gated("delete_file", r#"{"path":"src/foo.ts"}"#));
    assert!(SafetyGate::is_gated("git_push", r#"{}"#));
    assert!(SafetyGate::is_gated(
        "shell_exec",
        r#"{"command":"rm -rf node_modules"}"#
    ));
    assert!(SafetyGate::is_gated("shell_exec", r#"{"command":"npm test"}"#));

    assert!(!SafetyGate::is_gated(
        "shell_exec",
        r#"{"command":"git status"}"#
    ));
    assert!(!SafetyGate::is_gated(
        "shell_exec",
        r#"{"command":"git diff"}"#
    ));
    assert!(!SafetyGate::is_gated("read_file", r#"{"path":"src/lib.rs"}"#));
    println!("  [PASS] SafetyGate correctly classifies gated vs whitelisted actions");
}

fn test_work_stealing_scheduler() {
    println!("\n=== Running Work-Stealing Scheduler Tests ===");
    let store = Arc::new(Mutex::new(CoworkerStore::open_in_memory().unwrap()));
    let scheduler = CoworkerScheduler::new(store.clone());

    assert_eq!(scheduler.get_shift(), ShiftState::AtDesk);
    let decision = scheduler.tick().unwrap();
    assert_eq!(decision, SchedulerDecision::Idle);
    println!("  [PASS] Scheduler remains Idle when ShiftState::AtDesk");

    let (goal_id, task_a_id, task_b_id, task_c_id) = {
        let s = store.lock().unwrap();
        let g = s.create_goal("Refactor Auth Subsystem", None, None).unwrap();
        let ta = s
            .create_task(&g.id, "Branch 1: Audit Tokens", "Scout", "fast", &[])
            .unwrap();
        let tb = s
            .create_task(&g.id, "Branch 1: Rewrite Auth", "Coder", "standard", std::slice::from_ref(&ta.id))
            .unwrap();
        let tc = s
            .create_task(&g.id, "Branch 2: Update Doc", "Writer", "fast", &[])
            .unwrap();
        (g.id, ta.id, tb.id, tc.id)
    };

    scheduler.set_shift(ShiftState::SteppingAway);
    assert_eq!(scheduler.get_shift(), ShiftState::SteppingAway);

    let decision1 = scheduler.tick().unwrap();
    match &decision1 {
        SchedulerDecision::DispatchedTask { task_id, .. } => {
            println!("  [PASS] Tick 1 dispatched ready task: {}", task_id);
            assert_eq!(task_id, &task_a_id);
        }
        other => panic!("Unexpected decision 1: {:?}", other),
    }

    let intercept = scheduler
        .intercept_gated_action(
            &task_a_id,
            "delete_file",
            "Delete deprecated auth.js",
            r#"{"path":"src/auth.js"}"#,
        )
        .unwrap();

    match &intercept {
        SchedulerDecision::WorkStolen {
            previous_task_id,
            next_task_id,
        } => {
            println!(
                "  [PASS] Work-Stealing successfully intercepted Task A ({}) and stole Task C ({})!",
                previous_task_id, next_task_id
            );
            assert_eq!(previous_task_id, &task_a_id);
            assert_eq!(next_task_id, &task_c_id);
        }
        other => panic!("Expected WorkStolen, got {:?}", other),
    }

    {
        let s = store.lock().unwrap();
        let ta = s.get_task(&task_a_id).unwrap().unwrap();
        assert_eq!(ta.status, "waiting_approval");
        assert!(ta.checkpoint_context.is_some());

        let pending_apprs = s.list_pending_approvals(Some(&goal_id)).unwrap();
        assert_eq!(pending_apprs.len(), 1);
        println!("  [PASS] Task A status is 'waiting_approval' with checkpoint and approval record");
    }

    {
        let s = store.lock().unwrap();
        s.update_task_status(&task_c_id, "done", Some("Documentation updated"), None)
            .unwrap();
    }

    let approval_id = {
        let s = store.lock().unwrap();
        s.list_pending_approvals(Some(&goal_id)).unwrap()[0]
            .id
            .clone()
    };

    let skipped = scheduler
        .resolve_approval(&approval_id, false, Some("Do not delete auth.js yet"))
        .unwrap();
    println!("  [PASS] Approval resolved with REJECT. Skipped dependents: {:?}", skipped);
    assert_eq!(skipped, vec![task_b_id.clone()]);

    {
        let s = store.lock().unwrap();
        let ta = s.get_task(&task_a_id).unwrap().unwrap();
        assert_eq!(ta.status, "failed");

        let tb = s.get_task(&task_b_id).unwrap().unwrap();
        assert_eq!(tb.status, "skipped");

        let tc = s.get_task(&task_c_id).unwrap().unwrap();
        assert_eq!(tc.status, "done");
    }

    let snap = scheduler.get_snapshot().unwrap();
    assert_eq!(snap.shift, ShiftState::SteppingAway);
    assert_eq!(snap.waiting_approvals_count, 0);
    assert_eq!(snap.completed_tasks_count, 2);
    println!("  [PASS] Snapshot metrics verified cleanly");
}

fn test_dag_engine() {
    println!("\n=== Running Task DAG Engine Tests ===");
    let tasks = vec![
        dummy_task("A", &[], "pending", "fast"),
        dummy_task("B", &["A"], "pending", "standard"),
        dummy_task("C", &["A"], "pending", "fast"),
        dummy_task("D", &["B", "C"], "pending", "reasoning"),
    ];
    assert!(TaskDag::validate(&tasks).is_ok());
    println!("  [PASS] Valid diamond DAG validated successfully");

    let cyclic_tasks = vec![
        dummy_task("A", &["C"], "pending", "fast"),
        dummy_task("B", &["A"], "pending", "standard"),
        dummy_task("C", &["B"], "pending", "fast"),
    ];
    match TaskDag::validate(&cyclic_tasks) {
        Err(DagError::CycleDetected(cycle)) => {
            println!("  [PASS] Cycle detected correctly: {:?}", cycle);
            assert!(cycle.contains(&"A".to_string()));
        }
        other => panic!("Expected CycleDetected error, got {:?}", other),
    }

    let self_dep_tasks = vec![dummy_task("X", &["X"], "pending", "fast")];
    assert_eq!(
        TaskDag::validate(&self_dep_tasks),
        Err(DagError::SelfDependency("X".to_string()))
    );
    println!("  [PASS] Self dependency caught: X -> X");

    let missing_dep_tasks = vec![dummy_task("M", &["GHOST"], "pending", "fast")];
    assert_eq!(
        TaskDag::validate(&missing_dep_tasks),
        Err(DagError::MissingDependency {
            task_id: "M".to_string(),
            dep_id: "GHOST".to_string(),
        })
    );
    println!("  [PASS] Missing dependency caught: M -> GHOST");

    let ready1 = TaskDag::compute_ready_tasks(&tasks);
    assert_eq!(ready1.len(), 1);
    assert_eq!(ready1[0].id, "A");
    println!("  [PASS] Initial ready task is root A");

    let mut tasks_step2 = tasks.clone();
    tasks_step2[0].status = "done".to_string();
    let ready2 = TaskDag::compute_ready_tasks(&tasks_step2);
    assert_eq!(ready2.len(), 2);
    assert_eq!(ready2[0].id, "C");
    assert_eq!(ready2[1].id, "B");
    println!("  [PASS] Post-A ready tasks [C (fast), B (standard)] priority sorted");

    tasks_step2[1].status = "done".to_string();
    tasks_step2[2].status = "done".to_string();
    let ready3 = TaskDag::compute_ready_tasks(&tasks_step2);
    assert_eq!(ready3.len(), 1);
    assert_eq!(ready3[0].id, "D");
    println!("  [PASS] Post-(B,C) ready task is D");

    let cascade_tasks = vec![
        dummy_task("A", &[], "done", "fast"),
        dummy_task("B", &["A"], "failed", "standard"),
        dummy_task("C", &["A"], "done", "fast"),
        dummy_task("D", &["B", "C"], "pending", "reasoning"),
        dummy_task("E", &[], "pending", "standard"),
    ];
    let skipped = TaskDag::cascade_skip_dependents(&cascade_tasks, "B");
    assert_eq!(skipped, vec!["D".to_string()]);
    assert!(!skipped.contains(&"E".to_string()));
    assert!(!skipped.contains(&"C".to_string()));
    println!("  [PASS] Cascade skip on B correctly skips dependent D while preserving independent E");
}

fn test_store_lifecycle() {
    println!("\n=== Running Coworker Store Tests ===");
    let store = CoworkerStore::open_in_memory().expect("open memory db");

    let goal = store
        .create_goal(
            "Autonomous Leak Fix",
            Some("Refactor FTS5 memory handling"),
            Some(100_000),
        )
        .expect("create goal");
    assert_eq!(goal.title, "Autonomous Leak Fix");
    assert_eq!(goal.status, "active");
    println!("  [PASS] Goal creation: id={}", goal.id);

    let active_goal = store.get_active_goal().expect("get active").expect("should exist");
    assert_eq!(active_goal.id, goal.id);
    println!("  [PASS] Active goal query matches: id={}", active_goal.id);

    let task1 = store
        .create_task(&goal.id, "Audit FTS5 pointers", "Scout", "fast", &[])
        .expect("create task 1");
    assert_eq!(task1.dependencies.len(), 0);
    println!("  [PASS] Task 1 created: id={}", task1.id);

    let task2 = store
        .create_task(
            &goal.id,
            "Patch memory leak",
            "Coder",
            "standard",
            std::slice::from_ref(&task1.id),
        )
        .expect("create task 2");
    assert_eq!(task2.dependencies, vec![task1.id.clone()]);
    println!("  [PASS] Task 2 created with dependency on Task 1");

    let tasks = store.list_tasks(&goal.id).expect("list tasks");
    assert_eq!(tasks.len(), 2);
    println!("  [PASS] List tasks count = 2");

    store
        .update_task_status(&task1.id, "done", Some("Found 2 leaks in index.c"), None)
        .expect("update task status");
    let fetched_task1 = store.get_task(&task1.id).expect("get task").unwrap();
    assert_eq!(fetched_task1.status, "done");
    assert_eq!(
        fetched_task1.result_summary.as_deref(),
        Some("Found 2 leaks in index.c")
    );
    println!("  [PASS] Task status & summary updated to 'done'");

    let approval = store
        .create_approval(
            &task2.id,
            &goal.id,
            "shell_exec",
            "Run leak regression test",
            r#"{"command":"cargo test"}"#,
        )
        .expect("create approval");
    assert_eq!(approval.status, "pending");
    println!("  [PASS] Approval created: id={}", approval.id);

    let pending = store.list_pending_approvals(None).expect("list pending");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, approval.id);
    println!("  [PASS] Pending approvals count = 1");

    store
        .resolve_approval(&approval.id, "approved", Some("Looks safe to run"))
        .expect("resolve approval");

    let pending_after = store.list_pending_approvals(None).expect("list pending after");
    assert_eq!(pending_after.len(), 0);
    println!("  [PASS] Pending approvals resolved, remaining = 0");

    let fetched_appr = store.get_approval(&approval.id).expect("get approval").unwrap();
    assert_eq!(fetched_appr.status, "approved");
    assert_eq!(
        fetched_appr.user_response_note.as_deref(),
        Some("Looks safe to run")
    );
    println!("  [PASS] Approval status updated to 'approved' with user note");

    store.add_tokens_used(&goal.id, 4500).expect("add tokens");
    let updated_goal = store.get_goal(&goal.id).expect("get goal").unwrap();
    assert_eq!(updated_goal.tokens_used, 4500);
    println!("  [PASS] Token budget tracking: 4500 used");

    store.update_goal_status(&goal.id, "completed").expect("complete goal");
    let active_after = store.get_active_goal().expect("get active after");
    assert!(active_after.is_none());
    println!("  [PASS] Goal status updated to 'completed'");
}

fn test_sessions_and_messages() {
    println!("\n=== Running Session & Message Store Tests ===");
    let store = CoworkerStore::open_in_memory().expect("open memory db");

    let sess = store
        .create_session(Some("Project Refactor"), Some("triad"), Some("gemini"), Some("gemini-3.8-flash"))
        .expect("create session");
    assert_eq!(sess.title, "Project Refactor");
    assert_eq!(sess.mode, "triad");
    println!("  [PASS] Created session: {} ({})", sess.title, sess.id);

    let fetched = store.get_session(&sess.id).expect("get session").unwrap();
    assert_eq!(fetched.title, "Project Refactor");

    store
        .update_session(&sess.id, Some("Refactor Tauri Backend"), None, Some("Summary of work"))
        .expect("update session");
    let updated = store.get_session(&sess.id).expect("get session").unwrap();
    assert_eq!(updated.title, "Refactor Tauri Backend");
    assert_eq!(updated.summary.as_deref(), Some("Summary of work"));
    println!("  [PASS] Updated session title and summary");

    let msg1 = store
        .append_message(&sess.id, "user", "Please migrate LLM engine to native Rust", None, None, None)
        .expect("append user message");
    assert_eq!(msg1.role, "user");

    let msg2 = store
        .append_message(&sess.id, "assistant", "I will inspect the codebase and plan the modules.", None, None, None)
        .expect("append assistant message");
    assert_eq!(msg2.role, "assistant");

    let msgs = store.list_messages(&sess.id).expect("list messages");
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0].content, "Please migrate LLM engine to native Rust");
    println!("  [PASS] Persisted and retrieved 2 chat messages in chronological order");

    // Session files & pinning
    store.track_session_file(&sess.id, "src/engine.rs", "read").expect("track file");
    store.set_file_pinned(&sess.id, "src/engine.rs", true).expect("pin file");

    let files = store.list_session_files(&sess.id).expect("list session files");
    assert_eq!(files.len(), 1);
    assert!(files[0].pinned);
    assert_eq!(files[0].path, "src/engine.rs");
    println!("  [PASS] Session file tracking and pinning verified");
}

fn test_memories_and_tasks() {
    println!("\n=== Running Memory & Task Store Tests ===");
    let store = CoworkerStore::open_in_memory().expect("open memory db");

    let mem1 = store
        .save_memory(
            "User prefers Rust + Tauri 2.0 over Node.js Electron",
            Some("preference"),
            &["tech-stack".to_string(), "rust".to_string()],
            Some(5),
            None,
        )
        .expect("save memory 1");
    assert_eq!(mem1.category, "preference");
    assert_eq!(mem1.importance, 5);

    let mem2 = store
        .save_memory(
            "MinGW GNU linker requires rlib crate-type to prevent export ordinal overflow",
            Some("fact"),
            &["compiler".to_string(), "windows".to_string()],
            Some(4),
            None,
        )
        .expect("save memory 2");
    assert_eq!(mem2.category, "fact");
    println!("  [PASS] Saved 2 durable memories with tags and importance");

    let searched = store.search_memories("Tauri", Some(5)).expect("search memories");
    assert!(!searched.is_empty());
    assert!(searched[0].content.contains("Tauri 2.0"));
    println!("  [PASS] Memory search for 'Tauri' returned {} hit(s)", searched.len());

    // Task items
    let task1 = store.add_task("Complete Milestone 2 Rust LLM engine", Some("src-tauri/src/agent"), None).expect("add task");
    assert_eq!(task1.title, "Complete Milestone 2 Rust LLM engine");
    assert!(!task1.done);

    let toggled = store.toggle_task(task1.id, Some(true)).expect("toggle task").unwrap();
    assert!(toggled.done);
    println!("  [PASS] Task creation and completion toggle verified");
}

fn test_editor_drafts() {
    println!("\n=== Running Editor Drafts Store Tests ===");
    let store = CoworkerStore::open_in_memory().expect("open memory db");

    store.save_draft("notes/meeting.md", "# Meeting Notes\nUnsaved draft content").expect("save draft");
    let draft = store.get_draft("notes/meeting.md").expect("get draft").unwrap();
    assert_eq!(draft.path, "notes/meeting.md");
    assert!(draft.content.contains("Unsaved draft content"));
    println!("  [PASS] Saved and retrieved editor draft for crash resiliency");

    let drafts = store.list_drafts().expect("list drafts");
    assert_eq!(drafts.len(), 1);

    store.delete_draft("notes/meeting.md").expect("delete draft");
    let after = store.get_draft("notes/meeting.md").expect("get draft after");
    assert!(after.is_none());
    println!("  [PASS] Deleted draft on save/discard");
}

fn test_snapshot_manager_and_rollback() {
    println!("\n=== Running Zero-Token Snapshot & 1-Click Rollback Tests ===");
    let temp_dir = std::env::temp_dir().join(format!("oro_snap_test_{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&temp_dir).expect("create temp dir");

    let store = CoworkerStore::open_in_memory().expect("open memory db");
    let snap_mgr = app_lib::agent::snapshot::SnapshotManager::new(&temp_dir);

    // Initial files
    let initial_file = temp_dir.join("main.rs");
    std::fs::write(&initial_file, "fn main() { println!(\"Version 1.0\"); }").expect("write initial");

    let to_delete_file = temp_dir.join("obsolete.txt");
    std::fs::write(&to_delete_file, "Temporary obsolete content").expect("write obsolete");

    // Create session in store to satisfy foreign key constraint
    let sess = store.create_session(Some("Snapshot Test"), None, None, None).expect("create session");

    // Begin turn
    let mut turn_ctx = snap_mgr.begin_turn(&sess.id, "Refactor main and remove obsolete", 1);

    // 1. Record modification of main.rs
    snap_mgr.record_before_mutation(&mut turn_ctx, "main.rs", "modified", None);
    std::fs::write(&initial_file, "fn main() { println!(\"Version 2.0 - Destructive edit\"); }").expect("modify");

    // 2. Record deletion of obsolete.txt
    snap_mgr.record_before_mutation(&mut turn_ctx, "obsolete.txt", "deleted", None);
    std::fs::remove_file(&to_delete_file).expect("delete");

    // 3. Record creation of brand_new.rs
    let brand_new = temp_dir.join("brand_new.rs");
    snap_mgr.record_before_mutation(&mut turn_ctx, "brand_new.rs", "created", None);
    std::fs::write(&brand_new, "pub fn new_feature() {}").expect("create brand_new");

    // Commit turn snapshot
    let snapshot_record = snap_mgr.commit_turn(turn_ctx, &store).expect("commit turn").unwrap();
    assert_eq!(snapshot_record.manifest.len(), 3);
    println!("  [PASS] Turn snapshot committed with 3 recorded file mutations");

    // Verify mutations took effect
    assert_eq!(std::fs::read_to_string(&initial_file).unwrap(), "fn main() { println!(\"Version 2.0 - Destructive edit\"); }");
    assert!(!to_delete_file.exists());
    assert!(brand_new.exists());

    // 4. TRIGGER 1-CLICK ROLLBACK!
    let rollback_res = snap_mgr.rollback(&snapshot_record.id, &store).expect("rollback");
    assert!(rollback_res.success);
    assert_eq!(rollback_res.restored_files.len(), 2); // main.rs and obsolete.txt restored
    assert_eq!(rollback_res.deleted_files.len(), 1);  // brand_new.rs removed
    println!("  [PASS] 1-Click Rollback succeeded: restored 2 files, deleted 1 file");

    // Verify restored file contents match exact pre-mutation state
    let restored_main = std::fs::read_to_string(&initial_file).unwrap();
    assert_eq!(restored_main, "fn main() { println!(\"Version 1.0\"); }");
    assert!(to_delete_file.exists());
    assert_eq!(std::fs::read_to_string(&to_delete_file).unwrap(), "Temporary obsolete content");
    assert!(!brand_new.exists());
    println!("  [PASS] Exact pre-turn workspace state verified 100% restored!");

    // Clean up temp
    let _ = std::fs::remove_dir_all(&temp_dir);
}

fn test_agent_tools_execution() {
    println!("\n=== Running Agent Tool Execution Tests ===");
    let temp_dir = std::env::temp_dir().join(format!("oro_tools_test_{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&temp_dir).expect("create temp dir");

    let store = CoworkerStore::open_in_memory().expect("open memory db");
    let snap_mgr = app_lib::agent::snapshot::SnapshotManager::new(&temp_dir);

    let tools = app_lib::agent::tools::get_agent_tools();
    assert!(tools.len() >= 14);
    assert!(tools.iter().any(|t| t.name == "read_file"));
    assert!(tools.iter().any(|t| t.name == "write_file"));
    assert!(tools.iter().any(|t| t.name == "edit_file"));
    assert!(tools.iter().any(|t| t.name == "search_vault"));
    println!("  [PASS] Verified {} agent tool definitions available", tools.len());

    let sess = store.create_session(Some("Tools Test"), None, None, None).expect("create session");
    let executor = app_lib::agent::tools::ToolExecutor::new(
        &temp_dir,
        &store,
        &snap_mgr,
        &sess.id,
    );
    let mut turn_ctx = snap_mgr.begin_turn(&sess.id, "Test write and edit", 1);

    // 1. write_file
    let write_res = executor.execute(
        "write_file",
        &serde_json::json!({
            "path": "test_note.md",
            "content": "# Test Note\nThis is old value.\n"
        }),
        &mut turn_ctx,
    );
    assert!(write_res.ok);
    assert!(temp_dir.join("test_note.md").exists());
    println!("  [PASS] write_file tool executed successfully");

    // 2. read_file
    let read_res = executor.execute(
        "read_file",
        &serde_json::json!({ "path": "test_note.md" }),
        &mut turn_ctx,
    );
    assert!(read_res.ok);
    assert!(read_res.output.contains("old value"));
    println!("  [PASS] read_file tool executed successfully");

    // 3. edit_file
    let edit_res = executor.execute(
        "edit_file",
        &serde_json::json!({
            "path": "test_note.md",
            "target": "old value",
            "replacement": "native Rust value"
        }),
        &mut turn_ctx,
    );
    assert!(edit_res.ok);
    let edited_content = std::fs::read_to_string(temp_dir.join("test_note.md")).unwrap();
    assert!(edited_content.contains("native Rust value"));
    println!("  [PASS] edit_file tool executed targeted micro-replacement");

    // 4. search_vault
    let search_res = executor.execute(
        "search_vault",
        &serde_json::json!({ "query": "native Rust" }),
        &mut turn_ctx,
    );
    assert!(search_res.ok);
    println!("  [PASS] search_vault tool executed successfully");

    let _ = std::fs::remove_dir_all(&temp_dir);
}

fn main() {
    test_vault_parser();
    test_vault_graph_pagerank();
    test_vault_fs_and_link_refactoring();
    test_vault_indexing_and_fts5();
    test_safety_gate();
    test_work_stealing_scheduler();
    test_dag_engine();
    test_store_lifecycle();
    test_sessions_and_messages();
    test_memories_and_tasks();
    test_editor_drafts();
    test_snapshot_manager_and_rollback();
    test_agent_tools_execution();
    println!("\n========================================================");
    println!("ALL RUST VAULT, AGENT & CO-WORKER ENGINE TESTS PASSED! (100% OK)");
    println!("========================================================");
}
