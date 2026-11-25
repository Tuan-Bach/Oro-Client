import crypto from "node:crypto";
import type { ToolExecutionResult } from "./tools.js";

export interface LoopBreakerOptions {
  /** Maximum consecutive or near-consecutive identical calls allowed before tripping (default 3) */
  maxConsecutiveIdentical?: number;
  /** Size of the sliding history window (default 8) */
  windowSize?: number;
}

export interface CircuitBreakerStatus {
  allowed: boolean;
  reason?: string;
  repetitions: number;
}

/**
 * Deterministically sorts object keys to produce a canonical JSON string for hashing.
 */
export function canonicalizeArgs(args: unknown): string {
  if (args === null || typeof args !== "object") {
    return JSON.stringify(args);
  }
  if (Array.isArray(args)) {
    return `[${args.map(canonicalizeArgs).join(",")}]`;
  }
  const keys = Object.keys(args as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalizeArgs((args as Record<string, unknown>)[k])}`
  );
  return `{${entries.join(",")}}`;
}

/**
 * Computes a fast deterministic SHA-256 fingerprint for a tool call.
 */
export function hashToolCall(name: string, args: Record<string, unknown>): string {
  const canonical = `${name}:${canonicalizeArgs(args)}`;
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/**
 * ToolLoopBreaker: Prevents autonomous agents from burning tokens in infinite loops
 * by tracking recent tool call fingerprints and tripping when identical calls repeat.
 */
export class ToolLoopBreaker {
  private readonly maxConsecutive: number;
  private readonly windowSize: number;
  private history: { hash: string; name: string }[] = [];

  constructor(options?: LoopBreakerOptions) {
    this.maxConsecutive = options?.maxConsecutiveIdentical ?? 3;
    this.windowSize = options?.windowSize ?? 8;
  }

  /**
   * Checks whether the given tool call would trip the loop breaker.
   */
  public check(name: string, args: Record<string, unknown>): CircuitBreakerStatus {
    const callHash = hashToolCall(name, args);
    let consecutiveCount = 0;

    // Count consecutive identical calls from the most recent backwards
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i]!.hash === callHash) {
        consecutiveCount++;
      } else {
        break;
      }
    }

    // Also count occurrences in the recent window
    const windowOccurrences = this.history.filter((h) => h.hash === callHash).length;
    const repetitions = Math.max(consecutiveCount + 1, windowOccurrences + 1);

    if (repetitions >= this.maxConsecutive) {
      return {
        allowed: false,
        repetitions,
        reason:
          `Loop Breaker Tripped: Tool "${name}" was invoked ${repetitions} times with identical parameters ` +
          `without forward progress. Step aborted to conserve tokens. Please inspect the target file or adopt an alternative approach.`,
      };
    }

    return { allowed: true, repetitions };
  }

  /**
   * Records a tool call in the ring buffer history after or before execution.
   */
  public record(name: string, args: Record<string, unknown>): CircuitBreakerStatus {
    const status = this.check(name, args);
    const callHash = hashToolCall(name, args);

    this.history.push({ hash: callHash, name });
    if (this.history.length > this.windowSize) {
      this.history.shift();
    }

    return status;
  }

  /**
   * Clears call history (e.g. between user turns).
   */
  public reset(): void {
    this.history = [];
  }

  /**
   * Returns current history length.
   */
  public get historySize(): number {
    return this.history.length;
  }
}

export interface TimeoutOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  toolName?: string;
}

/**
 * Wraps tool execution with a per-tool wall-clock timeout (default 15s).
 * Prevents hanging child processes or blocked I/O from stalling the agent.
 */
export async function executeWithTimeout<T extends ToolExecutionResult>(
  fn: (signal?: AbortSignal) => Promise<T>,
  opts?: TimeoutOptions
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  const toolName = opts?.toolName ?? "tool";

  const ctrl = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort(new Error(`ToolTimeoutError: Tool "${toolName}" timed out after ${timeoutMs}ms.`));
      reject(new Error(`ToolTimeoutError: Tool "${toolName}" timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  const parentListener = () => {
    ctrl.abort(opts?.signal?.reason);
  };
  if (opts?.signal) {
    if (opts.signal.aborted) {
      if (timer) clearTimeout(timer);
      ctrl.abort(opts.signal.reason);
    } else {
      opts.signal.addEventListener("abort", parentListener, { once: true });
    }
  }

  try {
    const result = await Promise.race([fn(ctrl.signal), timeoutPromise]);
    return result;
  } catch (err: unknown) {
    if (ctrl.signal.aborted && !opts?.signal?.aborted) {
      // Internal timeout fired
      return {
        ok: false,
        output: `Tool "${toolName}" timed out after ${timeoutMs}ms. Aborted by Circuit Breaker to prevent hang.`,
        summary: `${toolName} timed out (${Math.round(timeoutMs / 1000)}s)`,
      } as T;
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    if (opts?.signal) {
      opts.signal.removeEventListener("abort", parentListener);
    }
  }
}

export interface TurnBudgetConfig {
  maxSteps?: number;
  maxToolCalls?: number;
  maxTotalChars?: number;
}

/**
 * TurnBudgetCircuitBreaker: Enforces hard resource budgets across an entire turn
 * to prevent runaway token expenditure or unbounded orchestration loops.
 */
export class TurnBudgetCircuitBreaker {
  public totalSteps = 0;
  public totalToolCalls = 0;
  public totalChars = 0;

  private readonly maxSteps: number;
  private readonly maxToolCalls: number;
  private readonly maxTotalChars: number;

  constructor(config?: TurnBudgetConfig) {
    this.maxSteps = config?.maxSteps ?? 25;
    this.maxToolCalls = config?.maxToolCalls ?? 35;
    this.maxTotalChars = config?.maxTotalChars ?? 160_000; // ~40k tokens
  }

  public recordStep(charsProduced = 0, toolCallsInStep = 0): { exceeded: boolean; reason?: string } {
    this.totalSteps++;
    this.totalChars += charsProduced;
    this.totalToolCalls += toolCallsInStep;

    if (this.totalSteps > this.maxSteps) {
      return {
        exceeded: true,
        reason: `Turn Budget Exceeded: Reached step limit (${this.totalSteps}/${this.maxSteps} steps). Finalizing turn.`,
      };
    }
    if (this.totalToolCalls > this.maxToolCalls) {
      return {
        exceeded: true,
        reason: `Turn Budget Exceeded: Reached tool call limit (${this.totalToolCalls}/${this.maxToolCalls} tool calls). Finalizing turn.`,
      };
    }
    if (this.totalChars > this.maxTotalChars) {
      return {
        exceeded: true,
        reason: `Turn Budget Exceeded: Output volume threshold exceeded (~${Math.round(this.totalChars / 4)} tokens). Finalizing turn.`,
      };
    }

    return { exceeded: false };
  }

  public reset(): void {
    this.totalSteps = 0;
    this.totalToolCalls = 0;
    this.totalChars = 0;
  }
}
