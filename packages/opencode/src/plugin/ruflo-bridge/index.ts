/**
 * @ruflo/opencode-plugin — Ruflo ↔ opencode bridge
 *
 * Translates opencode's plugin hook model into `ruflo hooks <subcommand>`
 * shell calls. The CLI-side hook handlers stay 100% unchanged.
 *
 * ============================================================================
 * EVENT MAPPING — verified against opencode source (packages/plugin + core)
 * ============================================================================
 *
 *   opencode hook / event                →  ruflo subcommand
 *   ─────────────────────────────────       ────────────────────
 *   (plugin function body)                  (init: start subsystems)
 *   tool.execute.before                     hooks pre-bash / pre-edit
 *   tool.execute.after                      hooks post-bash / post-edit / post-task
 *   chat.message                            hooks route (user messages only)
 *   experimental.chat.system.transform      statusline footer injection
 *   experimental.session.compacting         hooks compact-pre
 *   permission.ask                          auto-allow mcp__ruflo__*
 *   command.execute.before                  hooks slash-command-run
 *   shell.env                               inject RUFLO env vars
 *   event (bus: session.compacted)          hooks compact-post
 *   event (bus: message.updated)            agent-pool task-completed
 *   event (bus: session.idle/status)        agent-pool teammate-idle
 *   event (bus: session.created)            hooks session-restore
 *   event (bus: session.deleted)            hooks session-end
 *   event (bus: permission.asked)           notifier
 *   event (bus: file.watcher.updated)       hooks file-watcher-updated
 *
 * ============================================================================
 */
import type { Plugin, Hooks } from '@opencode-ai/plugin';
import { makeLogger, runShell, stringifyMessageContent } from './shell';
import type { OcContext } from './shell';
import { handleCompactEvent } from './compactor';
import { AgentPool } from './agent-pool';
import { Statusline, DEFAULT_STATUSLINE_OPTIONS } from './statusline';
import type { StatuslineStrategy } from './statusline';
import { notify } from './notifier';

/** Public options the generated bridge file passes us. */
export interface RufloBridgeOptions {
  cliCommand: string;
  cliArgs: string[];
  timeoutMs: number;
  continueOnError: boolean;
  hooks: {
    preToolUse: boolean;
    postToolUse: boolean;
    userPromptSubmit: boolean;
    sessionStart: boolean;
    stop: boolean;
    preCompact: boolean;
    postCompact: boolean;
    notification: boolean;
    fileWatcher: boolean;
    lspDiagnostics: boolean;
    slashCommand: boolean;
  };
  agentPool: {
    enabled: boolean;
    idleThresholdMs: number;
    queueIntervalMs: number;
    maxQueueSize: number;
  };
  statusline: {
    strategy: StatuslineStrategy;
    daemonOutputPath: string;
    daemonIntervalMs: number;
  };
}

export const DEFAULT_BRIDGE_OPTIONS: RufloBridgeOptions = {
  cliCommand: 'npx',
  cliArgs: ['-y', 'ruflo@latest'],
  timeoutMs: 30_000,
  continueOnError: true,
  hooks: {
    preToolUse: true,
    postToolUse: true,
    userPromptSubmit: true,
    sessionStart: true,
    stop: true,
    preCompact: true,
    postCompact: true,
    notification: true,
    fileWatcher: true,
    lspDiagnostics: false,
    slashCommand: true,
  },
  agentPool: {
    enabled: true,
    idleThresholdMs: 5_000,
    queueIntervalMs: 1_000,
    maxQueueSize: 64,
  },
  statusline: {
    strategy: DEFAULT_STATUSLINE_OPTIONS.strategy,
    daemonOutputPath: DEFAULT_STATUSLINE_OPTIONS.daemonOutputPath,
    daemonIntervalMs: DEFAULT_STATUSLINE_OPTIONS.daemonIntervalMs,
  },
};

export function mergeOptions(user: Partial<RufloBridgeOptions> = {}): RufloBridgeOptions {
  return {
    ...DEFAULT_BRIDGE_OPTIONS,
    ...user,
    hooks: { ...DEFAULT_BRIDGE_OPTIONS.hooks, ...(user.hooks ?? {}) },
    agentPool: { ...DEFAULT_BRIDGE_OPTIONS.agentPool, ...(user.agentPool ?? {}) },
    statusline: { ...DEFAULT_BRIDGE_OPTIONS.statusline, ...(user.statusline ?? {}) },
  };
}

/**
 * Factory: build the Plugin closure.
 *
 * The plugin function itself IS the init phase — opencode calls it once
 * at load time. There is no `hook.init` or `hook.destroy`; cleanup is
 * handled via process exit listeners.
 */
export function createRufloBridge(userOptions: Partial<RufloBridgeOptions> = {}): Plugin {
  const options = mergeOptions(userOptions);

  const plugin: Plugin = async (ctx) => {
    const ocCtx = ctx as unknown as OcContext;
    const log = makeLogger(ocCtx, 'ruflo-bridge');

    // Subsystems
    const pool = new AgentPool(ocCtx, log, {
      cliCommand: options.cliCommand,
      cliArgs: options.cliArgs,
      timeoutMs: options.timeoutMs,
      ...options.agentPool,
    });
    const statusline = new Statusline(ocCtx, log, {
      cliCommand: options.cliCommand,
      cliArgs: options.cliArgs,
      timeoutMs: options.timeoutMs,
      ...options.statusline,
    });

    // Start subsystems (this is the "init" phase)
    pool.start();
    await statusline.start();
    await log.info('ruflo bridge initialized', {
      version: 2,
      statusline: options.statusline.strategy,
      poolEnabled: options.agentPool.enabled,
    });

    // Cleanup on process exit (no hook.destroy in opencode)
    const cleanup = () => {
      pool.stop();
      statusline.stop().catch(() => undefined);
    };
    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    /** Run a `ruflo hooks <args>` subcommand. */
    const runHook = async (args: string[]): Promise<void> => {
      const argv = [options.cliCommand, ...options.cliArgs, 'hooks', ...args];
      const result = await runShell(ocCtx, argv, options.timeoutMs, log);
      if (result.exitCode !== 0) {
        await log.warn(`hook exited ${result.exitCode}`, {
          cmd: argv.join(' ').slice(0, 200),
          timedOut: result.timedOut,
          stderr: result.stderr.slice(0, 200),
        });
        if (!options.continueOnError && result.threw) {
          throw new Error(`ruflo hook failed: ${args.join(' ')}`);
        }
      }
    };

    // Build the hooks object matching opencode's real Hooks interface
    const hooks: Hooks = {
      // ===== Tool execution ================================================

      'tool.execute.before': async (
        input: { tool: string; sessionID: string; callID: string },
        output: { args: unknown },
      ) => {
        if (!options.hooks.preToolUse) return;
        const args = output.args as Record<string, unknown> | undefined;
        switch (input.tool) {
          case 'bash': {
            const cmd = String(args?.command ?? '');
            await runHook(['pre-bash', '--command', cmd]);
            return;
          }
          case 'edit':
          case 'write':
          case 'multiedit': {
            const file = String(args?.filePath ?? args?.file_path ?? args?.path ?? '');
            await runHook(['pre-edit', '--file', file]);
            return;
          }
          default:
            return;
        }
      },

      'tool.execute.after': async (
        input: { tool: string; sessionID: string; callID: string; args: unknown },
        output: { title: string; output: string; metadata: unknown },
      ) => {
        if (options.hooks.postToolUse) {
          const args = input.args as Record<string, unknown> | undefined;
          switch (input.tool) {
            case 'bash':
              await runHook([
                'post-bash',
                '--command',
                String(args?.command ?? ''),
                '--success',
                'true',
              ]);
              break;
            case 'edit':
            case 'write':
            case 'multiedit':
              await runHook([
                'post-edit',
                '--file',
                String(args?.filePath ?? args?.file_path ?? args?.path ?? ''),
                '--success',
                'true',
                '--train-patterns',
              ]);
              break;
            default:
              await runHook([
                'post-task',
                '--task-id',
                input.sessionID ?? 'unknown',
                '--success',
                'true',
              ]);
          }
        }
        await pool.observe({ type: 'tool.execute.after', sessionID: input.sessionID, tool: input.tool });
      },

      // ===== Chat → UserPromptSubmit =======================================

      'chat.message': async (
        input: { sessionID: string; agent?: string; model?: unknown; messageID?: string; variant?: string },
        output: { message: unknown; parts: unknown[] },
      ) => {
        if (!options.hooks.userPromptSubmit) return;
        const msg = output.message as { role?: string; content?: unknown; parts?: unknown[] } | undefined;
        if (!msg) return;
        // chat.message fires for the user message; extract text
        const text = stringifyMessageContent(msg.content)
          || stringifyMessageContent((output.parts as Array<{ type?: string; text?: string }>)
            ?.filter((p) => p?.type === 'text')
            .map((p) => p.text ?? '')
            .join(' '));
        if (!text) return;
        await runHook(['route', '--task', text.slice(0, 4000)]);
      },

      // ===== System prompt injection (statusline footer) ===================

      'experimental.chat.system.transform': async (
        _input: { sessionID?: string; model: unknown },
        output: { system: string[] },
      ) => {
        statusline.decorateSystemPrompt(output.system);
      },

      // ===== Compaction (pre) → compact-pre ================================

      'experimental.session.compacting': async (
        input: { sessionID: string },
        output: { context: string[]; prompt?: string },
      ) => {
        await handleCompactEvent(ocCtx, log, 'pre', input.sessionID, {
          cliCommand: options.cliCommand,
          cliArgs: options.cliArgs,
          timeoutMs: options.timeoutMs,
          enabled: options.hooks.preCompact,
        });
        // We don't modify the compaction output — ruflo handles context
        // preservation via its own snapshot mechanism.
        void output;
      },

      // ===== Permission → auto-approve mcp__ruflo__* =======================

      'permission.ask': async (input, output) => {
        // SDK Permission: { id, type, pattern, sessionID, title, metadata, ... }
        // `pattern` is string | string[] of tool/path patterns
        const patterns = Array.isArray(input.pattern) ? input.pattern
          : input.pattern ? [input.pattern]
          : [];
        const isMcpRuflo = patterns.some((p: string) => p.startsWith('mcp__ruflo__'))
          || input.title?.startsWith('mcp__ruflo__');
        if (isMcpRuflo) {
          output.status = 'allow';
        }
      },

      // ===== Command execution =============================================

      'command.execute.before': async (
        input: { command: string; sessionID: string; arguments: string },
        output: { parts: unknown[] },
      ) => {
        if (!options.hooks.slashCommand || !input.command) return;
        await runHook(['slash-command-run', '--command', input.command]);
        void output;
      },

      // ===== Shell environment injection ===================================

      'shell.env': async (
        _input: { cwd: string; sessionID?: string; callID?: string },
        output: { env: Record<string, string> },
      ) => {
        output.env['RUFLO_BRIDGE'] = '1';
        output.env['RUFLO_BRIDGE_VERSION'] = '2';
      },

      // ===== Generic event handler (bus events) ============================
      // Bus events like session.compacted, message.updated, session.idle,
      // file.watcher.updated, permission.asked, etc. are NOT plugin hooks —
      // they're received via the generic `event` handler.

      event: async (input: { event: { type: string; properties: Record<string, unknown> } }) => {
        const evt = input.event;
        if (!evt || !evt.type) return;

        switch (evt.type) {
          // Compaction complete → compact-post
          case 'session.compacted': {
            const sessionID = String(evt.properties?.sessionID ?? 'unknown');
            await handleCompactEvent(ocCtx, log, 'post', sessionID, {
              cliCommand: options.cliCommand,
              cliArgs: options.cliArgs,
              timeoutMs: options.timeoutMs,
              enabled: options.hooks.postCompact,
            });
            return;
          }

          // Session created → session-restore
          case 'session.created': {
            if (!options.hooks.sessionStart) return;
            const sessionID = String(evt.properties?.sessionID ?? evt.properties?.id ?? 'unknown');
            await runHook(['session-restore', '--session-id', sessionID]);
            return;
          }

          // Session deleted → session-end
          case 'session.deleted': {
            if (!options.hooks.stop) return;
            const sessionID = String(evt.properties?.sessionID ?? evt.properties?.id ?? 'unknown');
            await runHook(['session-end', '--session-id', sessionID]);
            return;
          }

          // Session status → detect idle for agent pool + session-end
          case 'session.status': {
            const status = evt.properties?.status as { type?: string } | undefined;
            if (status?.type === 'idle') {
              const sessionID = String(evt.properties?.sessionID ?? 'unknown');
              if (options.hooks.stop) {
                await runHook([
                  'session-end',
                  '--session-id',
                  sessionID,
                  '--generate-summary',
                  'true',
                  '--persist-state',
                  'true',
                  '--export-metrics',
                  'true',
                ]);
              }
              await pool.observe({ type: 'session.idle', sessionID });
            }
            return;
          }

          // session.idle (deprecated but still emitted)
          case 'session.idle': {
            const sessionID = String(evt.properties?.sessionID ?? 'unknown');
            await pool.observe({ type: 'session.idle', sessionID });
            return;
          }

          // Session error → notification + error hook
          case 'session.error': {
            const sessionID = String(evt.properties?.sessionID ?? 'unknown');
            const error = evt.properties?.error as { message?: string; code?: string } | undefined;
            const msg = error?.message ?? String(evt.properties?.message ?? 'unknown error');
            const code = error?.code ?? 'unknown';
            await runHook([
              'session-error',
              '--session-id',
              sessionID,
              '--error-code',
              code,
              '--message',
              msg.slice(0, 500),
            ]);
            if (options.hooks.notification) {
              await notify(ocCtx, log, {
                title: 'ruflo: session error',
                body: `${code}: ${msg.slice(0, 200)}`,
                urgency: 'critical',
              });
            }
            return;
          }

          // Permission asked → notification
          case 'permission.asked': {
            if (!options.hooks.notification) return;
            const permission = String(evt.properties?.permission ?? '');
            const patterns = (evt.properties?.patterns as string[]) ?? [];
            await notify(ocCtx, log, {
              title: 'ruflo: permission requested',
              body: `${permission}: ${patterns.join(', ').slice(0, 200)}`,
              urgency: 'normal',
            });
            return;
          }

          // Message updated → feed agent pool
          case 'message.updated': {
            const info = evt.properties?.info as {
              role?: string;
              finish?: string;
              parts?: Array<{ type?: string }>;
            } | undefined;
            if (!info || info.role !== 'assistant') return;
            const finishReason = info.finish;
            const hasToolUse = Array.isArray(info.parts)
              ? info.parts.some((p) => p?.type === 'tool-call' || p?.type === 'tool_use' || p?.type === 'tool-use')
              : false;
            await pool.observe({
              type: 'message.updated',
              sessionID: String(evt.properties?.sessionID ?? ''),
              finishReason,
              hasToolUse,
            });
            return;
          }

          // File watcher → hooks file-watcher-updated
          case 'file.watcher.updated': {
            if (!options.hooks.fileWatcher) return;
            const file = String(evt.properties?.file ?? '');
            if (!file) return;
            const event = String(evt.properties?.event ?? 'change');
            await runHook([
              'file-watcher-updated',
              '--path',
              file,
              '--event',
              event,
            ]);
            return;
          }

          // Command executed
          case 'command.executed': {
            // Already handled via command.execute.before hook trigger.
            // Bus event is informational only.
            return;
          }

          default:
            return;
        }
      },
    };

    return hooks;
  };

  return plugin;
}

export default createRufloBridge;

export { AgentPool } from './agent-pool';
export type { PoolTask, PoolEvent, AgentPoolOptions } from './agent-pool';
export { Statusline } from './statusline';
export type { StatuslineStrategy, StatuslineOptions } from './statusline';
export { notify, buildNotifyCommand } from './notifier';
export type { NotifyOptions } from './notifier';
export { handleCompactEvent } from './compactor';
export type { CompactPhase, CompactorOptions } from './compactor';
export { shellQuote, stringifyMessageContent, makeLogger, runShell } from './shell';
export type { OcContext, Logger, HookResult } from './shell';
