// FC (function-calling) engine — bridges ToolForge's prompt-FC layer into the
// DeepSeek bridges. Combines: XYML injection, parsing, schema coercion, tool
// name obfuscation, CLI tool profiles, few-shot examples, and FC error retry.

import { config } from "../config.js";
import {
  buildToolInstructions,
  coerceToolInput,
  openAIToolCalls,
  parseToolCalls,
  ParsedToolCall,
  ProtocolSpec,
  renderToolCall,
  ToolCallConfig
} from "../utils/xyml.js";
import {
  collectTaggedContent,
  filterToolCalls,
  startCompletion
} from "./completion-core.js";
import { extractToolCalls } from "../utils/tool-prompt.js";

const THINK_RE = /<think>[\s\S]*?<\/think>/gi;

const SAFE_ALIASES = {
  Read: "fs_open_file",
  Write: "fs_put_file",
  Edit: "fs_patch_file",
  Bash: "shell_run",
  Grep: "text_search",
  Glob: "path_find",
  NotebookEdit: "notebook_patch",
  WebFetch: "http_get_url",
  WebSearch: "web_query"
};
const REVERSE_ALIASES = Object.fromEntries(Object.entries(SAFE_ALIASES).map(([k, v]) => [v, k]));
const SAFE_NAME_RE = /[^A-Za-z0-9_]+/g;
const NAME_NORM_RE = /[^a-z0-9]+/g;

const OPEN_MARKERS = [
  /<\|[A-Za-z0-9_]+\|tool_calls>/i,
  /<tool_calls>/i,
  /<tool_use>/i,
  /"tool_calls"\s*:/i,
  /function\.name\s*:/i
];
const CLOSE_MARKERS = [
  /<\/\|[A-Za-z0-9_]+\|tool_calls>/i,
  /<\/tool_calls>/i,
  /<\/tool_use>/i
];

// --- FC config resolution ---

export function resolveFcConfig() {
  return config.fc;
}

function buildXymlConfig(fcConfig) {
  const emit = fcConfig.protocol || "XYML";
  return new ToolCallConfig({
    emitProtocol: emit,
    parseProtocols: [
      new ProtocolSpec(emit),
      new ProtocolSpec("QNML", { parseOnly: true }),
      new ProtocolSpec("XYML", { parseOnly: true })
    ],
    unknownTool: fcConfig.unknownTool,
    missingRequired: fcConfig.missingRequired,
    promptStyle: fcConfig.promptStyle,
    enableCoercion: true,
    enableDedupe: true
  });
}

// --- Tool name obfuscation ---

export function toSafeName(name) {
  if (name in SAFE_ALIASES) return SAFE_ALIASES[name];
  if (name in REVERSE_ALIASES) return name;
  let cleaned = String(name || "").replace(SAFE_NAME_RE, "_").replace(/^_|_$/g, "");
  if (!cleaned) cleaned = "tool";
  if (/^[A-Z]/.test(cleaned) || cleaned.slice(1).match(/[A-Z]/)) return `u_${cleaned}`;
  return cleaned;
}

export function fromSafeName(name, mapping = null) {
  if (mapping && name in mapping) return mapping[name];
  if (name in REVERSE_ALIASES) return REVERSE_ALIASES[name];
  if (name.startsWith("u_") && name.length > 2) return name.slice(2);
  return name;
}

function obfuscateTools(openaiTools) {
  const mapping = {};
  const out = [];
  for (const tool of openaiTools || []) {
    const fn = tool.function ?? tool;
    const safe = toSafeName(fn.name);
    mapping[safe] = fn.name;
    out.push({ ...tool, function: { ...fn, name: safe } });
  }
  return { tools: out, mapping };
}

function deobfuscateCalls(calls, mapping) {
  if (!mapping) return calls;
  return calls.map((c) => ({ ...c, function: { ...c.function, name: fromSafeName(c.function.name, mapping) } }));
}

// --- CLI tool profiles ---

function normName(name) {
  return String(name || "").toLowerCase().replace(NAME_NORM_RE, "");
}

function detectToolProfile(tools) {
  const names = new Set((tools || []).map((t) => normName(t.function?.name ?? t.name)).filter(Boolean));
  const has = (n) => names.has(n);
  const hasAny = (arr) => arr.some(has);
  const hasAll = (arr) => arr.every(has);

  if (hasAny(["skillslist", "skillview"]) || hasAll(["readfile", "terminal", "writefile"])) {
    return { id: "hermes", displayName: "Hermes", rules: [
      "Use exact Hermes tool names from the list; never invent Claude Code names.",
      "Prefer skills_list/skill_view when exploring skills."
    ]};
  }
  if (hasAny(["sessionsspawn", "exec"]) || (has("process") && has("exec"))) {
    return { id: "openclaw", displayName: "OpenClaw", rules: [
      "Map file work to available read/write/exec tools only.",
      "Use process only for background job control."
    ]};
  }
  if (hasAll(["bash", "read", "write"]) || hasAny(["task", "agent"])) {
    return { id: "claude_code", displayName: "Claude Code", rules: [
      "Use exact PascalCase tool names (Read/Write/Bash/...) as listed.",
      "Prefer direct tools over Task/Agent when a single step suffices."
    ]};
  }
  if (hasAny(["bash", "read", "write", "edit"]) && has("todowrite")) {
    return { id: "opencode", displayName: "OpenCode", rules: [
      "Use exact lowercase tool names from the list.",
      "todowrite is for planning only, not for file changes."
    ]};
  }
  return { id: "generic", displayName: "Generic CLI", rules: [
    "Use the exact action names listed; do not translate to another CLI's names."
  ]};
}

function profileInstructionBlock(profile) {
  return [`[CLIENT TOOL PROFILE: ${profile.displayName}]`, ...profile.rules].join("\n");
}

function buildFewShotBlock(tools, maxExamples = 2) {
  const skip = ["todo", "task", "agent", "cron", "skill"];
  const picked = [];
  for (const tool of tools || []) {
    const key = normName(tool.function?.name ?? tool.name);
    if (skip.some((s) => key.includes(s))) continue;
    picked.push(tool);
    if (picked.length >= maxExamples) break;
  }
  if (!picked.length) return "";
  const lines = ["[FEW-SHOT]", "When you need a tool, emit the protocol block immediately."];
  for (const tool of picked) {
    const props = (tool.function?.parameters ?? tool.parameters ?? {}).properties;
    const sampleArgs = {};
    if (props && typeof props === "object") {
      for (const key of Object.keys(props).slice(0, 2)) sampleArgs[key] = "...";
    }
    const argHint = Object.keys(sampleArgs).map((k) => `${k}="..."`).join(", ") || "...";
    lines.push(`- Example tool: ${tool.function?.name ?? tool.name}(${argHint})`);
  }
  return lines.join("\n");
}

// --- Instruction injection ---

export function buildFcInstructions(tools, toolChoice, fcConfig = resolveFcConfig()) {
  if (!tools?.length || toolChoice === "none") return null;
  const xymlConfig = buildXymlConfig(fcConfig);
  let base = buildToolInstructions(tools, { config: xymlConfig });

  const extra = [];
  if (fcConfig.enableCliProfiles) {
    extra.push(profileInstructionBlock(detectToolProfile(tools)));
    const few = buildFewShotBlock(tools);
    if (few) extra.push(few);
  }
  if (extra.length) base = `${base}\n\n${extra.join("\n\n")}`;

  if (toolChoice === "required") {
    base += "\n\nIMPORTANT: You MUST call at least one tool. Do not respond with plain text — output a tool call.";
  }
  if (toolChoice && typeof toolChoice === "object" && toolChoice?.function?.name) {
    base += `\n\nIMPORTANT: You MUST call the function "${toolChoice.function.name}". Do not respond with plain text — output the tool call.`;
  }
  base += "\n\nIf you do NOT need to call any tool, respond normally without any tool-call block.";
  return base;
}

// --- History rendering for prompt ---

export function renderAssistantToolCall(name, argsObj) {
  return renderToolCall(name, argsObj ?? {});
}

export function renderToolResultHeader({ name, toolCallId }) {
  const idPart = toolCallId ? ` id=${toolCallId}` : "";
  const namePart = name ? ` name=${name}` : "";
  return `[Tool Result${idPart}${namePart}]`;
}

// --- Parsing ---

export function stripThinkTags(text) {
  if (!text) return "";
  return text.replace(THINK_RE, "");
}

export function parseTextToCalls(text, tools, fcConfig = resolveFcConfig()) {
  const source = fcConfig.stripThinkTags ? stripThinkTags(text) : (text || "");
  return parseToolCalls(source, tools, { config: buildXymlConfig(fcConfig) });
}

export function toOpenAIToolCalls(parsedCalls) {
  return openAIToolCalls(parsedCalls);
}

// Parse model text and finalize into OpenAI-shaped tool calls, applying
// deobfuscation + fuzzy name resolution + argument normalization.
export function finalizeToolCalls(text, originalTools, fcContext, externalAliases = null, debugCtx = null) {
  if (!text) return null;

  let parsed = parseTextToCalls(text, fcContext.activeTools, fcContext.fcConfig);
  if (fcContext.nameMap) {
    parsed = parsed.map((c) => new ParsedToolCall({ id: c.id, name: fromSafeName(c.name, fcContext.nameMap), input: c.input }));
  }

  let openaiCalls = toOpenAIToolCalls(parsed);

  if (originalTools?.length) {
    openaiCalls = filterToolCalls(openaiCalls, originalTools, externalAliases);
  } else {
    openaiCalls = openaiCalls.length ? openaiCalls : null;
  }

  debugCtx?.logToolParsing({
    inputLength: text.length,
    strategiesTried: ["xyml"],
    successStrategy: openaiCalls ? "xyml" : null,
    rawResultCount: openaiCalls?.length ?? 0,
    rawResults: openaiCalls?.map((tc) => ({ name: tc.function.name, argLength: tc.function.arguments.length })) ?? []
  });

  return openaiCalls;
}

// --- Recovery / retry ---

export function isToolCallTruncated(text) {
  if (!text) return false;
  const hasOpen = OPEN_MARKERS.some((re) => re.test(text));
  if (!hasOpen) return false;
  const hasClose = CLOSE_MARKERS.some((re) => re.test(text));
  if (hasClose) {
    return /[,:[{]$/.test(text.replace(/\s+$/, ""));
  }
  return true;
}

export function buildRetryMessage(originalOutput, reason = "parse_failed") {
  const snippet = (originalOutput || "").slice(-2000);
  if (reason === "truncated") {
    return `Your previous tool-call output was truncated mid-envelope. Re-emit the COMPLETE tool call protocol block only, with no extra commentary.\n\nPrevious output (truncated):\n${snippet}`;
  }
  return `Your previous tool-call output could not be parsed. Re-emit a valid tool call protocol block for the listed tools only.\n\nPrevious output:\n${snippet}`;
}

export function analyzeFcRecovery(text, tools, fcConfig = resolveFcConfig()) {
  const calls = parseTextToCalls(text, tools, fcConfig);
  if (calls.length) return { calls, reason: null };
  if (isToolCallTruncated(text)) return { calls: [], reason: "truncated", retryMessage: buildRetryMessage(text, "truncated") };
  if (text && OPEN_MARKERS.some((re) => re.test(text))) {
    return { calls: [], reason: "parse_failed", retryMessage: buildRetryMessage(text, "parse_failed") };
  }
  return { calls: [], reason: null };
}

// --- Context preparation ---

export function prepareFcContext(tools, fcConfig = resolveFcConfig()) {
  let activeTools = tools;
  let nameMap = null;
  if (fcConfig.obfuscateToolNames && tools?.length) {
    const r = obfuscateTools(tools);
    activeTools = r.tools;
    nameMap = r.mapping;
  }
  return { activeTools, nameMap, fcConfig };
}

// --- Completion + parse with retry (non-streaming) ---

export async function completeAndParseWithRetry({
  account,
  requestOptions,
  sessionId,
  debugCtx,
  refFileIds,
  fcContext,
  externalAliases = null
}) {
  const basePrompt = requestOptions.prompt;
  let currentPrompt = basePrompt;
  let last = { content: "", reasoningContent: "", toolCalls: null };
  const maxAttempts = fcContext.fcConfig.fcErrorRetry ? 1 + Math.max(0, fcContext.fcConfig.fcErrorRetryMax) : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const req = attempt === 0 ? requestOptions : { ...requestOptions, prompt: currentPrompt };
    const { response } = await startCompletion({ account, requestOptions: req, sessionId, debugCtx, refFileIds });
    const { content, reasoningContent } = await collectTaggedContent(response.body, debugCtx);

    const toolCalls = requestOptions.tools?.length
      ? finalizeToolCalls(content, requestOptions.tools, fcContext, externalAliases, debugCtx)
      : (extractToolCalls(content, debugCtx) || null);

    last = { content, reasoningContent, toolCalls };
    if (toolCalls) break;
    if (!requestOptions.tools?.length || !content || !fcContext.fcConfig.fcErrorRetry) break;

    const analysis = analyzeFcRecovery(content, fcContext.activeTools, fcContext.fcConfig);
    debugCtx?.logToolDetection({ retryAttempt: attempt + 1, reason: analysis.reason });
    if (!analysis.reason) break;
    currentPrompt = `${basePrompt}\n\nASSISTANT: ${content}\n\nUSER: ${analysis.retryMessage}`;
  }

  return last;
}
