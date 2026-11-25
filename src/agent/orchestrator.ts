import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import ts from "typescript";
import type { OroStore } from "../db/store.js";
import type { LLMMessage, LLMProvider, ToolCallRequest } from "../providers/types.js";
import type { SessionRecord, ToolCallEvent } from "../types.js";
import type { VaultFsManager } from "../vault/fs-manager.js";
import { buildSystemPrompt, TOKEN_EFFICIENCY_DIRECTIVES } from "./context.js";
import type { AgentRunCallbacks, AgentRunResult } from "./engine.js";
import { ToolLoopBreaker, TurnBudgetCircuitBreaker } from "./circuit-breaker.js";
import {
  executeTool,
  ORO_TOOLS,
  ORCHESTRATOR_TOOLS,
  PLANNER_TOOLS,
  BUILDER_TOOLS,
  DEBUGGER_TOOLS,
  getToolsForRole,
} from "./tools.js";

export interface TriadCallbacks extends AgentRunCallbacks {
  onPhaseChange?: (phase: "architect" | "builder" | "critic" | "done", detail?: string) => void;
  onVerification?: (result: { passed: boolean; message: string; attempt: number }) => void;
}

export interface TriadOrchestratorOptions {
  userInput: string;
  session: SessionRecord;
  provider: LLMProvider;
  store: OroStore;
  fsManager: VaultFsManager;
  maxSteps?: number;
  userInstructions?: string;
  signal?: AbortSignal;
  callbacks?: TriadCallbacks;
}

export type OrchestratorOptions = TriadOrchestratorOptions;

function getAllNoteBasenames(workspaceRoot: string): string[] {
  const noteNames: string[] = [];
  function scan(dir: string, depth = 0) {
    if (depth > 6) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.name.startsWith(".")) continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          scan(full, depth + 1);
        } else if (ent.name.toLowerCase().endsWith(".md")) {
          noteNames.push(ent.name.replace(/\.md$/i, ""));
          const rel = path.relative(workspaceRoot, full).replace(/\\/g, "/");
          noteNames.push(rel.replace(/\.md$/i, ""));
        }
      }
    } catch {}
  }
  scan(workspaceRoot);
  return Array.from(new Set(noteNames));
}

function levenshteinDist(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 4) return 999;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function findClosestNoteMatch(target: string, candidates: string[]): string | null {
  const lower = target.toLowerCase();
  const exact = candidates.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;

  const sub = candidates.find((c) => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase()));
  if (sub) return sub;

  let best: string | null = null;
  let min = 4;
  for (const c of candidates) {
    const d = levenshteinDist(lower, c.toLowerCase());
    if (d < min) {
      min = d;
      best = c;
    }
  }
  return best;
}

/**
 * Fast automated syntax and integrity checks on files modified during the run.
 */
export function runAutomatedDiagnostics(
  workspaceRoot: string,
  modifiedPaths: string[]
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  let cachedNoteBasenames: string[] | null = null;

  for (const rel of modifiedPaths) {
    const abs = path.resolve(workspaceRoot, rel);
    if (!fs.existsSync(abs)) continue;

    const ext = path.extname(rel).toLowerCase();

    // 1. JSON syntax validation
    if (ext === ".json") {
      try {
        const text = fs.readFileSync(abs, "utf-8");
        JSON.parse(text);
      } catch (err: any) {
        errors.push(`JSON syntax error in ${rel}: ${err.message}`);
      }
    }
    // 2. TypeScript / TSX syntax transpilation validation
    else if (ext === ".ts" || ext === ".tsx") {
      try {
        const text = fs.readFileSync(abs, "utf-8");
        const res = ts.transpileModule(text, {
          reportDiagnostics: true,
          compilerOptions: { jsx: ts.JsxEmit.React },
        });
        if (res.diagnostics && res.diagnostics.length > 0) {
          for (const d of res.diagnostics.slice(0, 3)) {
            const msg = typeof d.messageText === "string" ? d.messageText : d.messageText?.messageText;
            const line = d.file ? d.file.getLineAndCharacterOfPosition(d.start || 0).line + 1 : "?";
            errors.push(`TypeScript syntax error in ${rel} (line ${line}): ${msg}`);
          }
        }
      } catch (err: any) {
        errors.push(`Error checking TypeScript syntax in ${rel}: ${err.message}`);
      }
    }
    // 3. Python syntax compilation check
    else if (ext === ".py") {
      try {
        execSync(`python -m py_compile "${abs}"`, { stdio: "pipe", timeout: 4000 });
      } catch (err: any) {
        const msg = err.stderr ? err.stderr.toString() : err.message;
        errors.push(`Python compilation error in ${rel}: ${msg.slice(0, 260)}`);
      }
    }
    // 4. Node/JS syntax check
    else if (ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".jsx") {
      try {
        execSync(`node -c "${abs}"`, { stdio: "pipe", timeout: 4000 });
      } catch (err: any) {
        const msg = err.stderr ? err.stderr.toString() : err.message;
        errors.push(`JavaScript syntax error in ${rel}: ${msg.slice(0, 260)}`);
      }
    }
    // 5. Markdown Note & Knowledge Graph Integrity Linter
    else if (ext === ".md") {
      try {
        const text = fs.readFileSync(abs, "utf-8");

        // 5a. YAML Frontmatter check
        if (text.startsWith("---")) {
          const secondDash = text.indexOf("---", 3);
          if (secondDash === -1) {
            errors.push(`Unclosed YAML frontmatter in note: ${rel}`);
          }
        }

        // 5b. Code fence pairing check
        const fences = text.match(/^```/gm);
        if (fences && fences.length % 2 !== 0) {
          errors.push(`Unclosed code fence (\`\`\`) in markdown note: ${rel}`);
        }

        // 5c. Task list checkbox formatting check
        const lines = text.split(/\r?\n/);
        lines.forEach((line, idx) => {
          const trimmed = line.trim();
          if (
            /^[-*+]\s*\[[^ xX\-]\]/.test(trimmed) ||
            /^[-*+]\[[ xX]?\]/.test(trimmed) ||
            /^[-*+]\s+\[\s{2,}\]/.test(trimmed)
          ) {
            errors.push(
              `Malformed markdown task checkbox in ${rel} line ${idx + 1}: '${trimmed}' (use standard '- [ ] ' or '- [x] ')`
            );
          }
        });

        // 5d. Wiki-link validity & fuzzy suggestions
        if (!cachedNoteBasenames) {
          cachedNoteBasenames = getAllNoteBasenames(workspaceRoot);
        }

        const wikiLinkRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
        let match: RegExpExecArray | null;
        const linksInNote: string[] = [];

        while ((match = wikiLinkRegex.exec(text)) !== null) {
          const rawTarget = match[1].trim();
          if (!rawTarget) continue;
          linksInNote.push(rawTarget);

          const targetExists =
            cachedNoteBasenames.some((b) => b.toLowerCase() === rawTarget.toLowerCase()) ||
            fs.existsSync(path.resolve(workspaceRoot, `${rawTarget}.md`)) ||
            fs.existsSync(path.resolve(workspaceRoot, rawTarget));

          if (!targetExists) {
            const suggestion = findClosestNoteMatch(rawTarget, cachedNoteBasenames);
            if (suggestion) {
              errors.push(
                `Broken wiki-link in ${rel}: [[${rawTarget}]] does not exist (did you mean [[${suggestion}]]?)`
              );
            } else {
              errors.push(`Broken wiki-link in ${rel}: target [[${rawTarget}]] does not exist in workspace.`);
            }
          }
        }

        // 5e. Orphan note warning (isolated knowledge island)
        const hasTags = /#[a-zA-Z0-9_\-\/]+/.test(text);
        if (linksInNote.length === 0 && !hasTags && text.length > 80) {
          errors.push(
            `Isolated note in ${rel}: Note contains 0 [[wiki-links]] and 0 tags. Connect it to an existing note or MOC.`
          );
        }
      } catch (err: any) {
        errors.push(`Error reading Markdown note ${rel}: ${err.message}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Executes a single sub-turn of the orchestrator with tool calls.
 */
async function executeSubTurn(opts: {
  systemPrompt: string;
  messages: LLMMessage[];
  provider: LLMProvider;
  store: OroStore;
  fsManager: VaultFsManager;
  session: SessionRecord;
  maxSubSteps?: number;
  tools?: import("../providers/types.js").ToolDefinition[];
  signal?: AbortSignal;
  callbacks?: TriadCallbacks;
  trackModifiedPaths?: Set<string>;
  loopBreaker?: ToolLoopBreaker;
  turnBudget?: TurnBudgetCircuitBreaker;
}): Promise<{ text: string; toolEvents: ToolCallEvent[]; steps: number }> {
  const maxSteps = opts.maxSubSteps ?? 6;
  const toolEvents: ToolCallEvent[] = [];
  let accumulatedText = "";
  let steps = 0;

  while (steps < maxSteps) {
    steps++;
    if (opts.signal?.aborted) break;

    let stepText = "";
    const stepToolCalls: ToolCallRequest[] = [];

    for await (const event of opts.provider.streamChat({
      systemPrompt: opts.systemPrompt,
      messages: opts.messages,
      tools: opts.tools ?? ORCHESTRATOR_TOOLS,
      signal: opts.signal,
    })) {
      if (event.type === "text") {
        stepText += event.delta;
        accumulatedText += event.delta;
        opts.callbacks?.onTextDelta?.(event.delta);
      } else if (event.type === "tool_call") {
        stepToolCalls.push(event.call);
      }
    }

    if (opts.turnBudget) {
      const budgetCheck = opts.turnBudget.recordStep(stepText.length, stepToolCalls.length);
      if (budgetCheck.exceeded) {
        accumulatedText += `\n\n⚠️ ${budgetCheck.reason}\n`;
        opts.callbacks?.onTextDelta?.(`\n\n⚠️ ${budgetCheck.reason}\n`);
        break;
      }
    }

    if (stepToolCalls.length === 0) break;

    opts.messages.push({
      role: "assistant",
      content: stepText,
      toolCalls: stepToolCalls,
    });

    if (stepText && !stepText.endsWith("\n")) {
      accumulatedText += "\n";
      opts.callbacks?.onTextDelta?.("\n");
    }

    for (const tc of stepToolCalls) {
      const runningEvt: ToolCallEvent = {
        id: tc.id,
        name: tc.name,
        args: tc.args,
        status: "running",
      };
      toolEvents.push(runningEvt);
      opts.callbacks?.onToolEvent?.({ ...runningEvt });

      // Track modified file paths for verifier
      if (tc.name === "write_file" || tc.name === "edit_file" || tc.name === "move_path") {
        const p = String(tc.args.path || tc.args.to || "");
        if (p) opts.trackModifiedPaths?.add(p);
      }

      const result = await executeTool(tc.name, tc.args, {
        store: opts.store,
        fsManager: opts.fsManager,
        sessionId: opts.session.id,
        provider: opts.provider,
        signal: opts.signal,
        loopBreaker: opts.loopBreaker,
        onSubagentProgress: opts.callbacks?.onSubagentProgress,
        onVaultMutated: () => opts.callbacks?.onVaultMutated?.(),
      });

      runningEvt.status = result.ok ? "done" : "error";
      runningEvt.summary = result.summary;
      opts.callbacks?.onToolEvent?.({ ...runningEvt });

      opts.messages.push({
        role: "tool",
        toolCallId: tc.id,
        toolName: tc.name,
        content: result.output,
      });
    }
  }

  return { text: accumulatedText, toolEvents, steps };
}

/**
 * Triad Orchestration Swarm:
 * Phase 1: ARCHITECT (Breaks down requirements, formulates plan, creates Second Brain tasks)
 * Phase 2: BUILDER (Applies precise edits and writes files)
 * Phase 3: CRITIC & VERIFIER (Runs diagnostics, tests, and self-correction loops)
 */
export async function runTriadOrchestrator(opts: TriadOrchestratorOptions): Promise<AgentRunResult> {
  const allToolEvents: ToolCallEvent[] = [];
  const modifiedPaths = new Set<string>();
  const createdTaskIds: number[] = [];
  let totalSteps = 0;
  let fullOutput = "";

  const loopBreaker = new ToolLoopBreaker({ maxConsecutiveIdentical: 3 });
  const turnBudget = new TurnBudgetCircuitBreaker({ maxSteps: 25, maxToolCalls: 35, maxTotalChars: 160_000 });

  // Persist user prompt in store
  opts.store.addMessage({
    sessionId: opts.session.id,
    role: "user",
    content: opts.userInput,
  });

  // Base system context
  const baseSystemPrompt = buildSystemPrompt({
    mode: "plan",
    session: opts.session,
    store: opts.store,
    fsManager: opts.fsManager,
    latestUserPrompt: opts.userInput,
    userInstructions: opts.userInstructions,
  });

  // ----------------------------------------------------
  // PHASE 1: ARCHITECT (Plan & Task Breakdown)
  // ----------------------------------------------------
  opts.callbacks?.onPhaseChange?.("architect", "Formulating architecture & breaking into tasks...");
  opts.callbacks?.onTextDelta?.("### 🧭 Phase 1: Architect Plan\n\n");
  fullOutput += "### 🧭 Phase 1: Architect Plan\n\n";

  const architectPrompt = [
    baseSystemPrompt,
    "",
    "## YOUR ROLE: ARCHITECT",
    "You are the ARCHITECT in Oro's Triad Orchestrator.",
    "Your objective:",
    "1. Analyze the user's goal against the vault and workspace files.",
    "2. Formulate a crisp, numbered execution plan of 2 to 4 concrete steps.",
    "3. Use `task_add` to register EACH step in the Second Brain task list so the user can track progress.",
    "4. Outline the exact target files and approach concisely. Do not write implementation code yet.",
  ].join("\n");

  const architectMessages: LLMMessage[] = [
    { role: "user", content: opts.userInput },
  ];

  const architectTurn = await executeSubTurn({
    systemPrompt: architectPrompt,
    messages: architectMessages,
    provider: opts.provider,
    store: opts.store,
    fsManager: opts.fsManager,
    session: opts.session,
    maxSubSteps: 4,
    signal: opts.signal,
    callbacks: opts.callbacks,
    trackModifiedPaths: modifiedPaths,
    loopBreaker,
    turnBudget,
  });

  allToolEvents.push(...architectTurn.toolEvents);
  totalSteps += architectTurn.steps;
  fullOutput += architectTurn.text;

  // Track task IDs created by architect
  for (const evt of architectTurn.toolEvents) {
    if (evt.name === "task_add" && evt.status === "done" && evt.summary) {
      const match = evt.summary.match(/#(\d+)/);
      if (match) createdTaskIds.push(Number(match[1]));
    }
  }

  if (opts.signal?.aborted) {
    return { finalText: fullOutput, toolEvents: allToolEvents, steps: totalSteps, decidedMode: "plan" };
  }

  // ----------------------------------------------------
  // PHASE 2: BUILDER (Implementation)
  // ----------------------------------------------------
  opts.callbacks?.onPhaseChange?.("builder", "Executing planned steps & implementing changes...");
  opts.callbacks?.onTextDelta?.("\n\n### 🛠️ Phase 2: Builder Execution\n\n");
  fullOutput += "\n\n### 🛠️ Phase 2: Builder Execution\n\n";

  const builderPrompt = [
    buildSystemPrompt({
      mode: "builder",
      session: opts.session,
      store: opts.store,
      fsManager: opts.fsManager,
      latestUserPrompt: opts.userInput,
      userInstructions: opts.userInstructions,
    }),
    "",
    "## YOUR ROLE: BUILDER",
    "You are the BUILDER in Oro's Triad Orchestrator.",
    "Your objective is direct, concrete execution of the Architect's plan.",
    "- Use `read_file` to inspect existing code or note templates.",
    "- Use `edit_file` with tight 3-8 line targets for modifications.",
    "- Use `write_file` only when creating new files from scratch.",
    "- Complete all tasks specified in the plan with production-ready code.",
  ].join("\n");

  const builderMessages: LLMMessage[] = [
    { role: "user", content: opts.userInput },
    { role: "assistant", content: `Here is the Architect's plan:\n\n${architectTurn.text}` },
    { role: "user", content: "Proceed with full implementation of all steps. Begin immediately." },
  ];

  const builderTurn = await executeSubTurn({
    systemPrompt: builderPrompt,
    messages: builderMessages,
    provider: opts.provider,
    store: opts.store,
    fsManager: opts.fsManager,
    session: opts.session,
    maxSubSteps: 10,
    signal: opts.signal,
    callbacks: opts.callbacks,
    trackModifiedPaths: modifiedPaths,
    loopBreaker,
    turnBudget,
  });

  allToolEvents.push(...builderTurn.toolEvents);
  totalSteps += builderTurn.steps;
  fullOutput += builderTurn.text;

  if (opts.signal?.aborted) {
    return { finalText: fullOutput, toolEvents: allToolEvents, steps: totalSteps, decidedMode: "builder" };
  }

  // ----------------------------------------------------
  // PHASE 3: CRITIC & VERIFIER (Quality Gate & Self-Correction)
  // ----------------------------------------------------
  opts.callbacks?.onPhaseChange?.("critic", "Verifying files, syntax, and task completion...");
  opts.callbacks?.onTextDelta?.("\n\n### 🔍 Phase 3: Critic & Verifier\n\n");
  fullOutput += "\n\n### 🔍 Phase 3: Critic & Verifier\n\n";

  let verificationPassed = false;
  let verificationAttempt = 0;
  const maxCorrectionAttempts = 2;

  while (!verificationPassed && verificationAttempt <= maxCorrectionAttempts) {
    verificationAttempt++;

    // 1. Run automated diagnostics (syntax, JSON, python, markdown)
    const diag = runAutomatedDiagnostics(opts.fsManager.workspaceRoot, Array.from(modifiedPaths));

    if (!diag.ok) {
      const errorMsg = `Automated diagnostic detected issues:\n${diag.errors.join("\n")}`;
      opts.callbacks?.onVerification?.({ passed: false, message: errorMsg, attempt: verificationAttempt });

      if (verificationAttempt <= maxCorrectionAttempts) {
        opts.callbacks?.onTextDelta?.(`⚠️ *Critic detected diagnostic issues (Attempt ${verificationAttempt}/${maxCorrectionAttempts}):*\n\`\`\`\n${diag.errors.join("\n")}\n\`\`\`\n*Builder self-correcting...*\n\n`);
        fullOutput += `⚠️ *Critic detected diagnostic issues:*\n\`\`\`\n${diag.errors.join("\n")}\n\`\`\`\n`;

        // Builder correction turn
        const fixMessages: LLMMessage[] = [
          ...builderMessages,
          {
            role: "user",
            content: `The Critic automated verification failed with these errors:\n${diag.errors.join("\n")}\nFix these issues immediately using edit_file.`,
          },
        ];

        const fixTurn = await executeSubTurn({
          systemPrompt: builderPrompt,
          messages: fixMessages,
          provider: opts.provider,
          store: opts.store,
          fsManager: opts.fsManager,
          session: opts.session,
          maxSubSteps: 5,
          signal: opts.signal,
          callbacks: opts.callbacks,
          trackModifiedPaths: modifiedPaths,
          loopBreaker,
          turnBudget,
        });

        allToolEvents.push(...fixTurn.toolEvents);
        totalSteps += fixTurn.steps;
        fullOutput += fixTurn.text;
        continue; // Re-run verifier
      }
    }

    // 2. High-level Critic evaluation pass
    const modifiedList = Array.from(modifiedPaths).join(", ") || "(none)";
    const criticPrompt = [
      TOKEN_EFFICIENCY_DIRECTIVES,
      "You are the CRITIC in Oro's Triad Orchestrator.",
      "Review the implementation against the original goal.",
      `User Goal: "${opts.userInput}"`,
      `Files Modified: ${modifiedList}`,
      "Evaluate whether deliverables are complete, functional, and clean.",
      "If complete and correct, respond: '✓ VERIFIED: <1-sentence confirmation>'",
      "If critical flaws or unaddressed requirements remain, respond: 'ISSUE: <specific flaw>'",
    ].join("\n");

    const criticMessages: LLMMessage[] = [
      { role: "user", content: `Review deliverables for goal: "${opts.userInput}". Modified: ${modifiedList}` },
    ];

    let criticVerdict = "";
    for await (const event of opts.provider.streamChat({
      systemPrompt: criticPrompt,
      messages: criticMessages,
      tools: [],
      signal: opts.signal,
    })) {
      if (event.type === "text") {
        criticVerdict += event.delta;
      }
    }

    if (criticVerdict.includes("ISSUE:") && verificationAttempt <= maxCorrectionAttempts) {
      const issue = criticVerdict.trim();
      opts.callbacks?.onVerification?.({ passed: false, message: issue, attempt: verificationAttempt });
      opts.callbacks?.onTextDelta?.(`⚠️ *Critic noted:* ${issue}\n*Builder resolving...*\n\n`);
      fullOutput += `⚠️ *Critic noted:* ${issue}\n`;

      const fixTurn = await executeSubTurn({
        systemPrompt: builderPrompt,
        messages: [
          ...builderMessages,
          { role: "user", content: `Critic review identified this issue: ${issue}\nPlease resolve it.` },
        ],
        provider: opts.provider,
        store: opts.store,
        fsManager: opts.fsManager,
        session: opts.session,
        maxSubSteps: 4,
        signal: opts.signal,
        callbacks: opts.callbacks,
        trackModifiedPaths: modifiedPaths,
      });

      allToolEvents.push(...fixTurn.toolEvents);
      totalSteps += fixTurn.steps;
      fullOutput += fixTurn.text;
    } else {
      verificationPassed = true;
      const passMsg = criticVerdict.trim() || "✓ All deliverables verified successfully.";
      opts.callbacks?.onVerification?.({ passed: true, message: passMsg, attempt: verificationAttempt });
      opts.callbacks?.onTextDelta?.(`\n${passMsg}\n`);
      fullOutput += `\n${passMsg}\n`;
    }
  }

  // ----------------------------------------------------
  // PHASE 4: KNOWLEDGE DISTILLATION & SECOND BRAIN CHECK-OFF
  // ----------------------------------------------------
  // Mark all tasks created by the architect as completed [x] in the Second Brain
  for (const taskId of createdTaskIds) {
    opts.store.toggleTask(taskId, true);
  }

  opts.callbacks?.onPhaseChange?.("done", "Triad workflow completed.");
  const completionSummary = `\n---\n**Triad Orchestration Summary**: Completed in ${totalSteps} steps. Modified ${modifiedPaths.size} file(s). ${createdTaskIds.length} Second Brain task(s) verified & completed.`;
  opts.callbacks?.onTextDelta?.(completionSummary);
  fullOutput += completionSummary;

  // Persist final assistant message
  opts.store.addMessage({
    sessionId: opts.session.id,
    role: "assistant",
    content: fullOutput,
  });

  return {
    finalText: fullOutput,
    toolEvents: allToolEvents,
    steps: totalSteps,
    decidedMode: "builder",
  };
}

/**
 * Auto-Debug & Improve Loop:
 * Automatically cycles between:
 * Build ↔ Diagnostic ↔ Self-Heal ↔ Optimize
 * until all deliverables and files are 100% verified.
 */
export interface AutoDebugLoopResult {
  ok: boolean;
  cycles: number;
  output: string;
  toolEvents: ToolCallEvent[];
  steps: number;
}

export async function runAutoDebugLoop(opts: {
  workspaceRoot: string;
  modifiedPaths: Set<string>;
  store: OroStore;
  fsManager: VaultFsManager;
  sessionId: string;
  provider: LLMProvider;
  userGoal: string;
  signal?: AbortSignal;
  callbacks?: TriadCallbacks;
  maxCycles?: number;
}): Promise<AutoDebugLoopResult> {
  const maxCycles = opts.maxCycles ?? 4;
  let cycle = 0;
  let isFullyVerified = false;
  let output = "";
  const toolEvents: ToolCallEvent[] = [];
  let steps = 0;

  // If no files were modified (e.g. conversational question), confirm deliverables directly
  if (opts.modifiedPaths.size === 0) {
    const verifiedMsg = "✓ Deliverables verified: Clean workspace state, no file alterations required.";
    opts.callbacks?.onVerification?.({ passed: true, message: verifiedMsg, attempt: 1 });
    opts.callbacks?.onTextDelta?.(`\n${verifiedMsg}\n`);
    return { ok: true, cycles: 1, output: `\n${verifiedMsg}\n`, toolEvents: [], steps: 0 };
  }

  while (!isFullyVerified && cycle < maxCycles) {
    cycle++;
    if (opts.signal?.aborted) break;

    const cycleNotice = `\n🔄 **Auto-Debug & Improve: Cycle ${cycle}/${maxCycles}**\n`;
    opts.callbacks?.onTextDelta?.(cycleNotice);
    output += cycleNotice;

    // ----------------------------------------------------
    // STEP 1: DIAGNOSTIC PASS
    // ----------------------------------------------------
    opts.callbacks?.onPhaseChange?.("critic", `Cycle ${cycle}: Running automated diagnostics...`);
    const diag = runAutomatedDiagnostics(opts.workspaceRoot, Array.from(opts.modifiedPaths));

    if (!diag.ok) {
      // ----------------------------------------------------
      // STEP 2: SELF-HEAL PASS (If diagnostics failed)
      // ----------------------------------------------------
      const errorMsg = diag.errors.join("\n");
      opts.callbacks?.onVerification?.({
        passed: false,
        message: `Diagnostic issues detected:\n${errorMsg}`,
        attempt: cycle,
      });

      const healNotice = `> [!WARNING]\n> **Diagnostic Flaws Detected:**\n\`\`\`\n${errorMsg}\n\`\`\`\n> *Dispatching Debugger / Self-Healer subagent to apply pinpoint fixes...*\n\n`;
      opts.callbacks?.onTextDelta?.(healNotice);
      output += healNotice;

      const healResult = await executeTool("spawn_subagent", {
        role: "Debugger / Self-Healer",
        task: `Repair syntax & diagnostic errors in modified files:\n${errorMsg}\nUse read_file to inspect line numbers and edit_file with precise targets to eliminate the errors cleanly.`,
        modelTier: "standard",
      }, {
        store: opts.store,
        fsManager: opts.fsManager,
        sessionId: opts.sessionId,
        provider: opts.provider,
        signal: opts.signal,
        onSubagentProgress: opts.callbacks?.onSubagentProgress,
        onVaultMutated: () => opts.callbacks?.onVaultMutated?.(),
      });

      steps++;
      output += `*Self-Heal Result:* ${healResult.summary}\n`;
      opts.callbacks?.onTextDelta?.(`*Self-Heal Result:* ${healResult.summary}\n`);
      continue; // Re-evaluate diagnostics on next cycle
    }

    // Diagnostics passed cleanly!
    opts.callbacks?.onTextDelta?.(`✓ *Diagnostics Passed (0 errors across ${opts.modifiedPaths.size} file(s)).*\n`);
    output += `✓ *Diagnostics Passed (0 errors across ${opts.modifiedPaths.size} file(s)).*\n`;

    // ----------------------------------------------------
    // STEP 3: OPTIMIZE & CRITIQUE PASS
    // ----------------------------------------------------
    opts.callbacks?.onPhaseChange?.("critic", `Cycle ${cycle}: Reviewing code quality & checking optimization opportunities...`);
    const modifiedList = Array.from(opts.modifiedPaths).join(", ");

    const criticPrompt = [
      TOKEN_EFFICIENCY_DIRECTIVES,
      "You are the Quality Critic & Optimizer in Oro's Autonomous Orchestrator.",
      "Review the modified files against the user's objective.",
      `User Goal: "${opts.userGoal}"`,
      `Modified Files: ${modifiedList}`,
      "",
      "Evaluate whether deliverables are complete, functional, robust, and clean.",
      "- If optimizations are needed (e.g. edge-case handling, missing error check, markdown formatting, link verification):",
      "  Respond: 'OPTIMIZE: <specific 1-line improvement needed>'",
      "- If fully complete, high quality, and meets the goal 100%:",
      "  Respond: 'VERIFIED: <1-sentence confirmation>'",
    ].join("\n");

    let criticVerdict = "";
    for await (const chunk of opts.provider.streamChat({
      systemPrompt: criticPrompt,
      messages: [{ role: "user", content: `Evaluate deliverables for goal: "${opts.userGoal}". Files: ${modifiedList}` }],
      tools: [],
      signal: opts.signal,
    })) {
      if (chunk.type === "text") {
        criticVerdict += chunk.delta;
      }
    }

    criticVerdict = criticVerdict.trim();

    if (criticVerdict.includes("OPTIMIZE:") && cycle < maxCycles) {
      const optSuggestion = criticVerdict.replace(/^.*OPTIMIZE:/s, "").trim();
      const optNotice = `> [!TIP]\n> **Optimizer Recommendation:** ${optSuggestion}\n> *Dispatching Optimizer subagent to implement refinement...*\n\n`;
      opts.callbacks?.onTextDelta?.(optNotice);
      output += optNotice;

      const optResult = await executeTool("spawn_subagent", {
        role: "Optimizer / Code Refiner",
        task: `Apply refinement to ${modifiedList}: ${optSuggestion}. Use edit_file to implement targeted cleanups.`,
        modelTier: "standard",
      }, {
        store: opts.store,
        fsManager: opts.fsManager,
        sessionId: opts.sessionId,
        provider: opts.provider,
        signal: opts.signal,
        onSubagentProgress: opts.callbacks?.onSubagentProgress,
        onVaultMutated: () => opts.callbacks?.onVaultMutated?.(),
      });

      steps++;
      output += `*Optimization Applied:* ${optResult.summary}\n`;
      opts.callbacks?.onTextDelta?.(`*Optimization Applied:* ${optResult.summary}\n`);
      continue; // Re-verify diagnostics and build after optimization
    } else {
      isFullyVerified = true;
      const passText = criticVerdict.replace(/^.*VERIFIED:/s, "").trim() || "All deliverables 100% verified and complete.";
      opts.callbacks?.onVerification?.({
        passed: true,
        message: `✓ 100% Verified: ${passText}`,
        attempt: cycle,
      });

      const passBanner = `> [!IMPORTANT]\n> **✓ Build 100% Verified:** ${passText}\n`;
      opts.callbacks?.onTextDelta?.(passBanner);
      output += passBanner;
    }
  }

  return {
    ok: isFullyVerified,
    cycles: cycle,
    output,
    toolEvents,
    steps,
  };
}

/**
 * Standard Autonomous Run:
 * Executes the structured 3-phase autonomous pipeline:
 * Phase 1: PLAN (Scout architecture, setup Second Brain milestone tasks via task_add)
 * Phase 2: BUILD (Implementation, micro-diffs via edit_file, file creation via write_file)
 * Phase 3: VERIFY (Auto-Debug & Improve Loop: Build ↔ Diagnostic ↔ Self-Heal ↔ Optimize until 100% verified)
 */
export async function runAutonomousOrchestrator(opts: OrchestratorOptions): Promise<AgentRunResult> {
  const allToolEvents: ToolCallEvent[] = [];
  const modifiedPaths = new Set<string>();
  const createdTaskIds: number[] = [];
  let totalSteps = 0;
  let fullOutput = "";

  // 1. Record user message in store
  opts.store.addMessage({
    sessionId: opts.session.id,
    role: "user",
    content: opts.userInput,
  });

  // ====================================================
  // PHASE 1: PLAN (Scout, Architecture & Milestone Breakdown)
  // ====================================================
  opts.callbacks?.onPhaseChange?.("architect", "Phase 1: Planning milestones & scouting architecture...");
  const planBanner = "### 🧭 Phase 1: Plan\n\n";
  opts.callbacks?.onTextDelta?.(planBanner);
  fullOutput += planBanner;

  const planPrompt = [
    buildSystemPrompt({
      mode: "plan",
      session: opts.session,
      store: opts.store,
      fsManager: opts.fsManager,
      latestUserPrompt: opts.userInput,
      userInstructions: opts.userInstructions,
    }),
    "",
    "## AUTONOMOUS CENTRAL ORCHESTRATOR: PHASE 1 (PLAN)",
    "You are the Lead Strategic Planner in Oro's Autonomous Central Orchestrator.",
    "Your objective:",
    "1. Deconstruct the user's goal into 2 to 4 actionable, concrete milestones.",
    "2. Use `task_add` to record EACH milestone into the Second Brain so progress is visible.",
    "3. If inspecting existing files or note relationships, spawn a 'Planner / Scout' subagent via `spawn_subagent` to explore structure concisely.",
    "4. Output a clear, structured roadmap specifying the files to create/modify and technical approach.",
    "Do not write full implementation code in this planning phase.",
  ].join("\n");

  const planMessages: LLMMessage[] = [
    { role: "user", content: opts.userInput },
  ];

  const planTurn = await executeSubTurn({
    systemPrompt: planPrompt,
    messages: planMessages,
    provider: opts.provider,
    store: opts.store,
    fsManager: opts.fsManager,
    session: opts.session,
    maxSubSteps: 5,
    tools: ORCHESTRATOR_TOOLS,
    signal: opts.signal,
    callbacks: opts.callbacks,
    trackModifiedPaths: modifiedPaths,
  });

  allToolEvents.push(...planTurn.toolEvents);
  totalSteps += planTurn.steps;
  fullOutput += planTurn.text;

  // Track task IDs created in Plan phase
  for (const evt of planTurn.toolEvents) {
    if (evt.name === "task_add" && evt.status === "done" && evt.summary) {
      const match = evt.summary.match(/#(\d+)/);
      if (match) createdTaskIds.push(Number(match[1]));
    }
  }

  if (opts.signal?.aborted) {
    return { finalText: fullOutput, toolEvents: allToolEvents, steps: totalSteps, decidedMode: "plan" };
  }

  // ====================================================
  // PHASE 2: BUILD (Implementation & Execution)
  // ====================================================
  opts.callbacks?.onPhaseChange?.("builder", "Phase 2: Building deliverables & applying edits...");
  const buildBanner = "\n\n### 🛠️ Phase 2: Build\n\n";
  opts.callbacks?.onTextDelta?.(buildBanner);
  fullOutput += buildBanner;

  const buildPrompt = [
    buildSystemPrompt({
      mode: "builder",
      session: opts.session,
      store: opts.store,
      fsManager: opts.fsManager,
      latestUserPrompt: opts.userInput,
      userInstructions: opts.userInstructions,
    }),
    "",
    "## AUTONOMOUS CENTRAL ORCHESTRATOR: PHASE 2 (BUILD)",
    "You are the Lead Builder in Oro's Autonomous Central Orchestrator.",
    "Your objective:",
    "1. Execute the milestones established in Phase 1.",
    "2. Delegate heavy coding or note writes to a 'Builder / Coder' subagent via `spawn_subagent`, or directly apply changes.",
    "3. Apply targeted micro-diff edits with `edit_file` whenever modifying existing files.",
    "4. Use `write_file` only when creating new files from scratch.",
    "5. When a milestone task is finished, use `task_toggle` to mark it completed [x].",
    "Complete all implementation deliverables cleanly and thoroughly.",
  ].join("\n");

  const buildMessages: LLMMessage[] = [
    { role: "user", content: opts.userInput },
    { role: "assistant", content: `Architect Plan:\n\n${planTurn.text}` },
    { role: "user", content: "Proceed with Phase 2 (Build). Implement all deliverables immediately." },
  ];

  const buildTurn = await executeSubTurn({
    systemPrompt: buildPrompt,
    messages: buildMessages,
    provider: opts.provider,
    store: opts.store,
    fsManager: opts.fsManager,
    session: opts.session,
    maxSubSteps: opts.maxSteps ?? 10,
    tools: [
      ...ORCHESTRATOR_TOOLS,
      ...BUILDER_TOOLS.filter((bt) => !ORCHESTRATOR_TOOLS.some((ot) => ot.name === bt.name)),
    ],
    signal: opts.signal,
    callbacks: opts.callbacks,
    trackModifiedPaths: modifiedPaths,
  });

  allToolEvents.push(...buildTurn.toolEvents);
  totalSteps += buildTurn.steps;
  fullOutput += buildTurn.text;

  if (opts.signal?.aborted) {
    return { finalText: fullOutput, toolEvents: allToolEvents, steps: totalSteps, decidedMode: "builder" };
  }

  // ====================================================
  // PHASE 3: VERIFY with AUTO-DEBUG & IMPROVE LOOP
  // Build ↔ Diagnostic ↔ Self-Heal ↔ Optimize
  // ====================================================
  opts.callbacks?.onPhaseChange?.("critic", "Phase 3: Auto-Debug & Improve verification loop...");
  const verifyBanner = "\n\n### 🔍 Phase 3: Auto-Debug, Self-Heal & Verify\n\n";
  opts.callbacks?.onTextDelta?.(verifyBanner);
  fullOutput += verifyBanner;

  const autoDebugResult = await runAutoDebugLoop({
    workspaceRoot: opts.fsManager.workspaceRoot,
    modifiedPaths,
    store: opts.store,
    fsManager: opts.fsManager,
    sessionId: opts.session.id,
    provider: opts.provider,
    userGoal: opts.userInput,
    signal: opts.signal,
    callbacks: opts.callbacks,
    maxCycles: 4,
  });

  allToolEvents.push(...autoDebugResult.toolEvents);
  totalSteps += autoDebugResult.steps;
  fullOutput += autoDebugResult.output;

  // Complete any remaining registered milestone tasks
  for (const taskId of createdTaskIds) {
    opts.store.toggleTask(taskId, true);
  }

  opts.callbacks?.onPhaseChange?.("done", "Autonomous run complete and 100% verified.");

  const summaryFooter = `\n\n---\n**Autonomous Run Completed**: 3-Phase Execution (Plan → Build → Verify) finished in ${totalSteps} steps. Verified ${modifiedPaths.size} file(s) across ${autoDebugResult.cycles} auto-debug cycle(s).`;
  opts.callbacks?.onTextDelta?.(summaryFooter);
  fullOutput += summaryFooter;

  // Persist assistant message in store
  opts.store.addMessage({
    sessionId: opts.session.id,
    role: "assistant",
    content: fullOutput,
  });

  return {
    finalText: fullOutput,
    toolEvents: allToolEvents,
    steps: totalSteps,
    decidedMode: "builder",
  };
}
