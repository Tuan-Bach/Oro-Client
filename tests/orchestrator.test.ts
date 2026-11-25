import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runAutomatedDiagnostics, runTriadOrchestrator } from "../src/agent/orchestrator.js";
import { OroStore } from "../src/db/store.js";
import type { LLMChatParams, LLMProvider, LLMStreamEvent } from "../src/providers/types.js";
import { VaultFsManager } from "../src/vault/fs-manager.js";
import { VaultIndexer } from "../src/vault/indexer.js";

describe("Triad Orchestrator (Architect → Builder → Critic)", () => {
  it("runs automated diagnostics accurately on JSON, Python, JS, and Markdown", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oro-diag-test-"));
    try {
      // 1. Valid and invalid JSON
      fs.writeFileSync(path.join(tmpDir, "valid.json"), '{"key": "value"}');
      fs.writeFileSync(path.join(tmpDir, "broken.json"), '{"key": "value",}'); // trailing comma

      const res1 = runAutomatedDiagnostics(tmpDir, ["valid.json"]);
      assert.equal(res1.ok, true);

      const res2 = runAutomatedDiagnostics(tmpDir, ["broken.json"]);
      assert.equal(res2.ok, false);
      assert.ok(res2.errors[0]?.includes("JSON syntax error in broken.json"));

      // 2. Markdown frontmatter check
      fs.writeFileSync(path.join(tmpDir, "valid.md"), "---\ntitle: Note\n---\n# Content");
      fs.writeFileSync(path.join(tmpDir, "unclosed.md"), "---\ntitle: Note\nContent without closing dashes");

      const res3 = runAutomatedDiagnostics(tmpDir, ["valid.md"]);
      assert.equal(res3.ok, true);

      const res4 = runAutomatedDiagnostics(tmpDir, ["unclosed.md"]);
      assert.equal(res4.ok, false);
      assert.ok(res4.errors[0]?.includes("Unclosed YAML frontmatter"));

      // 3. Knowledge Graph Linter: Broken wiki-link & fuzzy suggestion
      fs.writeFileSync(path.join(tmpDir, "Artificial Neurons.md"), "# Artificial Neurons\nFoundational note.");
      fs.writeFileSync(path.join(tmpDir, "linking.md"), "# Linking\nSee [[Artificil Neurons]] for details.");
      const res5 = runAutomatedDiagnostics(tmpDir, ["linking.md"]);
      assert.equal(res5.ok, false);
      assert.ok(
        res5.errors.some((e) => e.includes("Broken wiki-link") && e.includes("Artificial Neurons")),
        `Expected broken link with suggestion, got: ${JSON.stringify(res5.errors)}`
      );

      // 4. Malformed markdown task checkbox linter
      fs.writeFileSync(path.join(tmpDir, "tasks.md"), "# Tasks\n-[] Broken checkbox\n- [ ] Valid task");
      const res6 = runAutomatedDiagnostics(tmpDir, ["tasks.md"]);
      assert.equal(res6.ok, false);
      assert.ok(res6.errors.some((e) => e.includes("Malformed markdown task checkbox")));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("coordinates Architect, Builder, and Critic to plan, execute, and verify tasks in Second Brain", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oro-triad-run-"));
    fs.mkdirSync(path.join(tmpDir, ".oro"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "Notes"), { recursive: true });

    const store = new OroStore(path.join(tmpDir, ".oro", "oro.db"));
    const indexer = new VaultIndexer(tmpDir, store);
    const fsMgr = new VaultFsManager(tmpDir, store, indexer);

    try {
      const session = store.createSession({
        title: "Triad Test Session",
        mode: "triad",
        provider: "gemini",
        model: "mock-model",
      });

      let callIndex = 0;
      const phasesCalled: string[] = [];
      let verificationPassed = false;

      // Mock multi-stage LLM Provider for the Triad
      const mockProvider: LLMProvider = {
        id: "gemini",
        model: "mock-triad-model",
        async *streamChat(params: LLMChatParams): AsyncGenerator<LLMStreamEvent> {
          callIndex++;

          // Call 1: ARCHITECT formulation -> plans and adds task to Second Brain
          if (params.systemPrompt.includes("YOUR ROLE: ARCHITECT")) {
            yield { type: "text", delta: "Plan:\n1. Scaffold feature note\n2. Add implementation code" };
            yield {
              type: "tool_call",
              call: {
                id: "tc_arch_1",
                name: "task_add",
                args: {
                  title: "Create Feature.md note",
                  filePath: "Notes/Feature.md",
                },
              },
            };
            yield { type: "done" };
          }
          // Call 2: BUILDER execution -> writes the file
          else if (params.systemPrompt.includes("YOUR ROLE: BUILDER")) {
            yield { type: "text", delta: "Writing Notes/Feature.md..." };
            yield {
              type: "tool_call",
              call: {
                id: "tc_build_1",
                name: "write_file",
                args: {
                  path: "Notes/Feature.md",
                  content: "---\ntitle: Feature\n---\n# Feature Overview\n\n- [ ] Implement core logic\n",
                },
              },
            };
            yield { type: "done" };
          }
          // Call 3: CRITIC review -> evaluates and approves
          else if (params.systemPrompt.includes("YOUR ROLE: CRITIC")) {
            yield { type: "text", delta: "✓ VERIFIED: Feature note created cleanly with valid frontmatter." };
            yield { type: "done" };
          }
          // Fallback
          else {
            yield { type: "text", delta: "Completed." };
            yield { type: "done" };
          }
        },
      };

      const result = await runTriadOrchestrator({
        userInput: "Orchestrate creating a new feature note called Feature.md",
        session,
        provider: mockProvider,
        store,
        fsManager: fsMgr,
        callbacks: {
          onPhaseChange: (phase) => {
            phasesCalled.push(phase);
          },
          onVerification: (v) => {
            if (v.passed) verificationPassed = true;
          },
        },
      });

      // Assertions
      assert.ok(phasesCalled.includes("architect"), "Should enter architect phase");
      assert.ok(phasesCalled.includes("builder"), "Should enter builder phase");
      assert.ok(phasesCalled.includes("critic"), "Should enter critic phase");
      assert.ok(phasesCalled.includes("done"), "Should conclude successfully");
      assert.equal(verificationPassed, true, "Verification should pass");

      // Verify file was written to disk
      assert.equal(fs.existsSync(path.join(tmpDir, "Notes", "Feature.md")), true);

      // Verify Second Brain task was created and marked completed [x]
      const tasks = store.listTasks(true);
      const featureTask = tasks.find((t) => t.title === "Create Feature.md note");
      assert.ok(featureTask, "Task should exist in Second Brain");
      assert.equal(Boolean(featureTask.done), true, "Task should be checked off [x] by Critic");

      // Output contains the 3-phase sections
      assert.ok(result.finalText.includes("Phase 1: Architect"));
      assert.ok(result.finalText.includes("Phase 2: Builder"));
      assert.ok(result.finalText.includes("Phase 3: Critic"));
    } finally {
      indexer.stopWatching();
      store.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
