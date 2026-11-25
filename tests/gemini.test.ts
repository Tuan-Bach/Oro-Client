import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGeminiProvider } from "../src/providers/gemini.js";

describe("Gemini Provider & Thought Signature Handling", () => {
  it("disables thinking budget on Flash models by default for ultra-fast response", async () => {
    let capturedBody: any = null;

    const originalFetch = global.fetch;
    global.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello!"}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );
    }) as typeof fetch;

    try {
      const provider = createGeminiProvider({
        model: "gemini-3.5-flash",
        apiKey: "test-key",
        reasoningEffort: "medium",
      });

      const events = [];
      for await (const evt of provider.streamChat({
        systemPrompt: "sys",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
      })) {
        events.push(evt);
      }

      assert.equal(events.length, 2);
      assert.equal(events[0]?.type, "text");
      assert.equal((events[0] as { delta: string }).delta, "Hello!");

      // Verify thinkingBudget is 0 to disable thinking for flash models
      assert.equal(capturedBody?.generationConfig?.thinkingConfig?.thinkingBudget, 0);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("captures thoughtSignature from SSE and echoes it back in functionCall parts", async () => {
    let callIndex = 0;
    let turn2Body: any = null;

    const originalFetch = global.fetch;
    global.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      callIndex++;
      if (callIndex === 1) {
        // SSE returns functionCall with thoughtSignature
        const sseData =
          'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"list_files","args":{"dir":"."}},"thoughtSignature":"mock_sig_xyz_123"}]}}]}\n\ndata: [DONE]\n\n';
        return new Response(sseData, { status: 200, headers: { "Content-Type": "text/event-stream" } });
      } else {
        turn2Body = JSON.parse(init?.body as string);
        return new Response(
          'data: {"candidates":[{"content":{"parts":[{"text":"Done listing."}]}}]}\n\ndata: [DONE]\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        );
      }
    }) as typeof fetch;

    try {
      const provider = createGeminiProvider({
        model: "gemini-3.5-flash",
        apiKey: "test-key",
        reasoningEffort: "high",
      });

      // Turn 1
      const turn1Events = [];
      for await (const evt of provider.streamChat({
        systemPrompt: "sys",
        messages: [{ role: "user", content: "list files" }],
        tools: [],
      })) {
        turn1Events.push(evt);
      }

      const toolCallEvt = turn1Events.find((e) => e.type === "tool_call");
      assert.ok(toolCallEvt);
      if (toolCallEvt?.type === "tool_call") {
        assert.equal(toolCallEvt.call.name, "list_files");
        assert.equal(toolCallEvt.call.thoughtSignature, "mock_sig_xyz_123");

        // Turn 2: Echo back tool call and response
        for await (const _ of provider.streamChat({
          systemPrompt: "sys",
          messages: [
            { role: "user", content: "list files" },
            {
              role: "assistant",
              content: "",
              toolCalls: [toolCallEvt.call],
            },
            {
              role: "tool",
              toolCallId: toolCallEvt.call.id,
              toolName: "list_files",
              content: '{"files": ["Welcome.md"]}',
            },
          ],
          tools: [],
        })) {}

        // Verify that turn2 contents contained the thoughtSignature on Part, NOT on functionCall
        const contents = turn2Body?.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>;
        assert.ok(contents);
        const modelContent = contents.find((c) => c.role === "model");
        assert.ok(modelContent);
        const fcPart = modelContent.parts[0];
        assert.ok(fcPart);
        assert.equal(fcPart.thoughtSignature, "mock_sig_xyz_123");
        // Ensure functionCall strictly only contains name and args (no protobuf schema error)
        const fc = fcPart.functionCall as Record<string, unknown>;
        assert.equal(fc.name, "list_files");
        assert.equal(fc.thoughtSignature, undefined);
        assert.equal(fc.thought_signature, undefined);
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("uses skip_thought_signature_validator fallback when thoughtSignature is missing", async () => {
    let capturedBody: any = null;

    const originalFetch = global.fetch;
    global.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        'data: {"candidates":[{"content":{"parts":[{"text":"Done."}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );
    }) as typeof fetch;

    try {
      const provider = createGeminiProvider({
        model: "gemini-3.5-flash",
        apiKey: "test-key",
      });

      for await (const _ of provider.streamChat({
        systemPrompt: "sys",
        messages: [
          { role: "user", content: "list files" },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "c1", name: "list_files", args: {} }],
          },
          {
            role: "tool",
            toolCallId: "c1",
            toolName: "list_files",
            content: '{"files":[]}',
          },
        ],
        tools: [],
      })) {}

      const contents = capturedBody?.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>;
      const modelContent = contents.find((c) => c.role === "model");
      assert.ok(modelContent);
      const fcPart = modelContent.parts[0];
      assert.ok(fcPart);
      assert.equal(fcPart.thoughtSignature, "skip_thought_signature_validator");
      const fc = fcPart.functionCall as Record<string, unknown>;
      assert.equal(fc.name, "list_files");
      assert.equal(fc.thoughtSignature, undefined);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
