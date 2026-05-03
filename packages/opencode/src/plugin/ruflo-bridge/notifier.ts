/**
 * Cross-platform notification dispatcher.
 *
 * Claude Code has a built-in Notification hook that fires when the assistant
 * needs the user's attention (permission requests, idle prompts, errors).
 * opencode has no native equivalent, but it does emit `permission.asked`
 * and `session.error` — the two events that most often warrant a notification
 * in the Claude Code workflow.
 *
 * This module provides a single `notify()` function that writes a desktop
 * notification using the OS's native CLI:
 *
 *   linux  → notify-send
 *   darwin → osascript (display notification ...)
 *   win32  → powershell BurntToast or fallback to msg
 *
 * On any failure we fall back to writing to stderr — the user will still see
 * something, and the bridge never blocks on notification dispatch.
 */
import type { OcContext, Logger } from './shell';
import { runShell } from './shell';

export interface NotifyOptions {
  title: string;
  body: string;
  /** 'low' | 'normal' | 'critical'. Maps to OS-specific urgency. */
  urgency?: 'low' | 'normal' | 'critical';
  /** Per-notification timeout in ms. Default 5000. */
  timeoutMs?: number;
}

/** Detect the current platform once, cache the result. */
let cachedPlatform: NodeJS.Platform | undefined;
function platform(): NodeJS.Platform {
  if (!cachedPlatform) cachedPlatform = process.platform;
  return cachedPlatform;
}

/** For tests: override the detected platform. */
export function __setPlatformForTesting(p: NodeJS.Platform | undefined): void {
  cachedPlatform = p;
}

/**
 * Build the platform-specific notification argv array.
 * Returns [] for unknown platforms (runShell treats [] as a no-op).
 * Each element is passed verbatim as a separate process argument — no shell
 * quoting needed.
 */
export function buildNotifyCommand(
  plat: NodeJS.Platform,
  opts: NotifyOptions,
): string[] {
  const title = opts.title;
  const body = opts.body;
  const urgency = opts.urgency ?? 'normal';

  switch (plat) {
    case 'linux':
      return ['notify-send', '-u', urgency, title, body];

    case 'darwin': {
      const safeBody = quoteForAppleScript(body);
      const safeTitle = quoteForAppleScript(title);
      return ['osascript', '-e', `display notification "${safeBody}" with title "${safeTitle}"`];
    }

    case 'win32': {
      const safeTitle = title.replace(/"/g, '`"');
      const safeBody = body.replace(/"/g, '`"');
      return [
        'powershell', '-NoProfile', '-Command',
        `if (Get-Module -ListAvailable BurntToast) { New-BurntToastNotification -Text '${safeTitle}','${safeBody}' } else { Write-Host '[ruflo] ${safeTitle}: ${safeBody}' }`,
      ];
    }

    default:
      return [];
  }
}

/** AppleScript needs both backslash and double-quote escapes. */
function quoteForAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Send a notification. Always resolves; never throws.
 * Logs the failure and falls back to stderr if the OS command fails.
 */
export async function notify(
  ctx: OcContext,
  log: Logger,
  opts: NotifyOptions,
): Promise<{ delivered: boolean; method: 'os' | 'stderr' | 'noop' }> {
  const plat = platform();
  const argv = buildNotifyCommand(plat, opts);

  if (argv.length === 0) {
    await log.warn('no notification backend for platform', { platform: plat });
    process.stderr.write(`[ruflo] ${opts.title}: ${opts.body}\n`);
    return { delivered: true, method: 'stderr' };
  }

  const result = await runShell(ctx, argv, opts.timeoutMs ?? 5000, log);
  if (result.exitCode === 0 && !result.threw && !result.timedOut) {
    return { delivered: true, method: 'os' };
  }

  // OS command failed — fall back to stderr.
  await log.warn('notification command failed; falling back to stderr', {
    platform: plat,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
  });
  process.stderr.write(`[ruflo] ${opts.title}: ${opts.body}\n`);
  return { delivered: true, method: 'stderr' };
}
