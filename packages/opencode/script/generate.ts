import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const modelsUrl = process.env.OPENCODE_MODELS_URL || "https://models.dev"
// Fetch and generate models.dev snapshot
const modelsData = process.env.MODELS_DEV_API_JSON
  ? await Bun.file(process.env.MODELS_DEV_API_JSON).text()
  : await fetch(`${modelsUrl}/api.json`).then((x) => x.text())

// Parse and inject providers not in models.dev (e.g. academic/self-hosted)
const snapshot = JSON.parse(modelsData)

// ── SAIA (GWDG) ──────────────────────────────────────────────────────────────
// Scientific AI Access platform by GWDG — OpenAI-compatible API for HPC users.
// Docs: https://docs.hpc.gwdg.de/services/saia/
// API:  https://chat-ai.academiccloud.de/v1
// Key:  request via https://kisski.gwdg.de
snapshot["saia"] = {
  id: "saia",
  name: "SAIA (GWDG)",
  env: ["SAIA_API_KEY"],
  npm: "@ai-sdk/openai-compatible",
  api: "https://chat-ai.academiccloud.de/v1",
  doc: "https://docs.hpc.gwdg.de/services/saia/",
  models: {
    "meta-llama-3.1-8b-instruct": {
      id: "meta-llama-3.1-8b-instruct",
      name: "Llama 3.1 8B Instruct",
      family: "llama",
      attachment: false,
      reasoning: false,
      tool_call: true,
      temperature: true,
      open_weights: true,
      knowledge: "2023-12",
      release_date: "2024-07-23",
      modalities: { input: ["text"], output: ["text"] },
      cost: { input: 0, output: 0 },
      limit: { context: 128000, output: 8192 },
    },
    "meta-llama-3.3-70b-instruct": {
      id: "meta-llama-3.3-70b-instruct",
      name: "Llama 3.3 70B Instruct",
      family: "llama",
      attachment: false,
      reasoning: false,
      tool_call: true,
      temperature: true,
      open_weights: true,
      knowledge: "2023-12",
      release_date: "2024-12-06",
      modalities: { input: ["text"], output: ["text"] },
      cost: { input: 0, output: 0 },
      limit: { context: 128000, output: 8192 },
    },
    "qwen3-235b-a22b": {
      id: "qwen3-235b-a22b",
      name: "Qwen3 235B A22B",
      family: "qwen",
      attachment: false,
      reasoning: true,
      tool_call: true,
      temperature: true,
      open_weights: true,
      knowledge: "2025-01",
      release_date: "2025-04-29",
      modalities: { input: ["text"], output: ["text"] },
      cost: { input: 0, output: 0 },
      limit: { context: 128000, output: 16384 },
    },
    "qwen3-30b-a3b": {
      id: "qwen3-30b-a3b",
      name: "Qwen3 30B A3B",
      family: "qwen",
      attachment: false,
      reasoning: true,
      tool_call: true,
      temperature: true,
      open_weights: true,
      knowledge: "2025-01",
      release_date: "2025-04-29",
      modalities: { input: ["text"], output: ["text"] },
      cost: { input: 0, output: 0 },
      limit: { context: 128000, output: 8192 },
    },
    "qwen2.5-coder-32b-instruct": {
      id: "qwen2.5-coder-32b-instruct",
      name: "Qwen2.5 Coder 32B Instruct",
      family: "qwen",
      attachment: false,
      reasoning: false,
      tool_call: true,
      temperature: true,
      open_weights: true,
      knowledge: "2024-09",
      release_date: "2024-11-12",
      modalities: { input: ["text"], output: ["text"] },
      cost: { input: 0, output: 0 },
      limit: { context: 128000, output: 8192 },
    },
    "deepseek-r1-distill-llama-70b": {
      id: "deepseek-r1-distill-llama-70b",
      name: "DeepSeek R1 Distill Llama 70B",
      family: "deepseek",
      attachment: false,
      reasoning: true,
      tool_call: false,
      temperature: false,
      open_weights: true,
      knowledge: "2025-01",
      release_date: "2025-01-20",
      modalities: { input: ["text"], output: ["text"] },
      cost: { input: 0, output: 0 },
      limit: { context: 128000, output: 16384 },
    },
    "mistral-devstral-small-2505": {
      id: "mistral-devstral-small-2505",
      name: "Mistral Devstral Small",
      family: "mistral",
      attachment: false,
      reasoning: false,
      tool_call: true,
      temperature: true,
      open_weights: true,
      knowledge: "2024-12",
      release_date: "2025-05-21",
      modalities: { input: ["text"], output: ["text"] },
      cost: { input: 0, output: 0 },
      limit: { context: 128000, output: 8192 },
    },
    "openai-gpt-oss-120b": {
      id: "openai-gpt-oss-120b",
      name: "OpenAI GPT OSS 120B",
      family: "gpt",
      attachment: false,
      reasoning: false,
      tool_call: true,
      temperature: true,
      open_weights: true,
      knowledge: "2024-06",
      release_date: "2025-04-01",
      modalities: { input: ["text"], output: ["text"] },
      cost: { input: 0, output: 0 },
      limit: { context: 128000, output: 16384 },
    },
  },
}

const patchedData = JSON.stringify(snapshot)
await Bun.write(
  path.join(dir, "src/provider/models-snapshot.js"),
  `// @ts-nocheck\n// Auto-generated by build.ts - do not edit\nexport const snapshot = ${patchedData}\n`,
)
await Bun.write(
  path.join(dir, "src/provider/models-snapshot.d.ts"),
  `// Auto-generated by build.ts - do not edit\nexport declare const snapshot: Record<string, unknown>\n`,
)
console.log("Generated models-snapshot.js")
