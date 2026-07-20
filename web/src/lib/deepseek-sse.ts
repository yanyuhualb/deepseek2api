// DeepSeek SSE delta decoder — ported from public/deepseek-message.js.

export interface MessageSection {
  kind: "thinking" | "response";
  content: string;
}

export interface ChatMessage {
  id?: string;
  parentId?: string | null;
  role: string;
  files: MappedFile[];
  sections: MessageSection[];
}

export interface MappedFile {
  id: string;
  status: string;
  fileName: string;
  previewable: boolean;
  fileSize: number;
  tokenUsage: number | null;
  errorCode: string | null;
  insertedAt?: string;
  updatedAt?: string;
}

const SECTION_KIND_BY_TYPE: Record<string, MessageSection["kind"]> = {
  THINK: "thinking",
  RESPONSE: "response"
};

function resolveSectionKind(type?: string): MessageSection["kind"] | null {
  return type ? SECTION_KIND_BY_TYPE[type] ?? "response" : null;
}

function getInitialFragment(payload: any) {
  const fragments = payload?.v?.response?.fragments;
  return Array.isArray(fragments) ? fragments[fragments.length - 1] ?? null : null;
}

function getAppendedFragment(payload: any) {
  if (payload.p !== "response/fragments" || payload.o !== "APPEND") return null;
  return Array.isArray(payload.v) ? payload.v[payload.v.length - 1] ?? null : null;
}

function extractFragmentText(payload: any): string {
  const initial = getInitialFragment(payload);
  if (typeof initial?.content === "string") return initial.content;
  const appended = getAppendedFragment(payload);
  if (typeof appended?.content === "string") return appended.content;
  if (payload.p === "response/fragments/-1/content" && typeof payload.v === "string") return payload.v;
  if (!("p" in payload) && typeof payload.v === "string") return payload.v;
  return "";
}

export interface SseEvent { event: string; data: string }

export function createSseParser(onEvent: (e: SseEvent) => void) {
  let buffer = "";
  let eventName = "message";
  let dataLines: string[] = [];

  function emit() {
    if (dataLines.length) onEvent({ event: eventName, data: dataLines.join("\n") });
    eventName = "message";
    dataLines = [];
  }

  return {
    push(chunk: string) {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const idx = buffer.indexOf("\n");
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        if (!line) { emit(); continue; }
        if (line.startsWith("event:")) { eventName = line.slice(6).trim(); continue; }
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
    },
    flush() {
      if (buffer.trim()) { dataLines.push(buffer.trim()); buffer = ""; }
      emit();
    }
  };
}

export interface Delta { kind: MessageSection["kind"]; text: string }

export function createDeltaDecoder() {
  let currentKind: MessageSection["kind"] = "response";
  return {
    consume(payloadText: string): Delta | null {
      const payload = JSON.parse(payloadText);
      const fragment = getAppendedFragment(payload) ?? getInitialFragment(payload);
      if (fragment?.type) {
        currentKind = resolveSectionKind(fragment.type) ?? currentKind;
      }
      const text = extractFragmentText(payload);
      return text ? { kind: currentKind, text } : null;
    }
  };
}

export function appendDelta(message: ChatMessage, delta: Delta | null): ChatMessage {
  const sections = message.sections.length ? message.sections : [];
  if (!delta?.text) return { ...message, sections };
  const last = sections[sections.length - 1];
  if (last?.kind === delta.kind) {
    return { ...message, sections: [...sections.slice(0, -1), { kind: last.kind, content: last.content + delta.text }] };
  }
  return { ...message, sections: [...sections, { kind: delta.kind, content: delta.text }] };
}

export function mapServerFile(file: any): MappedFile {
  return {
    id: file.id,
    status: file.status,
    fileName: file.file_name,
    previewable: Boolean(file.previewable),
    fileSize: file.file_size,
    tokenUsage: file.token_usage,
    errorCode: file.error_code,
    insertedAt: file.inserted_at,
    updatedAt: file.updated_at
  };
}

export function mapHistoryMessage(message: any): ChatMessage {
  const sections = (message.fragments || [])
    .filter((f: any) => f.content)
    .map((f: any) => ({ kind: resolveSectionKind(f.type) ?? "response", content: f.content }));
  return {
    id: message.message_id,
    parentId: message.parent_id,
    role: message.role,
    files: (message.files || []).map(mapServerFile),
    sections
  };
}
