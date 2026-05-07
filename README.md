[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/jaisonlewis-openruflo-badge.png)](https://mseep.ai/app/jaisonlewis-openruflo)

# openruflo

> openruflo is a fork of [opencode](https://github.com/opencode-ai/opencode) v1.14.33 with deep ruflo integration — persistent memory, sub-agent orchestration, task tracking, notification hooks, and a full workflow command set.

---

## What's different from opencode

| Feature | opencode | openruflo |
|---|---|---|
| Session memory across restarts | ❌ | ✅ ruflo memory |
| Sub-agent spawning | ❌ | ✅ agent-spawner MCP |
| Task tracking | ❌ | ✅ ruflo task CLI |
| Notifications (idle/permission/error) | ❌ | ✅ ruflo bridge hooks |
| Auto-approve ruflo/agent-spawner tools | ❌ | ✅ |
| Workflow slash commands | ❌ | ✅ 14 commands |
| AI coding vocabulary skill | ❌ | ✅ on-demand |
| Architectural decision logging | ❌ | ✅ /decide |
| Brag Doc / perf review generation | ❌ | ✅ /brag, /peer |
| Codebase knowledge graph | ❌ | ✅ graphify integration |

---

## Requirements

- [ruflo](https://github.com/jaisonlewis/ruflo) installed and in PATH
- [sentrux](https://github.com/jaisonlewis/sentrux) installed and in PATH
- Windows x64 / macOS / Linux
- [Bun](https://bun.sh) ≥ 1.3.13 _(build from source only)_
- [uv](https://docs.astral.sh/uv/) + [graphify](https://github.com/safishamsi/graphify) _(optional — knowledge graph)_

---

## Installation

### Windows (recommended)

```powershell
# 1. Install ruflo
npm install -g ruflo

# 2. Install sentrux
npm install -g sentrux

# 3. Install openruflo
curl -L https://github.com/jaisonlewis/openruflo/releases/latest/download/openruflo-windows-x64.zip -o openruflo.zip
Expand-Archive openruflo.zip -DestinationPath "$env:USERPROFILE\bin"
# Add $env:USERPROFILE\bin to PATH if not already there

# 4. Install the agent-spawner
curl -L https://github.com/jaisonlewis/openruflo/releases/latest/download/openruflo-agent-spawner-windows-x64.zip -o spawner.zip
Expand-Archive spawner.zip -DestinationPath "$env:USERPROFILE\bin"
```

### macOS / Linux

```bash
# 1. Install ruflo
npm install -g ruflo

# 2. Install sentrux
npm install -g sentrux

# 3. Install openruflo
curl -L https://github.com/jaisonlewis/openruflo/releases/latest/download/openruflo-linux-x64.tar.gz | tar xz -C ~/.local/bin
# macOS: use openruflo-darwin-arm64.tar.gz or openruflo-darwin-x64.tar.gz

# 4. Install the agent-spawner
curl -L https://github.com/jaisonlewis/openruflo/releases/latest/download/openruflo-agent-spawner-linux-x64.tar.gz | tar xz -C ~/.local/bin
```

### From source

```bash
git clone https://github.com/jaisonlewis/openruflo
cd openruflo

# Build openruflo binary
cd packages/opencode
bun run build:win      # Windows (avoids JSC heap OOM)
# bun run build        # macOS / Linux
# Output: dist/openruflo-windows-x64/bin/openruflo.exe

# Build agent-spawner
cd ../../agent-spawner
bun install && bun run build
# Output: dist/openruflo-agent-spawner.exe
```

> **Bundled binaries**: release zips include `openruflo`, `openruflo-agent-spawner`, and `sentrux` in the same directory. openruflo auto-detects sibling binaries at startup — no PATH configuration required.

---

## Quick Start

```bash
# 1. Initialize ruflo in your project
ruflo init
ruflo memory init

# 2. Start openruflo
openruflo

# 3. Initialize the workflow (type in the openruflo chat)
/ruflo
```

That's it. openruflo will:
- Auto-start the agent-spawner MCP server (sibling binary or PATH)
- Auto-start sentrux MCP server (sibling binary or PATH) — warn if missing
- Inject session context from ruflo memory on every session start
- Snapshot memory on session end

---

## Architecture

```
openruflo
├── opencode core (v1.14.33)
│   ├── TUI / Web UI
│   ├── LLM provider adapters (Anthropic, OpenAI, Gemini, ...)
│   └── Plugin system
├── ruflo-bridge (INTERNAL_PLUGIN)
│   ├── session-restore  → ruflo memory search → inject context
│   ├── session-end      → ruflo memory store (snapshot)
│   ├── permission.ask   → auto-approve mcp__ruflo__* + mcp__agent-spawner__*
│   ├── session.idle     → ruflo notify (low urgency)
│   └── session.error    → ruflo notify (critical)
├── agent-spawner MCP server (auto-started)
│   ├── spawn_agent / get_agent_status / collect_agent_result
│   ├── list_agents / cancel_agent
│   ├── read_handoff / list_handoffs
│   └── task_create / task_list / task_status / task_cancel / task_assign / task_retry
└── sentrux MCP server (auto-started, default)
    └── architecture quality gates + baseline diffs
```

---

## Global Configuration

Config lives at `%APPDATA%\opencode\openruflo.json` (Windows) or `~/.config/opencode/openruflo.json` (Linux/macOS).

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "agent-spawner": {
      "type": "local",
      "command": ["openruflo-agent-spawner", "--mcp"],
      "enabled": true
    },
    "sentrux": {
      "type": "local",
      "command": ["sentrux", "--mcp"],
      "enabled": true
    }
  }
}
```

---

## Slash Commands

All commands are globally available in every session. Type them in the openruflo chat.

### Workflow

| Command | Description |
|---|---|
| `/ruflo` | Initialize ruflo+sentrux and build from a plan file using sub-agents |
| `/standup` | Generate today's standup from memory and open tasks |
| `/dump` | Brain dump — capture loose thoughts, classify and store them |
| `/wrap-up` | End-of-session summary — file decisions, wins, snapshot context |

### Tracking

| Command | Description |
|---|---|
| `/tasks` | Show open tasks from ruflo task system |
| `/goals` | Show current goals and map progress |
| `/projects` | List active projects with status and recent activity |
| `/wins` | List recent wins (for perf reviews, Brag Doc) |

### Recording

| Command | Description |
|---|---|
| `/decide` | Record an architectural/technical decision with rationale |
| `/incident` | Log an incident with timeline, impact, and resolution |

### Review & Reflection

| Command | Description |
|---|---|
| `/retro` | Sprint retrospective — what went well, what didn't, what to change |
| `/peer` | Generate peer review / 360 feedback talking points |
| `/brag` | Generate a Brag Document entry from wins and decisions |

### Codebase Intelligence

| Command | Description |
|---|---|
| `/graphify` | Map the codebase into a queryable knowledge graph — architecture, god nodes, dependencies |

---

## Sub-Agent Workflow (`/ruflo`)

The `/ruflo` command orchestrates multi-phase builds using sub-agents.

### What it does
1. Finds a `*plan.md` or `AGENTS.md` in the working directory
2. Runs `ruflo init && ruflo start`
3. Takes a sentrux baseline (`sentrux gate --save`)
4. Spawns sub-agents per phase via `spawn_agent`
5. Collects results via `collect_agent_result`
6. Runs `sentrux gate` and reports quality delta

### Handoff protocol
Sub-agents should end their output with:
```
<<<HANDOFF>>>
{
  "status": "ok",
  "summary": "one sentence describing what was done",
  "files": ["path/to/file1.ts", "path/to/file2.ts"],
  "next": ["optional follow-up task"]
}
<<<END_HANDOFF>>>
```
After collection, call `read_handoff(agentId)` to get the parsed envelope.

### Example plan file (`plan.md`)
```markdown
# My Project Plan

## Phase 1: Foundation
Build the core data models and database schema.
Files: src/models/*.ts, migration/

## Phase 2: API
Implement REST endpoints.
Files: src/api/*.ts

## Phase 3: Tests
Write integration tests.
Files: test/*.test.ts
```

---

## MCP Tools (agent-spawner)

Available to any agent in the session via `mcp__agent-spawner__*` tools.

### Agent management
```
spawn_agent(prompt, model?, cwd?)           → { id, status, startedAt }
get_agent_status(id)                        → { id, status, text, lineCount, ... }
collect_agent_result(id, timeoutMs?, pollMs?) → { status, text, handoff, ... }
list_agents(statusFilter?)                  → [{ id, status, prompt, ... }]
cancel_agent(id)                            → { id, status: "cancelled" }
```

**Model selection for sub-agents** — resolved in this order:
1. `model` param passed to `spawn_agent` — per-agent override
2. `OPENRUFLO_DEFAULT_MODEL` env var — system-wide propagation
3. _(no --model flag passed)_ — sub-agent uses whatever model is selected in openruflo config/UI

This means **by default, sub-agents inherit the model you have selected** in the parent session. You never need to specify `model` unless you want a specific agent to use a different one.

**Model ID format**: `provider/model-id`
```
anthropic/claude-opus-4-5
anthropic/claude-sonnet-4-5
openai/gpt-4o
openai/o3
google/gemini-2.5-pro
google/gemini-2.5-flash
```

**Override example** — use a fast/cheap model for research sub-agents, big model for implementation:
```
spawn_agent("Research the best approach for...", model="google/gemini-2.5-flash")
spawn_agent("Implement the solution based on...", model="anthropic/claude-opus-4-5")
```

### Handoff
```
read_handoff(id)     → HandoffEnvelope { status, summary, files, next, rawText }
list_handoffs()      → [{ agentId, status, summary, fileCount, nextCount }]
```

### Task tracking
```
task_create(type, description, priority?)   → { exitCode, output }
task_list(all?)                             → { exitCode, output }
task_status(id)                             → { exitCode, output }
task_cancel(id)                             → { exitCode, output }
task_assign(id, agent)                      → { exitCode, output }
task_retry(id)                              → { exitCode, output }
```

---

## Memory System

openruflo uses ruflo's semantic memory for session persistence.

### Initialize
```bash
ruflo memory init        # creates .claude/memory.db in the project
```

### Store
```bash
ruflo memory store -k "decision:use-bun" -v "We chose Bun for native TS and speed"
```

### Search
```bash
ruflo memory search -q "why did we choose the build tool"
```

### How it's used automatically
- **Session start**: ruflo-bridge searches memory for goals, active projects, recent decisions, and injects them into the session context
- **Session end**: ruflo-bridge snapshots the session summary to `session:summary:{sessionId}`
- **Slash commands**: `/standup`, `/wrap-up`, `/dump`, `/wins`, `/brag`, `/peer`, `/retro` all read from and write to memory

---

## Knowledge Graph (graphify)

openruflo integrates [graphify](https://github.com/safishamsi/graphify) for structural codebase intelligence. Once installed, agents automatically consult the graph before answering architecture questions.

### Install

```bash
# Install uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh   # macOS/Linux
irm https://astral.sh/uv/install.ps1 | iex         # Windows

# Install graphify
uv tool install graphifyy
graphify opencode install
```

### Build the graph

```
/graphify
```

Or from the CLI:

```bash
graphify .                # full build (AST + LLM for docs/images)
graphify update .         # re-extract code only — no API cost
```

**Outputs** written to `graphify-out/`:
- `GRAPH_REPORT.md` — god nodes, largest communities, cross-module surprises
- `graph.json` — machine-queryable graph used by agents
- `index.html` — interactive visualizer (open in browser)

### Query the graph

```bash
graphify path "AuthService" "Database"   # shortest dependency path
graphify explain "SessionManager"         # plain-language node explanation
graphify query "how does auth work"       # semantic search
```

### How agents use it

A `tool.execute.before` plugin is registered at `.opencode/plugins/graphify.js`. Before any bash tool call, if `graphify-out/graph.json` exists, agents are reminded to read `GRAPH_REPORT.md` first — so they navigate by graph structure rather than brute-force file scanning.

---

## Notification Hooks

ruflo-bridge fires desktop notifications for key events:

| Event | Urgency | Message |
|---|---|---|
| Session idle | Low | "ruflo: agent idle" |
| Task complete (idle after work) | Normal | "ruflo: task complete" |
| Permission request (non-auto) | Critical | "ruflo: permission required — {tool}" |
| Session error | Critical | "ruflo: session error" |

Requires `ruflo notify` to be configured (uses system notifications via ruflo).

---

## AI Coding Dictionary (Skill)

openruflo includes a global skill with precise vocabulary for AI coding — loaded on demand, zero token cost when not relevant.

**Terms covered**: model, parameters, training, inference, token, next-token prediction, non-determinism, harness, context window, session, turn, tool, tool call, tool result, permission mode, agent mode, sycophancy, hallucination, smart zone, dumb zone, attention degradation, clearing, handoff, handoff artifact, compaction, autocompact, memory system, progressive disclosure, skill, subagent, human-in-the-loop, AFK, automated check, vibe coding, grilling, and more.

The skill is at: `%APPDATA%\opencode\skill\ai-coding-dictionary\SKILL.md`

---

## Do Agents Use These Automatically?

**Yes — session context** is injected automatically via ruflo-bridge at session start. Every agent sees current goals, active projects, recent decisions, and open tasks without you doing anything.

**Yes — permissions** for ruflo and agent-spawner tools are auto-approved without prompting.

**Yes — memory snapshots** happen automatically on session end.

**Slash commands** must be explicitly invoked (by you, or by an agent instructed to use them in its prompt). When using `/ruflo`, sub-agents spawned in that workflow have full access to all slash commands and MCP tools.

To make sub-agents use the workflow commands, include in their prompt:
> "At the end, run /wrap-up to file your decisions and wins."

---

## Building from Source (Windows)

```powershell
# Install dependencies
cd packages/opencode
bun install

# Build for current platform only (avoids OOM)
bun run build:win

# Output
dist/openruflo-windows-x64/bin/openruflo.exe
```

The `build:win` script sets `BUN_JSC_largeHeapSize=2147483648` and `--smol` to avoid the JSC heap OOM that occurs on Windows x64 with the default 32MB ceiling.

---

## Repository Structure

```
openruflo/
├── packages/
│   ├── opencode/          # Core openruflo binary (fork of opencode)
│   │   └── src/plugin/ruflo-bridge/   # Ruflo bridge plugin
│   └── app/               # Web UI
├── agent-spawner/         # Standalone MCP server for sub-agent orchestration
├── bridge-build/          # Ruflo bridge source (synced to packages/opencode)
└── README.md              # This file
```

Global config (available in all sessions):
```
%APPDATA%\opencode\
├── openruflo.json          # MCP server registrations
├── command/                # Slash commands
│   ├── ruflo.md
│   ├── standup.md
│   ├── dump.md
│   ├── wrap-up.md
│   ├── tasks.md
│   ├── goals.md
│   ├── projects.md
│   ├── wins.md
│   ├── decide.md
│   ├── incident.md
│   ├── retro.md
│   ├── peer.md
│   └── brag.md
└── skill/
    └── ai-coding-dictionary/SKILL.md
```

---

## License

MIT — fork of opencode (MIT)
