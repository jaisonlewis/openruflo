/**
 * Agent Pool Manager — synthetic TeammateIdle / TaskCompleted.
 *
 * Claude Code emits two events that opencode does NOT:
 *
 *   TeammateIdle    — a subagent has become idle and is available for work
 *   TaskCompleted   — a high-level task (multi-tool, multi-turn) has finished
 *
 * Ruflo uses these to:
 *   - dispatch queued work to the next available subagent
 *   - trigger learning passes after a task completes
 *   - drive the "swarm orchestrator" that coordinates multiple subagents
 *
 * Since opencode has neither event, this module derives them from events
 * that opencode DOES emit (verified against the binary):
 *
 *   tool.execute.after  → may signal task completion (we use a heuristic:
 *                          if no further tool calls arrive within
 *                          `idleThresholdMs`, we treat it as TeammateIdle)
 *   message.updated     → assistant message finalized; if it has no tool_use
 *                          parts and finish_reason === 'stop', that's a
 *                          strong TaskCompleted signal
 *   session.idle        → strongest TeammateIdle signal; the whole session
 *                          has gone quiet
 *
 * The pool maintains a small task queue; when an idle signal fires, the next
 * task is dispatched via `ruflo agent-pool dispatch`. When a completion
 * signal fires, `ruflo agent-pool task-completed` runs (which drives the
 * learning pipeline).
 *
 * Two timers ensure correct behavior even when events are noisy:
 *
 *   activityTimer  — debounces tool.execute.after; if no follow-up within
 *                    `idleThresholdMs`, emit synthetic TeammateIdle
 *   queueTimer     — periodically inspects the queue; if non-empty AND the
 *                    bridge thinks the agent is idle, attempts dispatch
 */
import type { OcContext, Logger } from './shell';
import { runShell } from './shell';

export interface AgentPoolOptions {
  cliCommand: string;
  cliArgs: string[];
  timeoutMs: number;
  enabled: boolean;
  /** ms of inactivity before we synthesize a TeammateIdle event. */
  idleThresholdMs: number;
  /** ms between queue-drain attempts. */
  queueIntervalMs: number;
  /** Maximum tasks to keep in queue. Older tasks evicted. */
  maxQueueSize: number;
}

export interface PoolTask {
  id: string;
  prompt: string;
  enqueuedAt: number;
  metadata?: Record<string, unknown>;
}

export type PoolEvent =
  | { type: 'tool.execute.after'; sessionID?: string; tool?: string }
  | { type: 'message.updated'; sessionID?: string; finishReason?: string; hasToolUse?: boolean }
  | { type: 'session.idle'; sessionID?: string };

/** Ruflo CLI subcommand chosen for a pool action. */
type PoolSubcommand = 'dispatch' | 'task-completed' | 'teammate-idle';

/**
 * Stateful pool. ONE instance per opencode plugin lifetime.
 *
 * The pool owns two timers. They are cleared on `stop()`, which the bridge
 * calls in its `hook.destroy` handler.
 */
export class AgentPool {
  private readonly options: AgentPoolOptions;
  private readonly ctx: OcContext;
  private readonly log: Logger;
  private readonly queue: PoolTask[] = [];
  private activityTimer: ReturnType<typeof setTimeout> | undefined;
  private queueTimer: ReturnType<typeof setInterval> | undefined;
  private agentIdle = true;
  private currentSessionId: string | undefined;
  private inFlightDispatch = false;
  private stopped = false;

  constructor(ctx: OcContext, log: Logger, options: AgentPoolOptions) {
    this.ctx = ctx;
    this.log = log;
    this.options = options;
  }

  /** Start the periodic queue drain. Idempotent. */
  start(): void {
    if (this.queueTimer || this.stopped || !this.options.enabled) return;
    this.queueTimer = setInterval(() => {
      this.tryDispatch().catch(() => undefined);
    }, this.options.queueIntervalMs);
    // Don't keep the process alive just for the pool timer.
    if (typeof this.queueTimer.unref === 'function') this.queueTimer.unref();
  }

  /** Stop all timers. Called from hook.destroy. */
  stop(): void {
    this.stopped = true;
    if (this.activityTimer) {
      clearTimeout(this.activityTimer);
      this.activityTimer = undefined;
    }
    if (this.queueTimer) {
      clearInterval(this.queueTimer);
      this.queueTimer = undefined;
    }
  }

  /** Add a task to the queue. Evicts oldest if at capacity. */
  enqueue(task: PoolTask): void {
    if (!this.options.enabled) return;
    if (this.queue.length >= this.options.maxQueueSize) {
      this.queue.shift();
    }
    this.queue.push(task);
  }

  /** For tests / introspection. */
  queueSize(): number {
    return this.queue.length;
  }
  isAgentIdle(): boolean {
    return this.agentIdle;
  }

  /**
   * Notify the pool of an opencode event. Routes to internal handlers and
   * (re)arms the activity timer.
   */
  async observe(event: PoolEvent): Promise<void> {
    if (!this.options.enabled || this.stopped) return;
    if ('sessionID' in event && event.sessionID) {
      this.currentSessionId = event.sessionID;
    }

    switch (event.type) {
      case 'tool.execute.after': {
        // Activity → reset idle timer.
        this.agentIdle = false;
        this.armActivityTimer();
        return;
      }
      case 'message.updated': {
        // Assistant just finalized a message. If it has no tool_use AND
        // finish_reason looks terminal, treat as TaskCompleted.
        const terminal = event.finishReason === 'stop' || event.finishReason === 'end_turn';
        if (terminal && !event.hasToolUse) {
          await this.callPool('task-completed');
          // Task done → also a strong idle signal.
          this.agentIdle = true;
          await this.tryDispatch();
        }
        return;
      }
      case 'session.idle': {
        // Strongest idle signal. Cancel any pending activity timer.
        if (this.activityTimer) {
          clearTimeout(this.activityTimer);
          this.activityTimer = undefined;
        }
        this.agentIdle = true;
        await this.callPool('teammate-idle');
        await this.tryDispatch();
        return;
      }
    }
  }

  /**
   * Arm the inactivity timer. When it fires we synthesize a TeammateIdle
   * event by calling the ruflo CLI.
   */
  private armActivityTimer(): void {
    if (this.activityTimer) clearTimeout(this.activityTimer);
    this.activityTimer = setTimeout(() => {
      this.agentIdle = true;
      this.callPool('teammate-idle')
        .then(() => this.tryDispatch())
        .catch(() => undefined);
    }, this.options.idleThresholdMs);
    if (typeof this.activityTimer.unref === 'function') this.activityTimer.unref();
  }

  /**
   * If the queue has work and the agent is idle, dispatch the next task.
   * Guards against concurrent dispatch calls.
   */
  private async tryDispatch(): Promise<void> {
    if (this.stopped || this.inFlightDispatch) return;
    if (!this.agentIdle || this.queue.length === 0) return;

    this.inFlightDispatch = true;
    try {
      const task = this.queue.shift();
      if (!task) return;
      await this.callPool('dispatch', {
        '--task-id': task.id,
        '--prompt': task.prompt.slice(0, 4000),
        '--enqueued-ms-ago': String(Date.now() - task.enqueuedAt),
      });
      this.agentIdle = false;
      this.armActivityTimer();
    } finally {
      this.inFlightDispatch = false;
    }
  }

  /**
   * Build and run a ruflo hooks command mapped from pool subcommand.
   *
   * ruflo has no `agent-pool` top-level command. The correct mapping is:
   *   dispatch        → `ruflo hooks route`  (-t <prompt>)
   *   task-completed  → `ruflo hooks task-completed`
   *   teammate-idle   → `ruflo hooks teammate-idle`
   */
  private async callPool(
    sub: PoolSubcommand,
    extraArgs: Record<string, string> = {},
  ): Promise<void> {
    // 'dispatch' → 'route'; the other two match ruflo hooks names directly.
    const hooksSub = sub === 'dispatch' ? 'route' : sub;

    const args: string[] = [
      this.options.cliCommand,
      ...this.options.cliArgs,
      'hooks',
      hooksSub,
    ];

    if (this.currentSessionId) {
      args.push('--session-id', this.currentSessionId);
    }

    if (sub === 'dispatch') {
      // ruflo hooks route uses -t <task> for the prompt text.
      if (extraArgs['--prompt']) {
        args.push('-t', extraArgs['--prompt']);
      }
      // Forward task-id for tracing (accepted as --task-id if ruflo supports it).
      if (extraArgs['--task-id']) {
        args.push('--task-id', extraArgs['--task-id']);
      }
    } else {
      for (const [k, v] of Object.entries(extraArgs)) {
        args.push(k, v);
      }
    }

    const result = await runShell(this.ctx, args, this.options.timeoutMs, this.log);
    if (result.exitCode !== 0) {
      await this.log.warn(`agent-pool ${sub} (hooks ${hooksSub}) exited ${result.exitCode}`, {
        timedOut: result.timedOut,
        stderr: result.stderr.slice(0, 200),
      });
    }
  }
}
