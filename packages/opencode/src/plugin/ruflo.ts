/**
 * RufloPlugin — built-in bridge between openruflo events and the ruflo CLI.
 *
 * Resolution order:
 *   1. OPENRUFLO_RUFLO_CMD env var  (e.g. "node C:/abs/path/ruflo.js")
 *   2. node + ruflo.js  (found via npm global prefix, avoids .cmd wrapper issues
 *      in bun shell context where PATH differs from cmd.exe PATH)
 *   3. npx ruflo@latest  (fallback, slower)
 *
 * Set OPENRUFLO_DISABLE_RUFLO_BRIDGE=1 to skip entirely.
 */
import { createRufloBridge } from "./ruflo-bridge/index"
import type { Plugin } from "@opencode-ai/plugin"
import { spawnSync } from "child_process"
import path from "path"
import fs from "fs"

type ResolvedCmd = { cmd: string; args: string[] }

function trySpawn(cmd: string, args: string[]): boolean {
  try {
    // shell:false — avoids cmd.exe PATH lookup which can find ruflo.cmd
    // while bun's own shell cannot. We only want binaries reachable by bun.
    const r = spawnSync(cmd, args, { timeout: 3000, encoding: "utf8", shell: false, windowsHide: true })
    return r.status === 0
  } catch {
    return false
  }
}

/** Find node.exe — must be an absolute path or resolvable by bun's shell. */
function findNode(): string | null {
  // Common absolute locations
  const candidates = [
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\Program Files (x86)\\nodejs\\node.exe",
    process.env["NODE_PATH"] ?? "",
  ].filter(Boolean)
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  if (trySpawn("node", ["--version"])) return "node"
  return null
}

/** Ask npm for its global prefix using node directly — no shell needed. */
function npmGlobalPrefixViaNode(node: string): string | null {
  // npm ships its CLI at <nodejs>/node_modules/npm/bin/npm-cli.js
  const nodeDir = path.dirname(node === "node" ? "C:\\Program Files\\nodejs\\node.exe" : node)
  const npmCli = path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js")
  if (!fs.existsSync(npmCli)) return null
  try {
    const r = spawnSync(node, [npmCli, "prefix", "-g"],
      { timeout: 5000, encoding: "utf8", shell: false, windowsHide: true })
    return r.status === 0 ? (r.stdout as string).trim() : null
  } catch {
    return null
  }
}

function findRufloJs(node: string): string | null {
  const prefixCandidates: string[] = []

  // 1. Ask npm via node
  const npmPrefix = npmGlobalPrefixViaNode(node)
  if (npmPrefix) prefixCandidates.push(npmPrefix)

  // 2. Common Windows fallbacks
  if (process.env["APPDATA"]) prefixCandidates.push(path.join(process.env["APPDATA"]!, "npm"))
  if (process.env["USERPROFILE"]) {
    prefixCandidates.push(path.join(process.env["USERPROFILE"]!, "AppData", "Roaming", "npm"))
    prefixCandidates.push(path.join(process.env["USERPROFILE"]!, ".npm-global"))
  }

  for (const prefix of prefixCandidates) {
    const js = path.join(prefix, "node_modules", "ruflo", "bin", "ruflo.js")
    if (fs.existsSync(js) && trySpawn(node, [js, "--version"])) return js
  }
  return null
}

function findRufloCommand(): ResolvedCmd | null {
  // 1. Explicit override
  const override = process.env["OPENRUFLO_RUFLO_CMD"]
  if (override) {
    const parts = override.split(" ")
    return { cmd: parts[0]!, args: parts.slice(1) }
  }

  // 2. node + ruflo.js  (most reliable across bun shell / cmd.exe / bash)
  const node = findNode()
  if (node) {
    const js = findRufloJs(node)
    if (js) return { cmd: node, args: [js] }
  }

  // 3. npx fallback
  if (trySpawn("npx", ["-y", "ruflo@latest", "--version"])) {
    return { cmd: "npx", args: ["-y", "ruflo@latest"] }
  }

  return null
}

let _resolved: ResolvedCmd | null | undefined

function resolved(): ResolvedCmd | null {
  if (_resolved === undefined) _resolved = findRufloCommand()
  return _resolved
}

let _bridge: Plugin | undefined

export function getRufloPlugin(): Plugin | undefined {
  if (process.env["OPENRUFLO_DISABLE_RUFLO_BRIDGE"] === "1") return undefined
  const r = resolved()
  if (!r) return undefined
  if (!_bridge) {
    _bridge = createRufloBridge({ cliCommand: r.cmd, cliArgs: r.args })
  }
  return _bridge
}

export const RufloPlugin: Plugin = async (ctx, options) => {
  const bridge = getRufloPlugin()
  if (!bridge) return {}
  return bridge(ctx, options)
}
