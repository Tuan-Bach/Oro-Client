import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runAgentTurn } from "../src/agent/engine.js";
import { OroStore } from "../src/db/store.js";
import type { LLMChatParams, LLMProvider, LLMStreamEvent } from "../src/providers/types.js";
import { VaultFsManager } from "../src/vault/fs-manager.js";
import { VaultIndexer } from "../src/vault/indexer.js";

describe("Agent engine", () => {
  it("executes multi-step tool calls, tracks session files, and saves memory", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oro-agent-test-"));
    const store = new OroStore(path.join(tmpDir, ".oro", "oro.db"));
    const indexer = new VaultIndexer(tmpDir, store);
    const fsMgr = new VaultFsManager(tmpDir, store, indexer);

    try {
      const session = store.createSession({
        title: "Agent Test Session",
        mode: "builder",
        provider: "gemini",
        model: "gemini-3.8-flash",
      });

      let callCount = 0;
      const mockProvider: LLMProvider = {
        id: "gemini",
        model: "mock-model",
        async *streamChat(_params: LLMChatParams): AsyncGenerator<LLMStreamEvent> {
          callCount++;
          if (callCount === 1) {
            yield { type: "text", delta: "Creating your note and saving memory..." };
            yield {
              type: "tool_call",
              call: {
                id: "tc_1",
                name: "write_file",
                args: {
                  path: "Notes/Launch.md",
                  content: "# Launch Checklist\n\n- [ ] Publish Oro #launch\n",
                },
              },
            };
            yield {
              type: "tool_call",
              call: {
                id: "tc_2",
                name: "memory_save",
                args: {
                  content: "Oro v0.1 uses Node 26 built-in SQLite FTS5",
                  category: "decision",
                  importance: 5,
                },
              },
            };
            yield { type: "done" };
          } else {
            yield { type: "text", delta: "All done! Created Notes/Launch.md and saved your architectural decision." };
            yield { type: "done" };
          }
        },
      };

      let streamedText = "";
      const result = await runAgentTurn({
        userInput: "Create a launch checklist note and remember our SQLite decision",
        session,
        mode: "builder",
        provider: mockProvider,
        store,
        fsManager: fsMgr,
        callbacks: {
          onTextDelta: (d) => {
            streamedText += d;
          },
        },
      });

      assert.equal(result.steps, 3);
      assert.equal(result.toolEvents.length, 2);
      assert.ok(streamedText.includes("All done!"));
      assert.equal(fs.existsSync(path.join(tmpDir, "Notes", "Launch.md")), true);

      // Verify indexed in FTS5 & tracked in session
      assert.equal(store.searchNotes("Checklist").length, 1);
      assert.equal(store.getSessionFiles(session.id).length, 1);
      assert.equal(store.searchMemories("FTS5").length, 1);
    } finally {
      indexer.stopWatching();
      store.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("auto-classifies intent into plan vs builder correctly", async () => {
    const { classifyIntent } = await import("../src/agent/modes.js");
    assert.equal(classifyIntent("how do I configure SQLite FTS5 in node?"), "plan");
    assert.equal(classifyIntent("explain the architecture of Oro"), "plan");
    assert.equal(classifyIntent("brainstorm 5 ideas for notes"), "plan");
    assert.equal(classifyIntent("create a new file called Launch.md"), "builder");
    assert.equal(classifyIntent("write a script to export markdown"), "builder");
    assert.equal(classifyIntent("fix the bug in index.css"), "builder");
    assert.equal(classifyIntent("scaffold a folder called Projects/App"), "builder");
  });
});
