# 24/7 Autonomous Co-Worker System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Oro into a 24/7 autonomous co-worker featuring an explicit shift handover (`[ At Desk ]` vs `[ Stepping Away ]`), crash-resistant SQLite Task DAG, non-blocking work-stealing approval scheduler, runtime safety gating, token optimization, and a remote companion API.

**Architecture:** Native integration into Oro's local stack using `node:sqlite` for DAG persistence and approval queues, an event-driven serial single-consumer work-stealing scheduler in `src/agent/`, runtime tool gating with checkpointed state resumption, REST/SSE companion endpoints in `src/server/server.ts`, and Electron tray/power management in `src/electron/main.ts`.

**Tech Stack:** TypeScript, Node.js (`node:sqlite`, `node:test`, `node:child_process`), Electron (`powerSaveBlocker`, `Tray`), React, Monaco Editor, Vite.

**Spec:** `C:\Users\BACH\.gemini\antigravity\brain\accffe1d-09e9-4f01-8d4d-e311253ccb34\autonomous-coworker-design.md`

## Global Constraints

- Never use pure black (`#000000`) or harsh unstyled browser elements in UI components.
- Maintain strict backward compatibility with existing sessions, config, and all 28 existing test suites.
- File system changes must be captured by `VaultSnapshotManager` for instant 1-click reversibility.
- Subagent tasks execute with concurrency = 1 on the workspace to guarantee zero file write race conditions and linear snapshot history.
- Dynamic tokens must adhere to prompt cache alignment and stateless sub-task prompting to prevent $O(N^2)$ conversational compounding.

## Review Focus

1. **Cycle Detection in DAG**: Malformed or circular LLM task dependencies could cause infinite scheduler lockups; must be detected and rejected before execution.
2. **Crash & Sleep Resumption**: If the application restarts or the laptop sleeps mid-task, tasks in `in_progress` or `waiting_approval` must resume safely without duplicating side effects.
3. **Approval Interception Isolation**: A gated tool call (e.g. `shell_exec` or `delete_file`) must not execute partially before approval; arguments and diffs must be captured cleanly without side-effects.
4. **Work-Stealing Priority**: When Task A is parked for approval, the scheduler must immediately select an unblocked Task B whose parents are completed, rather than idling.
5. **Shift Draining Safety**: Switching back to `[ At Desk ]` while a micro-step is writing a file must allow the current write/transpile to finish cleanly (max 3-5s) instead of aborting mid-stream and leaving corrupt syntax.

---

### Task 1: Database Migration & Storage Models

**Files:**
- Modify: `src/types.ts`
- Modify: `src/db/store.ts`
- Create: `tests/coworker-store.test.ts`

**Interfaces:**
- Consumes: `OroStore` SQLite database wrapper from `src/db/store.ts`.
- Produces: 
  - Types: `CoworkerGoal`, `CoworkerTask`, `CoworkerApproval`, `ShiftStatus` in `src/types.ts`.
  - Methods on `OroStore`:
    - `createCoworkerGoal(goal: Partial<CoworkerGoal>): CoworkerGoal`
    - `getCoworkerGoal(id: string): CoworkerGoal | null`
    - `updateCoworkerGoal(id: string, patch: Partial<CoworkerGoal>): void`
    - `createCoworkerTask(task: Partial<CoworkerTask>): CoworkerTask`
    - `getCoworkerTask(id: string): CoworkerTask | null`
    - `updateCoworkerTask(id: string, patch: Partial<CoworkerTask>): void`
    - `listCoworkerTasks(goalId: string): CoworkerTask[]`
    - `createCoworkerApproval(approval: Partial<CoworkerApproval>): CoworkerApproval`
    - `getCoworkerApproval(id: string): CoworkerApproval | null`
    - `updateCoworkerApproval(id: string, patch: Partial<CoworkerApproval>): void`
    - `listPendingApprovals(goalId?: string): CoworkerApproval[]`

- [ ] **Step 1: Write failing store tests in `tests/coworker-store.test.ts`**
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { OroStore } from "../src/db/store.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

test("CoworkerStore: goal, task DAG, and approval persistence", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oro-cw-store-"));
  const dbPath = path.join(tmpDir, "test-oro.db");
  const store = new OroStore(dbPath);

  const goal = store.createCoworkerGoal({ title: "Fix FTS5 leak" });
  assert.ok(goal.id);
  assert.equal(goal.status, "active");

  const task1 = store.createCoworkerTask({ goalId: goal.id, title: "Scout leak", role: "Scout" });
  const task2 = store.createCoworkerTask({ goalId: goal.id, title: "Apply fix", role: "Coder", dependencies: [task1.id] });
  assert.deepEqual(task2.dependencies, [task1.id]);

  const approval = store.createCoworkerApproval({
    taskId: task2.id,
    goalId: goal.id,
    actionType: "shell_exec",
    title: "Run npm test",
    payloadJson: JSON.stringify({ command: "npm test" }),
  });
  assert.equal(store.listPendingApprovals().length, 1);

  store.updateCoworkerApproval(approval.id, { status: "approved" });
  assert.equal(store.listPendingApprovals().length, 0);

  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test dist-test/tests/coworker-store.test.js`
Expected: FAIL with `store.createCoworkerGoal is not a function`

- [ ] **Step 3: Implement database tables and store methods**
Add types to `src/types.ts`:
```ts
export interface CoworkerGoal {
  id: string;
  title: string;
  description?: string;
  status: "active" | "completed" | "paused" | "failed";
  createdAt: number;
  completedAt?: number;
  tokenBudget: number;
  tokensUsed: number;
}

export interface CoworkerTask {
  id: string;
  goalId: string;
  title: string;
  role: "Scout" | "Coder" | "Tester" | "Critic";
  modelTier: "fast" | "standard" | "reasoning";
  status: "pending" | "in_progress" | "waiting_approval" | "done" | "failed" | "skipped";
  dependencies: string[];
  checkpointContext?: string;
  resultSummary?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface CoworkerApproval {
  id: string;
  taskId: string;
  goalId: string;
  actionType: "shell_exec" | "delete_file" | "git_push" | "destructive_edit";
  title: string;
  payloadJson: string;
  status: "pending" | "approved" | "rejected";
  userResponseNote?: string;
  createdAt: number;
  resolvedAt?: number;
}
```
Add table DDL and CRUD methods in `src/db/store.ts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test`
Expected: PASS (29/29 tests)

- [ ] **Step 5: Commit**
```bash
git add src/types.ts src/db/store.ts tests/coworker-store.test.ts
git commit -m "feat(coworker): add SQLite schema and store methods for goals, DAG tasks, and approvals"
```

---

### Task 2: Task DAG Engine & Topological Validator

**Files:**
- Create: `src/agent/coworker-dag.ts`
- Create: `tests/coworker-dag.test.ts`

**Interfaces:**
- Consumes: `CoworkerTask` from `src/types.ts`.
- Produces:
  - `validateDAG(tasks: CoworkerTask[]): { valid: boolean; error?: string }`
  - `computeReadyTasks(tasks: CoworkerTask[]): CoworkerTask[]`
  - `cascadeSkipDependents(rejectedTaskId: string, allTasks: CoworkerTask[]): string[]`
  - `decomposeGoalToTaskSpecs(prompt: string, provider: LLMProvider): Promise<Array<Omit<CoworkerTask, "id" | "goalId" | "createdAt">>>`

- [ ] **Step 1: Write failing DAG tests in `tests/coworker-dag.test.ts`**
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { validateDAG, computeReadyTasks, cascadeSkipDependents } from "../src/agent/coworker-dag.js";
import type { CoworkerTask } from "../src/types.js";

test("CoworkerDAG: ready task resolution, cycle detection, and cascade skipping", () => {
  const tasks: CoworkerTask[] = [
    { id: "t1", goalId: "g1", title: "Task 1", role: "Scout", modelTier: "fast", status: "done", dependencies: [], createdAt: 0 },
    { id: "t2", goalId: "g1", title: "Task 2", role: "Coder", modelTier: "standard", status: "pending", dependencies: ["t1"], createdAt: 0 },
    { id: "t3", goalId: "g1", title: "Task 3", role: "Tester", modelTier: "fast", status: "pending", dependencies: ["t2"], createdAt: 0 },
    { id: "t4", goalId: "g1", title: "Task 4", role: "Critic", modelTier: "standard", status: "pending", dependencies: [], createdAt: 0 },
  ];

  // t2 is ready because t1 is done; t4 is ready because dependencies are empty
  const ready = computeReadyTasks(tasks);
  assert.deepEqual(ready.map((t) => t.id).sort(), ["t2", "t4"]);

  // Detect circular dependency
  const cyclicTasks: CoworkerTask[] = [
    { id: "c1", goalId: "g1", title: "C1", role: "Coder", modelTier: "standard", status: "pending", dependencies: ["c2"], createdAt: 0 },
    { id: "c2", goalId: "g1", title: "C2", role: "Coder", modelTier: "standard", status: "pending", dependencies: ["c1"], createdAt: 0 },
  ];
  const validation = validateDAG(cyclicTasks);
  assert.equal(validation.valid, false);

  // Cascade skip dependents when t2 is rejected
  const skippedIds = cascadeSkipDependents("t2", tasks);
  assert.deepEqual(skippedIds, ["t3"]);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test dist-test/tests/coworker-dag.test.js`
Expected: FAIL with module not found

- [ ] **Step 3: Implement DAG algorithms in `src/agent/coworker-dag.ts`**
Implement Kahn's algorithm or DFS cycle detection for `validateDAG`, status filtering for `computeReadyTasks`, downstream BFS traversal for `cascadeSkipDependents`, and system prompt builder for `decomposeGoalToTaskSpecs`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test`
Expected: PASS (30/30 tests)

- [ ] **Step 5: Commit**
```bash
git add src/agent/coworker-dag.ts tests/coworker-dag.test.ts
git commit -m "feat(coworker): add DAG validation, ready task calculation, and cascade skipping"
```

---

### Task 3: Runtime Safety Interceptor & Checkpointed Task Suspension

**Files:**
- Create: `src/agent/coworker-safety.ts`
- Create: `tests/coworker-safety.test.ts`
- Modify: `src/agent/tools.ts`

**Interfaces:**
- Consumes: `OroStore`, `CoworkerTask`, `CoworkerApproval` from `src/types.ts`.
- Produces:
  - `isActionGated(toolName: string, args: Record<string, unknown>, policy?: string): { gated: boolean; reason?: string; actionType?: CoworkerApproval["actionType"] }`
  - `serializeTurnCheckpoint(messages: any[], step: number): string`
  - `deserializeTurnCheckpoint(checkpoint: string): { messages: any[]; step: number }`

- [ ] **Step 1: Write failing tests in `tests/coworker-safety.test.ts`**
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { isActionGated, serializeTurnCheckpoint, deserializeTurnCheckpoint } from "../src/agent/coworker-safety.js";

test("CoworkerSafety: evaluates gated tools and serializes turn checkpoints", () => {
  // Gated: terminal execution and file deletion
  assert.equal(isActionGated("execute_command", { command: "rm -rf dist" }).gated, true);
  assert.equal(isActionGated("delete_file", { path: "src/main.ts" }).gated, true);

  // Safe: read_file and edit_file within workspace
  assert.equal(isActionGated("read_file", { path: "src/main.ts" }).gated, false);
  assert.equal(isActionGated("edit_file", { path: "src/main.ts", target: "a", replacement: "b" }).gated, false);

  // Checkpoint serialization
  const payload = [{ role: "user", content: "test" }];
  const serialized = serializeTurnCheckpoint(payload, 3);
  const restored = deserializeTurnCheckpoint(serialized);
  assert.equal(restored.step, 3);
  assert.deepEqual(restored.messages, payload);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test dist-test/tests/coworker-safety.test.js`
Expected: FAIL

- [ ] **Step 3: Implement safety evaluation and checkpoint serializer in `src/agent/coworker-safety.ts`**
- [ ] **Step 4: Run test to verify it passes**
Run: `npm test`
Expected: PASS (31/31 tests)

- [ ] **Step 5: Commit**
```bash
git add src/agent/coworker-safety.ts tests/coworker-safety.test.ts
git commit -m "feat(coworker): add runtime safety gate and checkpoint serialization"
```

---

### Task 4: The Non-Blocking Work-Stealing Scheduler Engine

**Files:**
- Create: `src/agent/coworker-scheduler.ts`
- Create: `tests/coworker-scheduler.test.ts`

**Interfaces:**
- Consumes: `OroStore`, `coworker-dag`, `coworker-safety`, `VaultSnapshotManager`, `VaultFsManager`.
- Produces: `CoworkerScheduler` class with:
  - `constructor(opts: CoworkerSchedulerOptions)`
  - `startShift(goalTitle: string): Promise<string>`
  - `tick(): Promise<{ actionTaken: boolean; activeTaskId?: string; parkedTaskId?: string }>`
  - `resolveApproval(approvalId: string, decision: "approve" | "reject", note?: string): Promise<void>`
  - `drainShift(): Promise<{ completedTasks: number; filesModified: string[]; pendingApprovals: number }>`
  - `getStatus(): CoworkerShiftStatus`

- [ ] **Step 1: Write failing scheduler test in `tests/coworker-scheduler.test.ts`**
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { CoworkerScheduler } from "../src/agent/coworker-scheduler.js";
import { OroStore } from "../src/db/store.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

test("CoworkerScheduler: work-stealing when a task is parked for approval", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oro-sched-test-"));
  const store = new OroStore(path.join(tmpDir, "test.db"));

  const goal = store.createCoworkerGoal({ title: "Multi-task run" });
  // Task 1 will be simulated to park for approval
  const t1 = store.createCoworkerTask({ goalId: goal.id, title: "Task 1 (Gated)", role: "Coder", status: "pending", dependencies: [] });
  // Task 2 is independent and ready
  const t2 = store.createCoworkerTask({ goalId: goal.id, title: "Task 2 (Safe)", role: "Tester", status: "pending", dependencies: [] });

  const scheduler = new CoworkerScheduler({
    store,
    workspaceRoot: tmpDir,
    // mock executor that parks t1 and completes t2
    taskExecutor: async (task) => {
      if (task.id === t1.id) return { status: "parked", approvalType: "shell_exec", title: "Run command" };
      return { status: "done", summary: "Tests passed" };
    },
  });

  // Tick 1: picks t1, encounters gated action -> parks t1 in waiting_approval
  const res1 = await scheduler.tick();
  assert.equal(res1.parkedTaskId, t1.id);
  assert.equal(store.getCoworkerTask(t1.id)?.status, "waiting_approval");

  // Tick 2: WORK-STEALING! Scheduler does not idle; immediately picks and completes t2
  const res2 = await scheduler.tick();
  assert.equal(res2.activeTaskId, t2.id);
  assert.equal(store.getCoworkerTask(t2.id)?.status, "done");

  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test dist-test/tests/coworker-scheduler.test.js`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `CoworkerScheduler` in `src/agent/coworker-scheduler.ts`**
Implement tick loop, single-consumer lock, work-stealing priority resolution, pre-mutation snapshots, and approval resolution.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test`
Expected: PASS (32/32 tests)

- [ ] **Step 5: Commit**
```bash
git add src/agent/coworker-scheduler.ts tests/coworker-scheduler.test.ts
git commit -m "feat(coworker): implement non-blocking work-stealing scheduler engine"
```

---

### Task 5: Remote Companion API & Event Streaming

**Files:**
- Modify: `src/server/server.ts`
- Create: `tests/coworker-api.test.ts`

**Endpoints:**
- `GET /api/coworker/status`
- `POST /api/coworker/handover`
- `GET /api/coworker/approvals`
- `POST /api/coworker/approvals/:id/resolve`
- `GET /api/coworker/events` (SSE stream)

- [ ] **Step 1: Write failing API test in `tests/coworker-api.test.ts`**
```ts
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startOroServer } from "../src/server/server.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

test("CoworkerAPI: status, handover, and approval endpoints respond correctly", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oro-api-test-"));
  const serverInstance = await startOroServer({ workspaceRoot: tmpDir, port: 0 });
  const port = serverInstance.port;

  // 1. GET /api/coworker/status
  const statusRes = await fetch(`http://localhost:${port}/api/coworker/status`);
  assert.equal(statusRes.status, 200);
  const statusJson = await statusRes.json();
  assert.equal(statusJson.mode, "at_desk");

  serverInstance.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test dist-test/tests/coworker-api.test.js`
Expected: FAIL with 404 on endpoint

- [ ] **Step 3: Implement endpoints in `src/server/server.ts`**
Mount `/api/coworker/*` routes with status query, handover dispatching, approval resolution, and SSE broadcaster.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test`
Expected: PASS (33/33 tests)

- [ ] **Step 5: Commit**
```bash
git add src/server/server.ts tests/coworker-api.test.ts
git commit -m "feat(coworker): add REST and SSE remote companion endpoints"
```

---

### Task 6: Desktop Shift Handover UI & Return Briefing

**Files:**
- Modify: `src/renderer/components/TitleBar.tsx`
- Create: `src/renderer/components/ShiftHandoverModal.tsx`
- Create: `src/renderer/components/ApprovalInboxCard.tsx`
- Modify: `src/renderer/components/ChatPanel.tsx`
- Modify: `src/renderer/App.tsx`

**Craft & Quality Rules:**
- Zero unstyled controls.
- Micro-interactions with `cubic-bezier(0.16, 1, 0.3, 1)`.
- Seamless obsidian (`#121215`, `#18181c`) and studio paper (`#ffffff`, `#f0f0f3`) palettes.

- [ ] **Step 1: Create `ShiftHandoverModal.tsx`**
Includes goal textarea, backlog task checklist, safety policy capsule, and "Dispatch Co-Worker" trigger.
- [ ] **Step 2: Create `ApprovalInboxCard.tsx`**
Renders pending gated actions with code/diff snippet and `[ Approve ]` / `[ Reject ]` buttons.
- [ ] **Step 3: Update `TitleBar.tsx` with Shift Mode capsule**
Adds `[ At Desk ▾ ]` indicator with animated status dot (`green` = At Desk, `purple pulse` = Stepping Away).
- [ ] **Step 4: Update `ChatPanel.tsx` to display Executive Shift Report on Return**
Renders completed goal summary, verified test badges, files modified, and rollback button.
- [ ] **Step 5: Verify build & tests**
Run: `npm run build && npm test`
Expected: Clean build in ~1.05s, 33/33 tests pass.

- [ ] **Step 6: Commit**
```bash
git add src/renderer/components/ src/renderer/App.tsx
git commit -m "feat(coworker): add Shift Handover modal, Approval Inbox cards, and Executive Return Report UI"
```

---

### Task 7: Electron Background Tray & OS Sleep Prevention

**Files:**
- Modify: `src/electron/main.ts`

**Interfaces:**
- Electron `Tray` instance with live tooltip status.
- `powerSaveBlocker.start("prevent-app-suspension")` active during away shifts.
- Intercept `close` event on `BrowserWindow`: if shift is active, `event.preventDefault(); win.hide();`.

- [ ] **Step 1: Implement tray creation and powerSaveBlocker in `src/electron/main.ts`**
- [ ] **Step 2: Verify Electron build**
Run: `npm run build`
Expected: PASS with dist output ready.
- [ ] **Step 3: Commit**
```bash
git add src/electron/main.ts
git commit -m "feat(coworker): integrate system tray minimization and powerSaveBlocker for 24/7 background operation"
```

---

### Task 8: End-to-End Verification & Benchmark Suite

**Files:**
- Create: `tests/coworker-e2e.test.ts`

- [ ] **Step 1: Write E2E simulation test in `tests/coworker-e2e.test.ts`**
Simulate complete cycle: Start shift $\rightarrow$ DAG breakdown $\rightarrow$ Tool execution $\rightarrow$ Gated action interception $\rightarrow$ Work-stealing switch to independent task $\rightarrow$ Approval resolution $\rightarrow$ Drain shift $\rightarrow$ Return report generation $\rightarrow$ Pre-mutation snapshot rollback.
- [ ] **Step 2: Run all test suites**
Run: `npm test`
Expected: All 34 test suites pass with 100% success rate.
- [ ] **Step 3: Run production build**
Run: `npm run build`
Expected: 0 errors in ~1.05s.
- [ ] **Step 4: Commit**
```bash
git add tests/coworker-e2e.test.ts
git commit -m "test(coworker): add end-to-end simulation covering work-stealing, approvals, and rollback"
```
