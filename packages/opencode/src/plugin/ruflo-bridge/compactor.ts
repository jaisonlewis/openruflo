/**
 * Compaction handler.
 *
 * opencode's real compaction surface (verified from source):
 *
 *   Plugin hook:
 *     experimental.session.compacting  — fires before compaction starts;
 *       input: { sessionID }
 *       output: { context: string[], prompt?: string }  (mutable)
 *       Allows injecting extra context or replacing the compaction prompt.
 *
 *   Bus event:
 *     session.compacted  — fires after compaction completes;
 *       payload: { sessionID }
 *       Received via the generic `event` handler.
 *
 * The port's original assumption of four compaction events
 * (session.compact, session.summarize, session.compaction, session.compacted)
 * was incorrect. Only the two above exist.
 *
 * Mapping to ruflo CLI:
 *   experimental.session.compacting  →  ruflo hooks compact-pre
 *   session.compacted (bus)          →  ruflo hooks compact-post
 */
import type { OcContext, Logger, HookResult } from './shell';
import { runShell } from './shell';

export type CompactPhase = 'pre' | 'post';

export interface CompactorOptions {
  cliCommand: string;
  cliArgs: string[];
  timeoutMs: number;
  enabled: boolean;
}

/** Map a phase to the matching ruflo subcommand. */
function subcommandForPhase(phase: CompactPhase): string {
  switch (phase) {
    case 'pre':
      return 'compact-pre';
    case 'post':
      return 'compact-post';
  }
}

/**
 * Handle a compaction event. Called by the bridge for both the plugin
 * hook (pre) and the bus event (post).
 */
export async function handleCompactEvent(
  ctx: OcContext,
  log: Logger,
  phase: CompactPhase,
  sessionId: string,
  options: CompactorOptions,
): Promise<HookResult | undefined> {
  if (!options.enabled) return undefined;

  const subcommand = subcommandForPhase(phase);
  const argv = [
    options.cliCommand,
    ...options.cliArgs,
    'hooks',
    subcommand,
    '--session-id',
    sessionId,
  ];

  await log.info(`compact ${phase} for session ${sessionId}`);
  return runShell(ctx, argv, options.timeoutMs, log);
}
