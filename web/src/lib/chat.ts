// Chat session + completion API (via /proxy passthrough, login-session auth).
import { proxyJson, proxyUpload } from "./api";
import {
  createDeltaDecoder,
  createSseParser,
  appendDelta,
  mapHistoryMessage,
  mapServerFile,
  type ChatMessage,
  type MappedFile
} from "./deepseek-sse";

export interface DeepSeekSession {
  id: string;
  title: string;
  updated_at: number;
  pinned?: boolean;
}

const PAGE_SIZE = 50;
const CURSOR_PADDING_SEC = 3600;

function dedupe(sessions: DeepSeekSession[]): DeepSeekSession[] {
  const seen = new Set<string>();
  return sessions.filter((s) => {
    if (!s?.id || seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

export async function fetchAllSessions(accountId: string): Promise<DeepSeekSession[]> {
  const seenCursors = new Set<string>();
  let cursor = Math.floor(Date.now() / 1000) + CURSOR_PADDING_SEC;
  let hasMore = true;
  let sessions: DeepSeekSession[] = [];

  while (hasMore) {
    const key = String(cursor);
    if (seenCursors.has(key)) throw new Error(`会话分页游标重复：${key}`);
    seenCursors.add(key);

    const payload: any = await proxyJson("/api/v0/chat_session/fetch_page", {
      accountId,
      query: {
        "lte_cursor.pinned": "false",
        "lte_cursor.updated_at": String(cursor),
        count: String(PAGE_SIZE)
      }
    });
    const page = payload.data.biz_data;
    const pageSessions: DeepSeekSession[] = page.chat_sessions ?? [];
    sessions = dedupe([...sessions, ...pageSessions]);
    hasMore = Boolean(page.has_more);
    if (!hasMore) return sessions;
    const next = pageSessions[pageSessions.length - 1]?.updated_at;
    if (!next) throw new Error("会话分页缺少下一个游标");
    cursor = next;
  }
  return sessions;
}

export async function createRemoteSession(accountId: string): Promise<string> {
  const payload: any = await proxyJson("/api/v0/chat_session/create", {
    accountId,
    method: "POST",
    body: {}
  });
  return payload.data.biz_data.chat_session.id;
}

export async function deleteRemoteSession(accountId: string, sessionId: string): Promise<void> {
  await proxyJson("/api/v0/chat_session/delete", {
    accountId,
    method: "POST",
    body: { chat_session_id: sessionId }
  });
}

export interface HistoryResult {
  currentMessageId: string | null;
  messages: ChatMessage[];
}

export async function fetchHistory(accountId: string, sessionId: string): Promise<HistoryResult> {
  const payload: any = await proxyJson("/api/v0/chat/history_messages", {
    accountId,
    query: { chat_session_id: sessionId }
  });
  const data = payload.data.biz_data;
  return {
    currentMessageId: data.chat_session.current_message_id ?? null,
    messages: (data.chat_messages || []).map(mapHistoryMessage)
  };
}

export interface UploadResult { file: MappedFile }

export async function uploadFile(accountId: string, file: File, onUpdate?: (f: MappedFile) => void): Promise<MappedFile> {
  const payload: any = await proxyUpload("/api/v0/file/upload_file", file, accountId);
  let current = mapServerFile(payload.data.biz_data);
  onUpdate?.(current);
  // Poll until ready
  while (["PENDING", "PARSING", "UPLOADING"].includes(current.status)) {
    await new Promise((r) => setTimeout(r, 3000));
    const q: any = await proxyJson("/api/v0/file/fetch_files", {
      accountId,
      query: { file_ids: current.id }
    });
    const next = q.data.biz_data.files?.[0];
    if (!next) throw new Error(`File not found: ${current.id}`);
    current = mapServerFile(next);
    onUpdate?.(current);
  }
  return current;
}

export interface CompletionOptions {
  accountId: string;
  modelType: string;
  parentMessageId: string | null;
  prompt: string;
  refFileIds: string[];
  searchEnabled: boolean;
  sessionId: string;
  stream: boolean;
  thinkingEnabled: boolean;
}

export interface CompletionHandlers {
  onReady?: (responseMessageId: string | null) => void;
  onDelta?: (delta: { kind: "thinking" | "response"; text: string }) => void;
  onComplete?: (message: ChatMessage) => void;
  onError?: (err: Error) => void;
}

export async function requestChatCompletion(opts: CompletionOptions, handlers: CompletionHandlers): Promise<ChatMessage> {
  const res = await fetch("/proxy/api/v0/chat/completion", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-proxy-account-id": opts.accountId
    },
    body: JSON.stringify({
      chat_session_id: opts.sessionId,
      model_type: opts.modelType,
      parent_message_id: opts.parentMessageId,
      preempt: false,
      prompt: opts.prompt,
      ref_file_ids: opts.refFileIds,
      search_enabled: opts.searchEnabled,
      stream: opts.stream,
      thinking_enabled: opts.thinkingEnabled
    })
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    // Non-streaming JSON
    const payload: any = await res.json();
    const bizCode = payload?.data?.biz_code;
    if (bizCode !== 0 && bizCode != null) {
      throw new Error(payload?.data?.biz_msg || payload?.msg || "completion failed");
    }
    const biz = payload?.data?.biz_data ?? {};
    const msg = biz.message ?? {};
    const sections = Array.isArray(msg.sections) ? msg.sections : [];
    const message: ChatMessage = {
      role: msg.role ?? "ASSISTANT",
      files: Array.isArray(msg.files) ? msg.files.map(mapServerFile) : [],
      sections: sections.map((s: any) => ({
        kind: s.kind === "thinking" ? "thinking" : "response",
        content: s.content ?? ""
      }))
    };
    handlers.onReady?.(biz.response_message_id ?? biz.ready?.response_message_id ?? null);
    handlers.onComplete?.(message);
    return message;
  }

  // Streaming SSE
  const decoder = new TextDecoder();
  const deltaDecoder = createDeltaDecoder();
  let result: ChatMessage = { role: "ASSISTANT", files: [], sections: [] };
  let responseMessageId: string | null = null;
  const parser = createSseParser(({ event, data }) => {
    if (!data) return;
    if (event === "ready") {
      try {
        const ready = JSON.parse(data);
        responseMessageId = ready.response_message_id ?? null;
        handlers.onReady?.(responseMessageId);
      } catch {}
      return;
    }
    if (event !== "message") return;
    try {
      const delta = deltaDecoder.consume(data);
      if (delta) {
        result = appendDelta(result, delta);
        handlers.onDelta?.(delta);
      }
    } catch {}
  });

  try {
    for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
      parser.push(decoder.decode(chunk, { stream: true }));
    }
    parser.flush();
  } catch (err: any) {
    handlers.onError?.(err);
    throw err;
  }

  handlers.onComplete?.(result);
  return result;
}
