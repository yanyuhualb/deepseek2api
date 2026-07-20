import { randomUUID } from "node:crypto";

import { config } from "../config.js";
import { createDeepseekDeltaDecoder, createSseParser } from "../utils/deepseek-sse.js";
import { createChatSession, deleteChatSession } from "./chat-session-service.js";
import { proxyDeepseekRequest } from "./deepseek-proxy.js";

// Legacy text-format tool-call markers (still parsed by the XYML engine).
const LEGACY_TOOL_CALL_MARKERS = ["<tool_call", "<function_call", "<tool_code", "<invoke", "<parameter", "[调用 Agent]", "[Called tool:"];

// XYML/QNML protocol block markers, e.g. <|XYML|tool_calls> / <|XYML|invoke>.
function buildProtocolMarkers() {
  const protocols = new Set([config.fc.protocol || "XYML", "XYML", "QNML"]);
  const out = [];
  for (const p of protocols) {
    const name = String(p).trim();
    if (name) out.push(`<|${name}|`);
  }
  return out;
}

const PROTOCOL_MARKERS = buildProtocolMarkers();

export const TOOL_CALL_MARKERS = [...LEGACY_TOOL_CALL_MARKERS, ...PROTOCOL_MARKERS];

const JSON_TOOL_CALL_HINT = '{"name"';

export const MARKER_START_CHARS = [...new Set(["<", "`", "|", ...TOOL_CALL_MARKERS.map(m => m[0])])];

export function findToolCallMarker(text) {
  let earliest = -1;
  for (const marker of TOOL_CALL_MARKERS) {
    const idx = text.indexOf(marker);
    if (idx !== -1 && (earliest === -1 || idx < earliest)) {
      earliest = idx;
    }
  }
  return earliest;
}

/** Like findToolCallMarker but also detects bare JSON tool calls like {"name":"..."}. */
export function checkForToolCallMarker(buf) {
  const idx = findToolCallMarker(buf);
  if (idx !== -1) return idx;
  const jsonIdx = buf.indexOf(JSON_TOOL_CALL_HINT);
  if (jsonIdx !== -1) return jsonIdx;
  return -1;
}

export function isPartialMarker(text) {
  for (const marker of TOOL_CALL_MARKERS) {
    for (let i = Math.max(0, text.length - marker.length); i < text.length; i++) {
      if (!MARKER_START_CHARS.includes(text[i])) continue;
      const tail = text.slice(i);
      if (marker.startsWith(tail)) return true;
    }
  }
  return false;
}

// 计算当前 textBuffer 中可以安全输出（不会切断潜在 tool_call marker）的位置。
// 流式输出过程中，要避免在标记前缀被切开时提前 flush 出去。
export function computeSafeFlushEnd(textBuffer) {
  if (!isPartialMarker(textBuffer)) {
    return textBuffer.length;
  }

  for (let i = Math.max(0, textBuffer.length - 20); i < textBuffer.length; i++) {
    if (!MARKER_START_CHARS.includes(textBuffer[i])) continue;
    const tail = textBuffer.slice(i);
    let isPartial = false;
    for (const marker of TOOL_CALL_MARKERS) {
      if (marker.startsWith(tail)) { isPartial = true; break; }
    }
    if (tail.startsWith("```")) { isPartial = true; }
    if (tail.startsWith('{"na')) { isPartial = true; }
    if (isPartial) {
      return i;
    }
  }

  return textBuffer.length;
}

function normalizeToolName(value) {
  return String(value ?? "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

function getToolNameParts(name) {
  const normalized = normalizeToolName(name);
  const parts = new Set([normalized]);
  const splitMarkers = ["__", "_"];

  for (const marker of splitMarkers) {
    if (normalized.includes(marker)) {
      const tail = normalized.split(marker).filter(Boolean).pop();
      if (tail) parts.add(tail);
    }
  }

  return [...parts].filter(Boolean);
}

function addToolAliasEntry(entries, alias, name) {
  const normalizedAlias = normalizeToolName(alias);
  if (!normalizedAlias) return;
  const existing = entries.get(normalizedAlias);
  if (existing && existing !== name) {
    entries.set(normalizedAlias, null);
    return;
  }
  entries.set(normalizedAlias, name);
}

function addDerivedToolAliases(entries, name, canonicalName = name) {
  const normalized = normalizeToolName(name);
  addToolAliasEntry(entries, normalized, canonicalName);

  const parts = normalized.split("_").filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    const suffix = parts.slice(i).join("_");
    if (suffix !== normalized) {
      addToolAliasEntry(entries, suffix, canonicalName);
    }
  }

  const namespacedTail = normalized.split("__").filter(Boolean).pop();
  if (namespacedTail && namespacedTail !== normalized) {
    addToolAliasEntry(entries, namespacedTail, canonicalName);
  }
}

function buildToolNameAliasMap(validNames) {
  const entries = new Map();

  for (const name of validNames) {
    addDerivedToolAliases(entries, name);
    for (const part of getToolNameParts(name)) {
      addToolAliasEntry(entries, part, name);
    }
  }

  return entries;
}

export function collectExternalToolNameAliasesFromText(text) {
  const aliases = new Map();
  if (typeof text !== "string" || !text) {
    return aliases;
  }

  const toolLineRe = /^\s*[-*]\s+`?([A-Za-z][A-Za-z0-9_$.-]*)`?\s*(?:\(([^)\n]+)\))?\s*:/gm;
  let match;
  while ((match = toolLineRe.exec(text)) !== null) {
    const canonical = match[1];
    const remoteName = match[2]?.trim();
    addDerivedToolAliases(aliases, canonical);

    if (remoteName) {
      addToolAliasEntry(aliases, remoteName, canonical);
      addDerivedToolAliases(aliases, remoteName, canonical);
      const tail = remoteName.split("__").filter(Boolean).pop();
      if (tail && tail !== remoteName) {
        addDerivedToolAliases(aliases, tail, canonical);
        addToolAliasEntry(aliases, tail, canonical);
      }
    }
  }

  return aliases;
}

export function collectExternalToolNameAliasesFromMessages(messages) {
  const aliases = new Map();
  for (const message of messages ?? []) {
    const text = typeof message?.content === "string" ? message.content : "";
    const messageAliases = collectExternalToolNameAliasesFromText(text);
    for (const [alias, name] of messageAliases) {
      addToolAliasEntry(aliases, alias, name);
    }
  }
  return aliases;
}

function findToolSpec(name, tools) {
  return tools?.find((tool) => tool.function?.name === name) ?? null;
}

export function resolveToolNameAlias(name, tools) {
  const validNames = tools?.map((t) => t.function?.name).filter(Boolean) ?? [];
  if (!name || validNames.length === 0) return null;
  if (validNames.includes(name)) return name;

  const aliasMap = buildToolNameAliasMap(validNames);
  const normalized = normalizeToolName(name);
  const directMatch = aliasMap.get(normalized);
  if (directMatch) return directMatch;

  const candidates = validNames.filter((validName) => {
    const validLower = validName.toLowerCase();
    const nameLower = String(name).toLowerCase();
    const normalizedValid = normalizeToolName(validName);
    return validLower.endsWith(`__${nameLower}`)
      || validLower.endsWith(`.${nameLower}`)
      || normalizedValid.endsWith(`_${normalized}`)
      || normalizedValid.endsWith(`__${normalized}`);
  });

  return candidates.length === 1 ? candidates[0] : null;
}

function resolveExternalToolNameAlias(name, aliases) {
  const resolved = aliases?.get(normalizeToolName(name));
  return resolved || null;
}

function shouldNormalizeToolArgumentKey(toolCall, key, tools) {
  const normalizedKey = normalizeToolName(key);
  if (["tool", "tool_name", "function", "function_name"].includes(normalizedKey)) {
    return true;
  }

  if (normalizedKey !== "name") {
    return false;
  }

  const calledToolName = normalizeToolName(toolCall.function.name);
  if (/(inspect|schema|tool|function)/.test(calledToolName)) {
    return true;
  }

  const toolSpec = findToolSpec(toolCall.function.name, tools);
  const fn = toolSpec?.function;
  const nameSchema = fn?.parameters?.properties?.[key];
  const hint = `${fn?.description ?? ""} ${nameSchema?.description ?? ""}`;
  return /(tool|function|schema|inspect|工具|函数)/i.test(hint);
}

function normalizeToolArgumentAliases(toolCall, tools, externalToolNameAliases) {
  let parsedArgs;
  try {
    parsedArgs = JSON.parse(toolCall.function.arguments);
  } catch {
    return toolCall;
  }

  if (!parsedArgs || typeof parsedArgs !== "object" || Array.isArray(parsedArgs)) {
    return toolCall;
  }

  let changed = false;
  const nextArgs = { ...parsedArgs };
  for (const key of ["name", "tool", "toolName", "tool_name", "function", "functionName", "function_name"]) {
    if (!shouldNormalizeToolArgumentKey(toolCall, key, tools)) continue;
    if (typeof nextArgs[key] !== "string") continue;
    const resolved = resolveToolNameAlias(nextArgs[key], tools)
      || resolveExternalToolNameAlias(nextArgs[key], externalToolNameAliases);
    if (resolved && resolved !== nextArgs[key]) {
      nextArgs[key] = resolved;
      changed = true;
    }
  }

  return changed
    ? { ...toolCall, function: { ...toolCall.function, arguments: JSON.stringify(nextArgs) } }
    : toolCall;
}

export function filterToolCalls(toolCalls, tools, externalToolNameAliases = null) {
  if (!toolCalls || !tools) return null;

  const validNames = tools.map((t) => t.function?.name).filter(Boolean);

  const filtered = toolCalls.map((tc) => {
    const match = resolveToolNameAlias(tc.function.name, tools);
    if (!match) return null;
    const normalizedCall = match === tc.function.name
      ? tc
      : { ...tc, function: { ...tc.function, name: match } };
    return normalizeToolArgumentAliases(normalizedCall, tools, externalToolNameAliases);
  }).filter(Boolean);

  return filtered.length > 0 ? filtered : null;
}

export async function startCompletion({ account, requestOptions, sessionId, debugCtx, refFileIds }) {
  const body = Buffer.from(
    JSON.stringify({
      chat_session_id: sessionId,
      parent_message_id: null,
      model_type: requestOptions.model.modelType,
      prompt: requestOptions.prompt,
      ref_file_ids: refFileIds ?? [],
      thinking_enabled: requestOptions.model.thinkingEnabled,
      search_enabled: requestOptions.model.searchEnabled,
      preempt: false
    })
  );

  debugCtx?.logUpstream(body);

  return proxyDeepseekRequest({
    account,
    method: "POST",
    path: "/api/v0/chat/completion",
    body,
    headers: { "content-type": "application/json" }
  });
}

export async function consumeTaggedStream(stream, onTagged, debugCtx = null) {
  if (!stream) {
    return;
  }

  const decoder = new TextDecoder();
  const deltaDecoder = createDeepseekDeltaDecoder();
  const parser = createSseParser(({ event, data }) => {
    debugCtx?.logSseFrame({ event, data: data.length > 2000 ? data.slice(0, 2000) + `... (${data.length} chars)` : data });

    if (event === "hint") {
      try {
        const hint = JSON.parse(data);
        if (hint.type === "error") {
          onTagged({ kind: "error", text: hint.content || "Upstream error", code: hint.finish_reason || "upstream_error" });
          return;
        }
      } catch { /* not a valid JSON hint */ }
      return;
    }

    const delta = deltaDecoder.consume(data);
    if (delta?.text) {
      debugCtx?.logDelta(delta.kind, delta.text);
      onTagged({ kind: delta.kind, text: delta.text });
    }
  });

  for await (const chunk of stream) {
    parser.push(decoder.decode(chunk, { stream: true }));
  }
  parser.flush();
}

export async function collectTaggedContent(stream, debugCtx = null) {
  let content = "";
  let reasoningContent = "";

  await consumeTaggedStream(stream, (tagged) => {
    if (tagged.kind === "error") {
      const err = new Error(tagged.text);
      err.code = tagged.code;
      throw err;
    }
    if (tagged.kind === "thinking") {
      reasoningContent += tagged.text;
    } else {
      content += tagged.text;
    }
  }, debugCtx);

  return { content, reasoningContent };
}

export async function withCompletionSession({ account, body, deleteAfterFinish, onComplete }) {
  const sessionId = await createChatSession(account);

  try {
    return await onComplete(sessionId);
  } finally {
    if (deleteAfterFinish) {
      await deleteChatSession(account, sessionId);
    }
  }
}
