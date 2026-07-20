// XYML tool-call engine — protocol-agnostic helpers for LLM function calling.
// Ported from ToolForge (app/engine/xyml.py). Depends only on Node.js stdlib.

import { randomBytes } from "node:crypto";

const DEFAULT_RAW_STRING_PARAMS = new Set([
  "content", "command", "cmd", "script", "code", "prompt", "file_content",
  "old_string", "new_string", "insert_text", "patch", "pattern", "text",
  "query", "url", "path", "file_path"
]);

const DEFAULT_TOOL_ALIASES = {
  fs_open_file: "Read",
  fs_put_file: "Write",
  fs_patch_file: "Edit",
  shell_run: "Bash",
  text_search: "Grep",
  path_find: "Glob",
  notebook_patch: "NotebookEdit",
  http_get_url: "WebFetch",
  web_query: "WebSearch"
};

const SAFE_TOOL_ALIASES = {
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

const MARKUP_REPLACEMENTS = [
  ["＜", "<"], ["＞", ">"], ["／", "/"], ["∕", "/"], ["⁄", "/"], ["＝", "="],
  ["｜", "|"], ["│", "|"], ["┃", "|"], ["▏", "|"], ["▕", "|"],
  ["“", '"'], ["”", '"'], ["‘", "'"], ["’", "'"],
  ["﹤", "<"], ["﹥", ">"]
];

export function randomId(length = 12) {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function randomCallId() {
  return `call_${randomId(12)}`;
}

export class ParsedToolCall {
  constructor({ name = "", input = {}, id = "" } = {}) {
    this.name = name;
    this.input = input === null ? {} : input;
    this.id = id || randomCallId();
  }
}

export class ProtocolSpec {
  constructor(name, { parseOnly = false, tags = null } = {}) {
    if (typeof name !== "string" || !name.trim()) {
      throw new TypeError("ProtocolSpec name must be a non-empty string");
    }
    this.name = name.trim();
    this.parseOnly = Boolean(parseOnly);
    const supplied = tags || {};
    this.tags = {
      root: supplied.root || "tool_calls",
      invoke: supplied.invoke || "invoke",
      parameter: supplied.parameter || "parameter"
    };
  }
}

export class ToolCallConfig {
  constructor(options = {}) {
    const values = { ...options };

    this.emitProtocol = String(_takeOption(values, "emitProtocol", "emit_protocol", "defaultProtocol", "default_protocol", { default: "XYML" }) || "XYML").trim();
    let protocols = _takeOption(values, "parseProtocols", "parse_protocols", "protocols");
    if (protocols == null) {
      protocols = [new ProtocolSpec(this.emitProtocol), new ProtocolSpec("QNML", { parseOnly: true })];
    }
    this.parseProtocols = _normalizeProtocolSpecs(protocols, this.emitProtocol);
    this.strict = Boolean(_takeOption(values, "strict", { default: false }));
    this.unknownTool = _takeOption(values, "unknownTool", "unknown_tool", { default: "drop" });
    this.missingRequired = _takeOption(values, "missingRequired", "missing_required", { default: "drop" });
    this.enableMarkup = Boolean(_takeOption(values, "enableMarkup", "enable_markup", { default: true }));
    this.enableXml = Boolean(_takeOption(values, "enableXml", "enable_xml", { default: true }));
    this.enableJson = Boolean(_takeOption(values, "enableJson", "enable_json", { default: true }));
    this.enableTextKv = Boolean(_takeOption(values, "enableTextKv", "enable_text_kv", { default: true }));
    this.enableCoercion = Boolean(_takeOption(values, "enableCoercion", "enable_coercion", { default: true }));
    this.enableDedupe = Boolean(_takeOption(values, "enableDedupe", "enable_dedupe", { default: true }));
    this.promptStyle = _takeOption(values, "promptStyle", "prompt_style", { default: "standard" });
    this.toolAliases = { ...DEFAULT_TOOL_ALIASES, ...(_takeOption(values, "toolAliases", "tool_aliases", { default: {} }) || {}) };
    this.argumentAliases = { ...(_takeOption(values, "argumentAliases", "argument_aliases", { default: {} }) || {}) };
    const customRaw = _takeOption(values, "rawStringParams", "raw_string_params", { default: [] }) || [];
    this.rawStringParams = new Set(DEFAULT_RAW_STRING_PARAMS);
    for (const v of customRaw) this.rawStringParams.add(String(v).toLowerCase());
    const idFactory = _takeOption(values, "idFactory", "id_factory", { default: randomCallId });
    if (typeof idFactory !== "function") throw new TypeError("id_factory must be callable");
    this.idFactory = idFactory;
  }

  static default() { return new ToolCallConfig(); }
}

export function normalizeTools(value) {
  const out = [];
  for (const raw of _asList(value)) {
    if (!_isMapping(raw)) continue;
    if (raw.type === "function" && _isMapping(raw.function)) {
      out.push({ ...raw.function });
    } else if (typeof raw.name === "string" && raw.name.trim()) {
      out.push({ ...raw });
    }
  }
  return out;
}

export function buildToolInstructions(tools, { config = null, protocol = null } = {}) {
  const cfg = _resolveConfig(config);
  const activeProtocol = _normalizeProtocolSpec(protocol || cfg.emitProtocol);
  const normalizedTools = normalizeTools(tools);
  const safeTools = normalizedTools.map((t) => ({ ...t, name: _safeToolName(t.name) }));
  const names = safeTools.map((t) => t.name).filter(Boolean);
  const schemas = [];
  for (const tool of safeTools) {
    const parameters = tool.parameters || tool.input_schema || {};
    schemas.push([
      `Action name: ${tool.name}`,
      `Description: ${_clip(tool.description || "", 240)}`,
      `Parameters: ${_summarizeSchema(parameters)}`
    ].join("\n"));
  }
  const exampleTools = safeTools.slice(0, 2).length ? safeTools.slice(0, 2) : [
    { name: "TOOL_NAME", parameters: { type: "object", properties: { ARG: { type: "string" } } } }
  ];
  const examples = exampleTools.map((t) =>
    renderToolCall(t.name, _exampleInputFromTool(t), { config: cfg, protocol: activeProtocol })
  ).join("\n\n");
  const accepted = cfg.parseProtocols.map((s) => s.name).join(", ");
  const schemaBlock = schemas.length ? `You have access to these tools:\n\n${schemas.join("\n\n")}\n\n` : "";
  let defensiveRules = "";
  if (cfg.promptStyle !== "minimal") {
    defensiveRules = `
RULES:
1. If a tool is needed, output a parseable ${activeProtocol.name} tool-call block. If no tool is needed, answer normally.
2. Use exact action names and parameter names from the schema.
3. Strings should use <![CDATA[...]]>; objects may use JSON or nested XML-like values; arrays may use JSON arrays or repeated <item> nodes.
4. Never emit empty required parameters. Ask normally if required information is unknown.
5. After a tool result, call another tool only if needed; otherwise answer normally.
6. Path-like parameters must contain only the path string, not prose or protocol fragments.
`;
  }
  const renderedFormat = renderToolCall("TOOL_NAME", { ARG: "value" }, { config: cfg, protocol: activeProtocol });
  return `=== ${activeProtocol.name} TOOL CALL PROTOCOL ===
${schemaBlock}Default protocol for new tool calls: ${activeProtocol.name}
Accepted parse protocols by this client: ${accepted}
Available action names: ${names.join(", ")}

FORMAT:
${renderedFormat}
${defensiveRules}
CORRECT EXAMPLES:

${examples}

Remember: the preferred tool-call form is <|${activeProtocol.name}|tool_calls>...</|${activeProtocol.name}|tool_calls>.
=== END ${activeProtocol.name} TOOL INSTRUCTIONS ===`;
}

export function renderToolCall(name, input = null, { config = null, protocol = null } = {}) {
  const cfg = _resolveConfig(config);
  const activeProtocol = _normalizeProtocolSpec(protocol || cfg.emitProtocol);
  const callName = String(name || "").trim();
  if (!callName) return "";
  const arguments_ = _isMapping(input) ? { ...input } : { input };
  const pname = activeProtocol.name;
  const root = activeProtocol.tags.root;
  const invoke = activeProtocol.tags.invoke;
  const parameter = activeProtocol.tags.parameter;
  const lines = [
    `<|${pname}|${root}>`,
    `  <|${pname}|${invoke} name="${_escapeXml(callName)}">`
  ];
  for (const key of Object.keys(arguments_).sort((a, b) => String(a).localeCompare(String(b)))) {
    lines.push(`    <|${pname}|${parameter} name="${_escapeXml(key)}">${_renderMarkupValue(arguments_[key])}</|${pname}|${parameter}>`);
  }
  lines.push(`  </|${pname}|${invoke}>`, `</|${pname}|${root}>`);
  return lines.join("\n");
}

export function renderToolCalls(calls, { config = null, protocol = null } = {}) {
  return _asList(calls).map((c) =>
    renderToolCall(_callValue(c, "name"), _callValue(c, "input", {}), { config, protocol })
  ).filter(Boolean).join("\n\n");
}

export function parseToolCalls(text, tools = null, { config = null } = {}) {
  const cfg = _resolveConfig(config);
  const normalizedTools = normalizeTools(tools);
  if (!String(text || "").trim() || normalizedTools.length === 0) return [];
  const allowed = _buildAllowedToolMap(normalizedTools, cfg);
  let calls = [];
  if (cfg.enableMarkup) {
    for (const protocol of cfg.parseProtocols) {
      calls.push(..._parseProtocolMarkup(text, protocol, allowed, normalizedTools, cfg));
    }
  }
  if (cfg.enableXml) calls.push(..._parseXmlToolCalls(text, allowed, cfg));
  if (cfg.enableJson) {
    _forEachJsonFragment(text, (value) => calls.push(..._parseJsonToolCalls(value, allowed, cfg)));
  }
  if (cfg.enableTextKv) calls.push(..._parseTextKvToolCalls(text, allowed, normalizedTools, cfg));
  let fixed = calls;
  if (cfg.enableCoercion) {
    fixed = [];
    for (const call of calls) {
      const coerced = _coerceParsedCall(call, normalizedTools, cfg);
      if (coerced) fixed.push(coerced);
    }
  }
  return cfg.enableDedupe ? _dedupeToolCalls(fixed) : fixed;
}

export function parseMarkupToolCalls(text, tools = null, { config = null, protocols = null } = {}) {
  const cfg = _resolveConfig(config);
  const normalizedTools = normalizeTools(tools);
  const allowed = _buildAllowedToolMap(normalizedTools, cfg);
  const activeProtocols = protocols != null ? _normalizeProtocolSpecs(protocols, cfg.emitProtocol) : cfg.parseProtocols;
  let calls = [];
  for (const protocol of activeProtocols) {
    calls.push(..._parseProtocolMarkup(text, protocol, allowed, normalizedTools, cfg));
  }
  let fixed = [];
  for (const call of calls) {
    const coerced = _coerceParsedCall(call, normalizedTools, cfg);
    if (coerced) fixed.push(coerced);
  }
  return cfg.enableDedupe ? _dedupeToolCalls(fixed) : fixed;
}

export function coerceToolInput(name, input, tools = null, { config = null } = {}) {
  const cfg = _resolveConfig(config);
  let fixed = _coerceToolInputBySchema(name, input, normalizeTools(tools));
  if (!_isMapping(fixed)) return fixed;
  fixed = { ...fixed };
  const aliases = _isMapping(cfg.argumentAliases) ? (cfg.argumentAliases[name] || {}) : {};
  for (const [canonical, alternateNames] of Object.entries(aliases)) {
    _renameFirstPresent(fixed, canonical, ..._asList(alternateNames));
  }
  if (name === "AskUserQuestion") {
    if (fixed.question != null && fixed.questions == null) {
      fixed.questions = [{ question: fixed.question, header: "Question", multiSelect: false, options: [{ label: "Yes", description: "Confirm" }, { label: "No", description: "Decline" }] }];
      delete fixed.question;
    }
    if (fixed.questions != null && !Array.isArray(fixed.questions)) fixed.questions = [fixed.questions];
  } else if (name === "Agent") {
    fixed.description = fixed.description ?? "Execute sub-task";
    fixed.prompt = fixed.prompt ?? fixed.description;
  } else if (name === "Read") {
    _renameFirstPresent(fixed, "file_path", "path", "filename", "file");
  } else if (name === "Write") {
    _renameFirstPresent(fixed, "file_path", "path", "target_file", "filename", "file");
    _renameFirstPresent(fixed, "content", "text", "body", "data", "file_content", "contents", "value");
  } else if (name === "Edit") {
    _renameFirstPresent(fixed, "file_path", "path", "target_file", "filename", "file");
  } else if (name === "Bash" || name === "PowerShell") {
    _renameFirstPresent(fixed, "command", "cmd", "script");
  } else if (fixed.query == null && fixed.queries != null && _toolAcceptsField(name, tools, "query")) {
    const queries = fixed.queries;
    delete fixed.queries;
    if (Array.isArray(queries)) {
      fixed.query = queries.map((v) => String(v || "")).filter(Boolean).join("\n");
    } else {
      fixed.query = String(queries).trim();
    }
  }
  return fixed;
}

export function openAIToolCalls(calls) {
  return _asList(calls).map((call) => ({
    id: _callValue(call, "id"),
    type: "function",
    function: {
      name: _callValue(call, "name"),
      arguments: _argumentsString(_callValue(call, "input", {}))
    }
  }));
}

export function responsesToolItems(calls) {
  return _asList(calls).map((call) => ({
    id: `fc_${randomId(12)}`,
    type: "function_call",
    status: "completed",
    call_id: _callValue(call, "id"),
    name: _callValue(call, "name"),
    arguments: _argumentsString(_callValue(call, "input", {}))
  }));
}

export function anthropicToolUseBlocks(calls) {
  return _asList(calls).map((call) => ({
    type: "tool_use",
    id: _callValue(call, "id"),
    name: _callValue(call, "name"),
    input: _callValue(call, "input", {})
  }));
}

export class ToolSieve {
  constructor(tools = null, { config = null, holdLength = 96 } = {}) {
    this.config = _resolveConfig(config);
    this.tools = normalizeTools(tools);
    this.pending = "";
    this.capture = "";
    this.capturing = false;
    this.holdLength = holdLength;
  }

  processChunk(chunk) {
    if (!chunk) return [];
    this.pending += String(chunk);
    const events = [];
    if (this.capturing) {
      this.capture += this.pending;
      this.pending = "";
      const consumed = this._consumeCapture(false);
      if (consumed) events.push(...consumed);
      return events;
    }
    const start = _firstToolMarkerIndex(this.pending, this.config);
    if (start >= 0) {
      const prefix = this.pending.slice(0, start);
      if (prefix) events.push({ type: "content", text: prefix });
      this.capture = this.pending.slice(start);
      this.pending = "";
      this.capturing = true;
      const consumed = this._consumeCapture(false);
      if (consumed) events.push(...consumed);
      return events;
    }
    if (this.pending.length <= this.holdLength) return events;
    const safe = this.pending.slice(0, -this.holdLength);
    this.pending = this.pending.slice(-this.holdLength);
    if (safe) events.push({ type: "content", text: safe });
    return events;
  }

  flush() {
    const events = [];
    if (this.capturing && this.capture) {
      const consumed = this._consumeCapture(true);
      if (consumed) {
        events.push(...consumed);
      } else {
        events.push({ type: "content", text: this.capture });
      }
      this.capture = "";
      this.capturing = false;
    }
    if (this.pending) {
      events.push({ type: "content", text: this.pending });
      this.pending = "";
    }
    return events;
  }

  _consumeCapture(force) {
    if (!force && _hasOpenProtocolBlock(this.capture, this.config) && !_looksStructurallyClosed(this.capture, this.config)) {
      return null;
    }
    const calls = parseToolCalls(this.capture, this.tools, { config: this.config });
    if (!calls.length) return null;
    this.capture = "";
    this.capturing = false;
    return [{ type: "tool_calls", calls }];
  }
}

// --- internal helpers ---

function _parseProtocolMarkup(text, protocol, allowed, tools, config) {
  const canonical = _canonicalizeMarkup(_stripMarkdownFences(String(text || "")));
  let calls = [];
  for (const candidate of _extractProtocolCandidates(canonical, protocol)) {
    const re = _protocolTagBlockRe(protocol, protocol.tags.invoke);
    for (const match of candidate.matchAll(re)) {
      const name = _canonicalToolName(_extractNameAttr(match[1]), allowed, config);
      if (!name) continue;
      const input = _parseProtocolParameters(match[2], protocol, config);
      calls.push(new ParsedToolCall({ id: config.idFactory(), name, input }));
    }
  }
  if (!calls.length) {
    calls.push(..._parseLooseProtocolCalls(canonical, protocol, allowed, tools, config));
  }
  return calls;
}

function _extractProtocolCandidates(text, protocol) {
  const candidates = [];
  const re = _protocolTagBlockRe(protocol, protocol.tags.root);
  for (const match of text.matchAll(re)) candidates.push(match[2]);
  if (candidates.length) return candidates;
  const openRe = _protocolOpenTagRe(protocol, protocol.tags.invoke);
  const m = openRe.exec(text);
  return m ? [text.slice(m.index)] : [];
}

function _parseProtocolParameters(body, protocol, config) {
  const out = {};
  const re = _protocolTagBlockRe(protocol, protocol.tags.parameter);
  for (const match of body.matchAll(re)) {
    const name = _extractNameAttr(match[1]);
    if (name) out[name] = _decodeMarkupValue(match[2], name, config);
  }
  return Object.keys(out).length > 0 ? out : _parseTextKvInput(body);
}

function _parseLooseProtocolCalls(text, protocol, allowed, tools, config) {
  const probe = new RegExp(`\\b${_escapeRegExp(protocol.name)}\\b`, "i");
  if (!probe.test(text)) return [];
  const attrRe = /\b(?:name|parameter)\s*=\s*(?:"([^"]*)"|'([^']*)'|([A-Za-z0-9_.:-]+))/gim;
  const attributes = [];
  let m;
  while ((m = attrRe.exec(text)) !== null) {
    const raw = _htmlUnescape((m[1] ?? m[2] ?? m[3] ?? "").trim());
    if (!raw) continue;
    const name = _canonicalToolName(raw, allowed, config);
    attributes.push({ raw, name: name || raw, isTool: Boolean(name), position: m.index });
  }
  const calls = [];
  for (let i = 0; i < attributes.length; i++) {
    const { raw, name, isTool } = attributes[i];
    if (!isTool) continue;
    let nextTool = text.length;
    for (let j = i + 1; j < attributes.length; j++) {
      if (attributes[j].isTool) { nextTool = attributes[j].position; break; }
    }
    const input = {};
    for (let j = i + 1; j < attributes.length; j++) {
      const f = attributes[j];
      if (f.position >= nextTool || f.isTool) break;
      const slice = text.slice(f.position, nextTool);
      const cdata = slice.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
      if (cdata) input[f.raw] = _decodeMarkupValue(cdata[1], f.raw, config);
    }
    const filtered = _filterInputForTool(name, input, tools);
    if (Object.keys(filtered).length === 0 && _requiredToolArgs(name, tools).length > 0) continue;
    calls.push(new ParsedToolCall({ id: config.idFactory(), name, input: filtered }));
  }
  return calls;
}

function _parseXmlToolCalls(text, allowed, config) {
  const calls = [];
  const raw = String(text || "");
  const toolCallRe = /<tool_call\b[^>]*>\s*([\s\S]*?)\s*<\/tool_call\s*>/gi;
  let m;
  while ((m = toolCallRe.exec(raw)) !== null) {
    const body = m[1].trim();
    const parsed = _tryJson(body);
    calls.push(..._parseJsonToolCalls(parsed[0] ? parsed[1] : _parseToolInput(body), allowed, config));
  }
  for (const expression of [
    /<tool_use\b([^>]*)>([\s\S]*?)<\/tool_use>/gi,
    /<tool_call\b([^>]*)>([\s\S]*?)<\/tool_call>/gi,
    /<function\b([^>]*)>([\s\S]*?)<\/function>/gi,
    /<invoke\b([^>]*)>([\s\S]*?)<\/invoke>/gi
  ]) {
    while ((m = expression.exec(raw)) !== null) {
      const name = _canonicalToolName(_extractNameAttr(m[1]), allowed, config);
      if (name) {
        calls.push(new ParsedToolCall({ id: config.idFactory(), name, input: _parseToolInput(m[2].trim()) }));
      }
    }
  }
  return calls;
}

function _parseJsonToolCalls(value, allowed, config) {
  const calls = [];
  if (Array.isArray(value)) {
    for (const item of value) calls.push(..._parseJsonToolCalls(item, allowed, config));
    return calls;
  }
  if (!_isMapping(value)) return calls;
  for (const key of ["tool_calls", "tools"]) {
    if (Array.isArray(value[key])) {
      for (const item of value[key]) calls.push(..._parseJsonToolCalls(item, allowed, config));
    }
  }
  let name = _firstString(value.name, value.tool, value.tool_name, value.function_name);
  let input = _firstDefined(value.input, value.arguments, value.args, value.parameters);
  const fn = value.function;
  if (_isMapping(fn)) {
    name = name || _firstString(fn.name);
    if (input == null) input = _firstDefined(fn.arguments, fn.input, fn.parameters);
  }
  const canonicalName = _canonicalToolName(name, allowed, config);
  if (canonicalName) {
    calls.push(new ParsedToolCall({
      id: _firstString(value.id, value.call_id) || config.idFactory(),
      name: canonicalName,
      input: _normalizeToolInput(input)
    }));
  }
  return calls;
}

function _parseTextKvToolCalls(text, allowed, tools, config) {
  const values = { name: [], arguments: [] };
  let current = "";
  const aliases = {
    "function.name": "name", "name": "name", "tool": "name", "tool.name": "name",
    "tool_name": "name", "function.arguments": "arguments", "arguments": "arguments",
    "args": "arguments", "input": "arguments", "tool_input": "arguments", "parameters": "arguments"
  };
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const m = line.match(/^([A-Za-z_.-][A-Za-z0-9_.-]*)\s*:\s*([\s\S]*)$/);
    if (m && aliases[m[1].toLowerCase()]) {
      current = aliases[m[1].toLowerCase()];
      values[current].push(m[2].trim());
      continue;
    }
    if (current) values[current].push(rawLine);
  }
  if (!values.name.length) return [];
  const rawName = values.name.join("\n").split(/\r?\n/)[0].trim().replace(/^['"]|['"]$/g, "");
  const name = _canonicalToolName(rawName, allowed, config);
  if (!name) return [];
  const input = _normalizeToolInput(values.arguments.join("\n").trim());
  const call = _coerceParsedCall(new ParsedToolCall({ id: config.idFactory(), name, input }), tools, config);
  return call ? [call] : [];
}

function _coerceParsedCall(call, tools, config) {
  const input = coerceToolInput(call.name, call.input, tools, { config });
  if (config.unknownTool === "error" && _toolSchema(call.name, tools) == null) {
    throw new Error(`Unknown tool: ${call.name}`);
  }
  if (_missingRequiredArgs(call.name, input, tools)) {
    if (config.missingRequired === "error" || config.strict) {
      throw new Error(`Missing required arguments for tool: ${call.name}`);
    }
    if (config.missingRequired === "drop") return null;
  }
  if (_invalidToolArgs(input)) return null;
  return new ParsedToolCall({ id: call.id, name: call.name, input });
}

function _coerceToolInputBySchema(name, input, tools) {
  if (!_isMapping(input)) return input;
  const properties = _schemaProperties(_toolSchema(name, tools));
  if (!properties) return input;
  const fixed = { ...input };
  for (const key of Object.keys(fixed)) {
    if (_isMapping(properties[key])) {
      fixed[key] = _coerceValueBySchema(fixed[key], properties[key]);
    }
  }
  return fixed;
}

function _coerceValueBySchema(value, schema) {
  const types = _schemaTypes(schema);
  if (typeof value === "string" && (types.has("array") || types.has("object"))) {
    const r = _parseJsonStringForSchema(value, types.has("array"), types.has("object"));
    if (r.changed) value = r.value;
  }
  if (types.has("array")) {
    if (_isMapping(value)) value = [value];
    if (Array.isArray(value) && _isMapping(schema.items)) {
      return value.map((item) => _coerceValueBySchema(item, schema.items));
    }
    return value;
  }
  if (types.has("object") && _isMapping(value)) {
    const properties = _schemaProperties(schema);
    if (!properties) return value;
    const fixed = { ...value };
    for (const key of Object.keys(fixed)) {
      if (_isMapping(properties[key])) fixed[key] = _coerceValueBySchema(fixed[key], properties[key]);
    }
    return fixed;
  }
  return value;
}

function _parseJsonStringForSchema(value, wantArray, wantObject) {
  const stripped = value.trim();
  if (!stripped) return { value, changed: false };
  const candidates = [stripped];
  if (wantArray && !stripped.startsWith("[")) candidates.push(`[${stripped}]`);
  for (const candidate of candidates) {
    const r = _tryJson(candidate);
    if (!r[0]) continue;
    const parsed = r[1];
    if (wantArray && Array.isArray(parsed)) return { value: parsed, changed: true };
    if (wantArray && _isMapping(parsed)) return { value: [parsed], changed: true };
    if (wantObject && _isMapping(parsed)) return { value: parsed, changed: true };
  }
  return { value, changed: false };
}

function _normalizeToolInput(value) {
  if (value == null) return {};
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    const r = _tryJson(trimmed);
    if (r[0]) return _normalizeToolInput(r[1]);
    const keyValues = _parseTextKvInput(trimmed);
    return Object.keys(keyValues).length ? keyValues : value;
  }
  return value;
}

function _parseToolInput(text) {
  if (!text) return {};
  const r = _tryJson(text);
  if (r[0]) return _normalizeToolInput(r[1]);
  const parameters = {};
  const re = /<([A-Za-z_][A-Za-z0-9_.:-]*)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    parameters[m[1]] = _decodeMarkupValue(m[2], m[1], ToolCallConfig.default());
  }
  if (Object.keys(parameters).length) return parameters;
  const keyValues = _parseTextKvInput(text);
  return Object.keys(keyValues).length ? keyValues : { input: text };
}

function _parseTextKvInput(text) {
  const out = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const equals = line.indexOf("=");
    const colon = line.indexOf(":");
    const separator = colon < 0 ? equals : (equals < 0 ? colon : (colon < equals ? colon : equals));
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) out[key] = value;
  }
  return out;
}

function _forEachJsonFragment(text, visit) {
  const normalized = _stripJsonFence(String(text || ""));
  for (const candidate of [normalized, _repairLooseJson(normalized), _recoverJsonLike(normalized)]) {
    const r = _tryJson(candidate);
    if (r[0]) visit(r[1]);
  }
  const starts = [];
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === "{") starts.push(i);
  }
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === "[") starts.push(i);
  }
  for (const start of starts) {
    for (let end = normalized.length; end > start; end--) {
      const fragment = normalized.slice(start, end);
      let r = _tryJson(fragment);
      if (r[0]) { visit(r[1]); break; }
      r = _tryJson(_repairLooseJson(fragment));
      if (r[0]) { visit(r[1]); break; }
    }
  }
}

function _buildAllowedToolMap(tools, config) {
  const allowed = {};
  for (const tool of tools) {
    const name = tool.name;
    if (!name) continue;
    allowed[_toolAliasKey(name)] = name;
    const alias = SAFE_TOOL_ALIASES[name];
    if (alias) allowed[_toolAliasKey(alias)] = name;
  }
  for (const [alias, canonical] of Object.entries(config.toolAliases)) {
    const real = allowed[_toolAliasKey(canonical)] || canonical;
    allowed[_toolAliasKey(alias)] = real;
  }
  return allowed;
}

function _canonicalToolName(name, allowed, config) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const direct = allowed[_toolAliasKey(raw)];
  if (direct) return direct;
  const configured = config.toolAliases[raw] || config.toolAliases[raw.toLowerCase()];
  if (configured && allowed[_toolAliasKey(configured)]) return allowed[_toolAliasKey(configured)];
  if (raw.startsWith("u_")) return allowed[_toolAliasKey(raw.slice(2))] || "";
  return config.unknownTool === "drop" ? "" : raw;
}

function _dedupeToolCalls(calls) {
  const seen = new Set();
  const out = [];
  for (const call of calls) {
    const key = `${_toolAliasKey(call.name)}\0${_stableStringify(call.input)}`;
    if (!call.name || seen.has(key)) continue;
    seen.add(key);
    out.push(call);
  }
  return out;
}

function _toolSchema(name, tools) {
  for (const tool of normalizeTools(tools)) {
    if (tool.name === name && (_isMapping(tool.parameters) || _isMapping(tool.input_schema))) {
      return tool.parameters || tool.input_schema;
    }
  }
  return null;
}

function _schemaProperties(schema) {
  return _isMapping(schema) && _isMapping(schema.properties) ? schema.properties : null;
}

function _schemaTypes(schema) {
  const types = new Set();
  if (!_isMapping(schema)) return types;
  const kind = schema.type;
  if (typeof kind === "string") types.add(kind);
  else if (Array.isArray(kind)) for (const t of kind) if (typeof t === "string") types.add(t);
  if (schema.properties != null) types.add("object");
  if (schema.items != null) types.add("array");
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(schema[key])) {
      for (const variant of schema[key]) types.add(..._schemaTypes(variant));
    }
  }
  return types;
}

function _requiredToolArgs(name, tools) {
  const seen = new Set();
  const required = [];
  function add(...keys) {
    for (const key of keys) {
      if (typeof key === "string" && key && !seen.has(key)) { seen.add(key); required.push(key); }
    }
  }
  const schema = _toolSchema(name, tools);
  if (_isMapping(schema) && Array.isArray(schema.required)) add(...schema.required);
  if (name === "Read") add("file_path");
  else if (name === "Write") add("file_path", "content");
  else if (name === "Edit") add("file_path");
  else if (name === "Bash" || name === "PowerShell") add("command");
  return required;
}

function _missingRequiredArgs(name, input, tools) {
  if (!_isMapping(input)) return false;
  for (const key of _requiredToolArgs(name, tools)) {
    const value = input[key];
    if (value == null) return true;
    if (typeof value === "string" && !value.trim() && !_requiredArgAllowsEmptyString(name, key)) return true;
  }
  return false;
}

function _requiredArgAllowsEmptyString(toolName, argName) {
  return _toolAliasKey(toolName) === "write" && ["content", "text", "body", "data", "value", "contents", "filecontent"].includes(_toolAliasKey(argName));
}

function _invalidToolArgs(input) {
  if (!_isMapping(input)) return false;
  for (const [key, value] of Object.entries(input)) {
    if (_isPathLikeArgName(key) && _pathLikeArgLooksPolluted(String(value || ""))) return true;
  }
  return false;
}

function _isPathLikeArgName(name) {
  return ["path", "filepath", "filename", "targetfile", "file", "dir", "directory", "cwd", "workdir", "workingdirectory"].includes(_toolAliasKey(name));
}

function _pathLikeArgLooksPolluted(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\0") || /[\r\n<>]/.test(trimmed)) return true;
  const lowered = trimmed.toLowerCase();
  const markers = ["<![cdata[", "]]>", "xyml|", "qnml|", "tool_calls", "invoke name=", "parameter name=", "</parameter", "</invoke", "function.name:", "function.arguments:"];
  return markers.some((m) => lowered.includes(m));
}

function _filterInputForTool(name, input, tools) {
  const properties = _schemaProperties(_toolSchema(name, tools));
  if (!properties) return { ...input };
  const out = {};
  for (const key of Object.keys(input)) if (key in properties) out[key] = input[key];
  return out;
}

function _toolAcceptsField(name, tools, field) {
  const properties = _schemaProperties(_toolSchema(name, tools));
  return Boolean(properties && field in properties);
}

function _renameFirstPresent(obj, canonical, ...aliases) {
  if (obj[canonical] != null) return;
  for (const alias of aliases) {
    if (obj[alias] != null) {
      obj[canonical] = obj[alias];
      delete obj[alias];
      return;
    }
  }
}

function _normalizeProtocolSpecs(values, emitProtocol) {
  const out = [];
  const seen = new Set();
  for (const value of _asList(values)) {
    const spec = _normalizeProtocolSpec(value);
    const key = spec.name.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(spec); }
  }
  if (!seen.has(String(emitProtocol).toLowerCase())) {
    out.unshift(new ProtocolSpec(emitProtocol));
  }
  return out;
}

function _normalizeProtocolSpec(value) {
  if (value instanceof ProtocolSpec) return value;
  if (typeof value === "string") return new ProtocolSpec(value);
  if (_isMapping(value)) {
    const opts = { ...value };
    const name = opts.name;
    delete opts.name;
    return new ProtocolSpec(name, opts);
  }
  throw new TypeError("Invalid protocol spec");
}

function _protocolOpenTagRe(protocol, tag) {
  return new RegExp(`<\\s*\\|\\s*${_escapeRegExp(protocol.name)}\\s*\\|\\s*${_escapeRegExp(tag)}\\b[^>]*>`, "gi");
}

function _protocolTagBlockRe(protocol, tag) {
  const p = _escapeRegExp(protocol.name);
  const t = _escapeRegExp(tag);
  return new RegExp(`<\\s*\\|\\s*${p}\\s*\\|\\s*${t}\\b([^>]*)>([\\s\\S]*?)<\\s*/\\s*\\|\\s*${p}\\s*\\|\\s*${t}\\s*>`, "gi");
}

function _extractNameAttr(attributes) {
  const m = String(attributes || "").match(/(?:^|[\s|])name\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s|/>]+))/im);
  if (!m) return "";
  return _htmlUnescape((m[1] ?? m[2] ?? m[3] ?? "").trim());
}

function _decodeMarkupValue(raw, parameterName, config) {
  const cdataMatches = String(raw || "").matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/gi);
  const cdatas = [...cdataMatches].map((m) => m[1]);
  const rawString = config.rawStringParams.has(String(parameterName || "").toLowerCase());
  if (cdatas.length) {
    const joined = cdatas.join("");
    return rawString ? joined : _coerceMarkupScalar(joined, false);
  }
  if (!rawString) {
    const [parsed, nested] = _parseNestedMarkupValue(String(raw || ""), config);
    if (parsed) return nested;
  }
  return _coerceMarkupScalar(raw, rawString);
}

function _parseNestedMarkupValue(raw, config) {
  const text = raw.trim();
  if (!text || !text.includes("<")) return [false, null];
  const re = /<([A-Za-z_][A-Za-z0-9_.:-]*)\b[^>]*>([\s\S]*?)<\/\1>/g;
  const matches = [...text.matchAll(re)];
  if (!matches.length) return [false, null];
  const names = matches.map((m) => m[1]);
  const values = matches.map((m) => _decodeMarkupValue(m[2], m[1], config));
  if (names.every((n) => n.toLowerCase() === "item")) return [true, values];
  const out = {};
  for (let i = 0; i < names.length; i++) {
    const k = names[i];
    if (!(k in out)) out[k] = values[i];
    else if (Array.isArray(out[k])) out[k].push(values[i]);
    else out[k] = [out[k], values[i]];
  }
  return [true, out];
}

function _coerceMarkupScalar(raw, rawString) {
  const value = _htmlUnescape(String(raw || "").trim());
  if (rawString) return value;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  if (value.toLowerCase() === "null") return null;
  const r = _tryJson(value);
  return r[0] ? _normalizeToolInput(r[1]) : value;
}

function _renderMarkupValue(value) {
  if (value == null) return "null";
  if (typeof value === "string") return `<![CDATA[${value.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;
  if (typeof value === "boolean") return value ? "true" : "false";
  return _jsonDumps(value);
}

function _firstToolMarkerIndex(text, config) {
  const indexes = [];
  for (const protocol of config.parseProtocols) {
    for (const tag of [protocol.tags.root, protocol.tags.invoke]) {
      const m = _protocolOpenTagRe(protocol, tag).exec(text);
      if (m) indexes.push(m.index);
    }
  }
  for (const expression of [/^\s*\{\s*"tool_calls"/, /function\.name\s*:/]) {
    const m = text.match(expression);
    if (m) indexes.push(m.index);
  }
  return indexes.length ? Math.min(...indexes) : -1;
}

function _hasOpenProtocolBlock(text, config) {
  return config.parseProtocols.some((protocol) =>
    _protocolOpenTagRe(protocol, protocol.tags.root).test(text) ||
    _protocolOpenTagRe(protocol, protocol.tags.invoke).test(text)
  );
}

function _looksStructurallyClosed(text, config) {
  if (/\n\s*[\]}]\s*$/.test(text)) return true;
  for (const protocol of config.parseProtocols) {
    const re = new RegExp(`<\\s*/\\s*\\|\\s*${_escapeRegExp(protocol.name)}\\s*\\|\\s*${_escapeRegExp(protocol.tags.root)}\\s*>`, "i");
    if (re.test(text)) return true;
  }
  return false;
}

function _canonicalizeMarkup(text) {
  let out = text;
  for (const [old, neu] of MARKUP_REPLACEMENTS) out = out.split(old).join(neu);
  return out.replace(/\u200b/g, "").replace(/\u200c/g, "").replace(/\u200d/g, "").replace(/\ufeff/g, "").replace(/\u3000/g, " ").replace(/\u00a0/g, " ");
}

function _stripMarkdownFences(text) {
  return text.replace(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/g, "$1");
}

function _stripJsonFence(text) {
  const m = text.trim().match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return m ? m[1].trim() : text.trim();
}

function _repairLooseJson(text) {
  let r = text.trim();
  r = r.replace(/"name="\s*/gi, '"name": "');
  r = r.replace(/"name=([^",}\s]+)"/gi, '"name": "$1"');
  r = r.replace(/"(name|input|arguments|args|parameters|tool|tool_name|function_name)"\s*=\s*/gi, '"$1": ');
  return r.replace(/([{,]\s*)(name|input|arguments|args|parameters|tool|tool_name|function_name)\s*:/gi, '$1"$2":');
}

function _recoverJsonLike(text) {
  let r = text.trim();
  const unclosedBraces = Math.max((r.match(/{/g) || []).length - (r.match(/}/g) || []).length, 0);
  const unclosedBrackets = Math.max((r.match(/\[/g) || []).length - (r.match(/\]/g) || []).length, 0);
  return r + "]".repeat(unclosedBrackets) + "}".repeat(unclosedBraces);
}

function _tryJson(text) {
  try { return [true, JSON.parse(text)]; } catch { return [false, null]; }
}

function _resolveConfig(config) {
  if (config instanceof ToolCallConfig) return config;
  if (config == null) return new ToolCallConfig();
  if (_isMapping(config)) return new ToolCallConfig(config);
  throw new TypeError("config must be a ToolCallConfig or mapping");
}

function _safeToolName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "";
  if (trimmed in SAFE_TOOL_ALIASES) return SAFE_TOOL_ALIASES[trimmed];
  if (Object.values(SAFE_TOOL_ALIASES).some((alias) => alias.toLowerCase() === trimmed.toLowerCase())) return trimmed;
  return trimmed.startsWith("u_") ? trimmed : `u_${trimmed}`;
}

function _exampleInputFromTool(tool) {
  const properties = _schemaProperties(tool.parameters || tool.input_schema);
  if (!properties) return { ARG: "value" };
  const entries = Object.entries(properties).slice(0, 3);
  const example = {};
  for (const [key, schema] of entries) example[key] = _exampleValue(schema);
  return Object.keys(example).length ? example : { ARG: "value" };
}

function _exampleValue(schema) {
  const kinds = _schemaTypes(schema);
  if (kinds.has("array")) return [];
  if (kinds.has("object")) return {};
  if (kinds.has("boolean")) return true;
  if (kinds.has("number") || kinds.has("integer")) return 1;
  return "value";
}

function _summarizeSchema(schema) {
  return !schema ? "{}" : _jsonDumps(schema);
}

function _clip(text, maximum) {
  const value = String(text || "").trim();
  return value.length > maximum ? `${value.slice(0, maximum)}...` : value;
}

function _stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(_stableStringify).join(",")}]`;
  if (_isMapping(value)) {
    return `{${Object.keys(value).sort((a, b) => String(a).localeCompare(String(b))).map((k) => `${_jsonDumps(String(k))}:${_stableStringify(value[k])}`).join(",")}}`;
  }
  return _jsonDumps(value);
}

function _jsonDumps(value) {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? String(v) : v));
}

function _escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function _htmlUnescape(value) {
  return String(value || "")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function _toolAliasKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function _firstString(...values) {
  for (const v of values) if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}

function _firstDefined(...values) {
  for (const v of values) if (v != null) return v;
  return null;
}

function _takeOption(values, ...names) {
  const defaultOpt = names[names.length - 1];
  const hasDefault = typeof defaultOpt === "object" && defaultOpt !== null && "default" in defaultOpt;
  const realDefault = hasDefault ? defaultOpt.default : (names.pop());
  for (const name of names) {
    if (name in values) return values[name];
  }
  return realDefault;
}

function _asList(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function _isMapping(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function _callValue(call, key, defaultVal = null) {
  if (_isMapping(call)) return call[key] !== undefined ? call[key] : defaultVal;
  return call && call[key] !== undefined ? call[key] : defaultVal;
}

function _argumentsString(value) {
  return typeof value === "string" ? value : _jsonDumps(value == null ? {} : value);
}

function _escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
