import type { AgentModeId } from "../types.js";

export interface AgentModeSpec {
  id: AgentModeId;
  label: string;
  badge: string;
  color: string;
  description: string;
  instructions: string;
}

export const AGENT_MODE_ORDER: AgentModeId[] = ["default", "auto", "plan", "builder"];

/**
 * Automatically classifies user intent into "plan", "builder", or "triad".
 * - Plan: questions, investigations, strategy, brainstorming, architecture, outlines, reviewing
 * - Builder: creating files/folders, writing code, editing, patching, implementing, scaffolding
 * - Triad: complex end-to-end features, full implementation with verification, multi-step pipeline
 */
export function classifyIntent(prompt: string): "plan" | "builder" | "triad" {
  const p = prompt.trim().toLowerCase();

  // Explicit triad / orchestration triggers
  if (
    /\b(triad|orchestrat|swarm|full\s+pipeline|build\s+and\s+verify|implement\s+and\s+test|architect\s+and\s+build)\b/i.test(p) ||
    /\b(end-to-end|from\s+scratch\s+with\s+tests|full\s+implementation\s+and\s+verification)\b/i.test(p)
  ) {
    return "triad";
  }

  // If prompt explicitly asks to plan, explain, analyze, review, brainstorm, research, question
  if (
    /^(how\b|why\b|what\b|can\s+you\s+explain|explain\b|analyze\b|review\b|research\b|audit\b|compare\b|brainstorm\b|give\s+me\s+ideas|summarize\b|outline\b|plan\b)/i.test(p) ||
    /\b(how\s+should|how\s+can|how\s+do|what\s+is|what\s+are|what\s+would|walk\s+me\s+through)\b/i.test(p) ||
    /\b(roadmap|strategy|architecture|trade-?offs?|pros\s+and\s+cons|recommendations?)\b/i.test(p)
  ) {
    if (!/\b(write\s+the\s+code|implement\s+it\s+now|create\s+the\s+file|do\s+it\s+now|apply\s+it)\b/i.test(p)) {
      return "plan";
    }
  }

  // Builder triggers: action commands to build, write, code, fix, edit, create, scaffold, patch
  if (
    /\b(create|make|build|write|implement|scaffold|code|fix|refactor|update|edit|patch|add|delete|remove|generate|setup|set\s+up)\b/i.test(p) ||
    /\b(fix\s+the\s+bug|solve\s+this|write\s+code|add\s+a\s+file|create\s+a\s+file)\b/i.test(p)
  ) {
    return "builder";
  }

  // If asking questions or reflective thoughts -> plan
  if (p.endsWith("?") || /\b(think|consider|opinion|thoughts?)\b/i.test(p)) {
    return "plan";
  }

  return "plan";
}

export function normalizeMode(mode?: string): "default" | "auto" | "plan" | "builder" | "triad" {
  if (mode === "triad" || mode === "auto") return "auto";
  if (mode === "builder") return "builder";
  if (mode === "plan") return "plan";
  if (mode === "default") return "default";
  return "default";
}

export const TRIAD_INSTRUCTIONS = [
  "You are Oro in TRIAD (Orchestrated Swarm: Architect → Builder → Critic) mode.",
  "You operate as an autonomous 3-phase pipeline:",
  "1. ARCHITECT: Break down the goal into 2 to 4 concrete tasks and register them with `task_add`.",
  "2. BUILDER: Execute code modifications and note creation cleanly using `edit_file` and `write_file`.",
  "3. CRITIC & VERIFIER: Inspect deliverables, run diagnostics, and ensure all tests and links pass.",
  "Upon successful verification, check off all tasks in the Second Brain.",
].join("\n");

export const PLAN_INSTRUCTIONS = [
  "You are Oro in PLAN (Strategic Architect & Thinker) mode.",
  "Your focus is deep thinking, researching the vault, designing architectures, organizing notes, and breaking problems into structured roadmaps.",
  "Proactively search notes, inspect file structures, and recall persistent memories before making recommendations.",
  "When creating or updating Markdown notes, use clean YAML frontmatter, clear headings, #tags, and [[wiki-links]].",
  "Avoid making unrequested destructive edits or overwriting code without presenting the plan first.",
].join("\n");

export const BUILDER_INSTRUCTIONS = [
  "You are Oro in BUILDER (Project Executor) mode.",
  "Focus on concrete execution: scaffolding folders, writing clean files and code, applying targeted edit_file patches, and tracking open tasks.",
  "Inspect existing files before editing to match project conventions.",
  "After making changes, summarize exact file paths created or modified and add follow-up tasks if needed.",
].join("\n");

export const AGENT_MODES: Record<AgentModeId, AgentModeSpec> = {
  default: {
    id: "default",
    label: "Default",
    badge: "✦ Default",
    color: "#ffffff",
    description: "Default mode: decides Plan vs Builder based on prompt intent.",
    instructions: [
      "You are Oro in Default mode.",
      "Analyze the user's intent to automatically operate as either PLANNER or BUILDER:",
      "- If the user asks questions, seeks advice, requests research, brainstorming, an architecture outline, or a roadmap: act as PLANNER. Explore vault notes, search memories, and outline structured plans before writing code.",
      "- If the user asks to create, build, implement, code, edit, refactor, or scaffold: act as BUILDER. Directly create/edit files and execute changes.",
      "Always state your resolved mode briefly (e.g. `[Plan]` or `[Builder]`).",
    ].join("\n"),
  },
  auto: {
    id: "auto",
    label: "Auto",
    badge: "⚙ Auto",
    color: "#d2a8ff",
    description: "Autonomous pipeline: Architect plans → Builder executes → Critic verifies.",
    instructions: TRIAD_INSTRUCTIONS,
  },
  plan: {
    id: "plan",
    label: "Plan",
    badge: "○ Plan",
    color: "#79C0FF",
    description: "Strategy & Architect: research vault, outline roadmaps, organize notes, and plan steps.",
    instructions: PLAN_INSTRUCTIONS,
  },
  builder: {
    id: "builder",
    label: "Builder",
    badge: "▸ Builder",
    color: "#7EE787",
    description: "Project Executor: scaffolds folders, writes/edits code, and tracks deliverables.",
    instructions: BUILDER_INSTRUCTIONS,
  },
  triad: {
    id: "triad",
    label: "Auto",
    badge: "⚙ Auto",
    color: "#d2a8ff",
    description: "Autonomous pipeline: Architect plans → Builder executes → Critic verifies.",
    instructions: TRIAD_INSTRUCTIONS,
  },
  // Backward compatibility mappings
  assistant: {
    id: "assistant",
    label: "Plan",
    badge: "○ Plan",
    color: "#79C0FF",
    description: "Strategy & Architect",
    instructions: PLAN_INSTRUCTIONS,
  },
  organizer: {
    id: "organizer",
    label: "Plan",
    badge: "○ Plan",
    color: "#79C0FF",
    description: "Strategy & Architect",
    instructions: PLAN_INSTRUCTIONS,
  },
  researcher: {
    id: "researcher",
    label: "Plan",
    badge: "○ Plan",
    color: "#79C0FF",
    description: "Strategy & Architect",
    instructions: PLAN_INSTRUCTIONS,
  },
};

export function nextAgentMode(current: AgentModeId): AgentModeId {
  const norm = normalizeMode(current);
  const idx = AGENT_MODE_ORDER.indexOf(norm);
  return AGENT_MODE_ORDER[(idx + 1) % AGENT_MODE_ORDER.length]!;
}
