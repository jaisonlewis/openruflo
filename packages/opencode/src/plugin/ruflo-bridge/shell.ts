/**
 * Shared shell helpers used by every subsystem in the bridge.
 *
 * Kept in its own file so unit tests can exercise quoting/timeout logic
 * without standing up the whole plugin.
 */

/** Minimal subset of the opencode plugin context we use. */
export interface OcContext {
  /** Bun-style shell tagged template — opencode injects this. */
  $: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
  /** opencode SDK client. */
  client: {
    app?: {
      log?: (args: {
        service: string;
        level: 'debug' | 'info' | 'warn' | 'error';
        message: string;
        extra?: Record<string, unknown>;
      }) => Promise<void> | void;
    };
  };
  project?: { id?: string; root?: string; vcs?: string };
  directory?: string;
  worktree?: string;
  serverUrl?: URL;
}

/** Outcome of a single hook invocation. */
export interface HookResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  threw: boolean;
}

/** Logger handle returned by makeLogger — never throws even if logging fails. */
export interface Logger {
  debug: (message: string, extra?: Record<string, unknown>) => Promise<void>;
  info: (message: string, extra?: Record<string, unknown>) => Promise<void>;
  warn: (message: string, extra?: Record<string, unknown>) => Promise<void>;
  error: (message: string, extra?: Record<string, unknown>) => Promise<void>;
}

/** Build a logger that swallows its own failures. */
export function makeLogger(ctx: OcContext, service = 'ruflo-bridge'): Logger {
  const dispatch = async (
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    extra?: Record<string, unknown>,
  ): Promise<void> => {
    try {
      await ctx.client?.app?.log?.({ service, level, message, extra });
    } catch {
      // Logging is best-effort.
    }
  };
  return {
    debug: (m, e) => dispatch('debug', m, e),
    info: (m, e) => dispatch('info', m, e),
    warn: (m, e) => dispatch('warn', m, e),
    error: (m, e) => dispatch('error', m, e),
  };
}

/**
 * Quote a string for safe POSIX shell interpolation.
 * Wraps in single quotes; escapes embedded single quotes.
 */
export function shellQuote(s: string): string {
  if (!s) return "''";
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Run a command via the opencode `$` template, with a hard timeout and full
 * result capture. Never throws; returns a HookResult.
 *
 * `argv` is passed as a Bun shell array expansion (`ctx.$\`${argv}\``).
 * Bun treats each element as a separate word — no shell quoting needed and
 * paths with spaces are handled correctly regardless of platform.
 */
export async function runShell(
  ctx: OcContext,
  argv: string[],
  timeoutMs: number,
  log: Logger,
): Promise<HookResult> {
  if (argv.length === 0) {
    return { exitCode: 0, stdout: '', stderr: '', timedOut: false, threw: false };
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    const exec = ctx.$`${argv}`.then(
      (r): HookResult => ({
        exitCode: r.exitCode,
        stdout: r.stdout,
        stderr: r.stderr,
        timedOut: false,
        threw: false,
      }),
    );
    const timeout = new Promise<HookResult>((resolve) => {
      timeoutHandle = setTimeout(
        () =>
          resolve({
            exitCode: 124,
            stdout: '',
            stderr: '',
            timedOut: true,
            threw: false,
          }),
        timeoutMs,
      );
    });
    return await Promise.race([exec, timeout]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await log.error(`shell threw: ${message}`, { command: argv.join(' ') });
    return {
      exitCode: 1,
      stdout: '',
      stderr: message,
      timedOut: false,
      threw: true,
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/**
 * Stringify opencode message content. Content can be a string OR an array
 * of typed parts. Best-effort: unknown shapes degrade to ''.
 */
export function stringifyMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in (part as object)) {
          const t = (part as { text?: unknown }).text;
          return typeof t === 'string' ? t : '';
        }
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }
  return '';
}
