/**
 * Statusline replacement — three strategies, user picks one in opencode.json.
 *
 * opencode owns its statusline and provides no extension hook.
 * We provide three substitute strategies:
 *
 *   1. 'command'   — Register a `/ruflo-status` slash command (pure pull).
 *   2. 'daemon'    — Spawn a background `ruflo statusline write` process.
 *   3. 'footer'    — Inject a system prompt instruction via
 *                    `experimental.chat.system.transform` telling the
 *                    model to append a status block to every response.
 *   'off'          — disabled.
 */
import type { OcContext, Logger } from './shell';
import { runShell } from './shell';

export type StatuslineStrategy = 'off' | 'command' | 'daemon' | 'footer';

export interface StatuslineOptions {
  cliCommand: string;
  cliArgs: string[];
  timeoutMs: number;
  strategy: StatuslineStrategy;
  daemonOutputPath: string;
  daemonIntervalMs: number;
}

export const DEFAULT_STATUSLINE_OPTIONS: Omit<StatuslineOptions, 'cliCommand' | 'cliArgs' | 'timeoutMs'> = {
  strategy: 'command',
  daemonOutputPath: '~/.ruflo/statusline.txt',
  daemonIntervalMs: 2000,
};

export class Statusline {
  private readonly ctx: OcContext;
  private readonly log: Logger;
  private readonly options: StatuslineOptions;
  private daemonStarted = false;
  private daemonAbort: AbortController | undefined;
  private stopped = false;

  constructor(ctx: OcContext, log: Logger, options: StatuslineOptions) {
    this.ctx = ctx;
    this.log = log;
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.stopped) return;
    switch (this.options.strategy) {
      case 'off':
      case 'command':
      case 'footer':
        return;
      case 'daemon':
        await this.startDaemon();
        return;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.daemonAbort) {
      this.daemonAbort.abort();
      this.daemonAbort = undefined;
    }
    this.daemonStarted = false;
  }

  /**
   * Called from the `experimental.chat.system.transform` hook handler.
   * Appends the statusline instruction to the system prompt array.
   * Only mutates when the 'footer' strategy is active.
   *
   * Returns true if it modified the system array.
   */
  decorateSystemPrompt(system: string[]): boolean {
    if (this.options.strategy !== 'footer') return false;

    const marker = '[ruflo-statusline] After your response, append a single fenced "status" code block of the form:\n```status\nagents: <n> | queue: <n> | task: <short>\n```';

    const alreadyPresent = system.some((s) => s.includes('[ruflo-statusline]'));
    if (alreadyPresent) return false;

    system.push(marker);
    return true;
  }

  private async startDaemon(): Promise<void> {
    if (this.daemonStarted) return;
    this.daemonAbort = new AbortController();
    this.daemonStarted = true;

    const intervalSec = Math.max(1, Math.round(this.options.daemonIntervalMs / 1000));
    const argv = [
      this.options.cliCommand,
      ...this.options.cliArgs,
      'statusline',
      'write',
      '--to',
      this.options.daemonOutputPath,
      '--interval',
      `${intervalSec}s`,
    ];

    void runShell(this.ctx, argv, 24 * 60 * 60 * 1000, this.log).then(
      (result) => {
        if (!this.stopped && result.exitCode !== 0) {
          this.log.warn('statusline daemon exited unexpectedly', {
            exitCode: result.exitCode,
            stderr: result.stderr.slice(0, 200),
          }).catch(() => undefined);
        }
      },
    );

    await this.log.info('statusline daemon started', {
      to: this.options.daemonOutputPath,
      interval: `${intervalSec}s`,
    });
  }
}
