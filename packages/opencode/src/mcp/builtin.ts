/**
 * Built-in MCP servers for openruflo.
 *
 * Each entry is auto-started when the corresponding binary is detected.
 * User config always wins — if the user has already defined an entry with
 * the same name in openruflo.json, the built-in is skipped for that slot.
 *
 * To disable all built-ins: set OPENRUFLO_DISABLE_BUILTIN_MCP=1
 * To disable a specific server: set OPENRUFLO_DISABLE_MCP_<NAME>=1
 *   e.g.  OPENRUFLO_DISABLE_MCP_SENTRUX=1
 */

import { spawnSync, execSync } from "child_process"
import path from "path"
import fs from "fs"
import type { ConfigMCP } from "../config/mcp"

export type BuiltinMcpEntry = {
  name: string
  config: ConfigMCP.Info & { type: "local" }
  description: string
}

function tryCommand(cmd: string, args: string[]): boolean {
  try {
    const r = spawnSync(cmd, args, { timeout: 3000, encoding: "utf8", shell: true, windowsHide: true })
    return r.status === 0
  } catch {
    return false
  }
}

function findBinary(name: string): string | null {
  // 1. Direct PATH lookup
  if (tryCommand(name, ["--version"])) return name

  // 2. npm global prefix bin (handles npm install -g without PATH update)
  try {
    const prefix = execSync("npm prefix -g", { encoding: "utf8", timeout: 3000 }).trim()
    const ext = process.platform === "win32" ? ".cmd" : ""
    const candidate = path.join(prefix, name + ext)
    if (fs.existsSync(candidate) && tryCommand(candidate, ["--version"])) return candidate
  } catch { /* ignore */ }

  return null
}

function disabled(name: string): boolean {
  if (process.env["OPENRUFLO_DISABLE_BUILTIN_MCP"] === "1") return true
  return process.env[`OPENRUFLO_DISABLE_MCP_${name.toUpperCase()}`] === "1"
}

/**
 * Returns built-in MCP entries whose binary is present on this machine.
 * Only includes entries whose `name` key is NOT already in `userConfig`.
 */
export function resolveBuiltinMcpServers(
  userConfig: Record<string, unknown>,
): Record<string, ConfigMCP.Info> {
  const result: Record<string, ConfigMCP.Info> = {}

  // ── Sentrux — architectural quality sensor (default, bundled with openruflo) ─
  if (!disabled("sentrux") && !("sentrux" in userConfig)) {
    // Check sibling dir first (bundled alongside openruflo binary in releases)
    const siblingDir = process.execPath ? path.dirname(process.execPath) : null
    let sentruxCmd: string | null = null
    if (siblingDir) {
      const sibling = path.join(siblingDir, "sentrux" + (process.platform === "win32" ? ".exe" : ""))
      if (fs.existsSync(sibling)) sentruxCmd = sibling
    }
    if (!sentruxCmd) sentruxCmd = findBinary("sentrux")

    if (sentruxCmd) {
      result["sentrux"] = {
        type: "local" as const,
        command: [sentruxCmd, "--mcp"],
      }
    } else {
      // Sentrux is a default part of openruflo — warn once if missing
      console.warn(
        "[openruflo] sentrux not found. Install it to enable quality gates and architecture analysis:\n" +
        "  npm install -g sentrux\n" +
        "  # or: https://github.com/jaisonlewis/sentrux/releases"
      )
    }
  }

  // ── Agent Spawner — spawn and coordinate openruflo sub-agents ─────────────
  if (!disabled("agent-spawner") && !("agent-spawner" in userConfig)) {
    // Check sibling dir first (compiled single-binary installs)
    const siblingDir = process.execPath ? path.dirname(process.execPath) : null
    let spawnerCmd: string | null = null
    if (siblingDir) {
      const sibling = path.join(siblingDir, "openruflo-agent-spawner" + (process.platform === "win32" ? ".exe" : ""))
      if (fs.existsSync(sibling)) spawnerCmd = sibling
    }
    if (!spawnerCmd) spawnerCmd = findBinary("openruflo-agent-spawner")
    if (spawnerCmd) {
      result["agent-spawner"] = {
        type: "local" as const,
        command: [spawnerCmd, "--mcp"],
      }
    }
  }

  // Add future built-in MCP servers here following the same pattern.

  return result
}
