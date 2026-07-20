import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import {
  createRemoteSession,
  deleteRemoteSession,
  fetchAllSessions,
  fetchHistory,
  requestChatCompletion,
  type DeepSeekSession
} from "@/lib/chat";
import { resolveModel, DEFAULT_MODEL_ID, MODELS } from "@/lib/models";
import type { ChatMessage } from "@/lib/deepseek-sse";
import { Select } from "@/components/ui/Input";
import { Tabs } from "@/components/ui/Tabs";
import { SessionList } from "./SessionList";
import { MessageItem } from "./MessageItem";
import { Composer } from "./Composer";
import { cn } from "@/lib/utils";

export function ChatView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const accounts = useAppStore((s) => s.accounts);
  const incognito = useAppStore((s) => s.incognito);
  const incognitoEnabled = Boolean(incognito?.effectiveEnabled);

  const [accountId, setAccountId] = useState<string>("");
  const [sessions, setSessions] = useState<DeepSeekSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [streamMode, setStreamMode] = useState<"stream" | "non-stream">("stream");
  const [sending, setSending] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Pick first account by default
  useEffect(() => {
    if (!accountId && accounts.length) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const loadSessions = useCallback(async () => {
    if (!accountId || incognitoEnabled) return;
    setLoadingSessions(true);
    try {
      const list = await fetchAllSessions(accountId);
      setSessions(list);
    } catch (err: any) {
      setError(err?.message ?? "加载会话失败");
    } finally {
      setLoadingSessions(false);
    }
  }, [accountId, incognitoEnabled]);

  useEffect(() => {
    if (accountId && !incognitoEnabled) loadSessions();
    else setSessions([]);
  }, [accountId, incognitoEnabled, loadSessions]);

  // Scroll handling
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      stickToBottom.current = nearBottom;
      setShowScrollDown(!nearBottom && el.scrollHeight > el.clientHeight + 100);
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (stickToBottom.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  async function selectSession(id: string) {
    if (incognitoEnabled) return;
    setLoadingHistory(true);
    setError(null);
    try {
      const r = await fetchHistory(accountId, id);
      setMessages(r.messages);
      setCurrentMessageId(r.currentMessageId);
      setSelectedSessionId(id);
      stickToBottom.current = true;
    } catch (err: any) {
      setError(err?.message ?? "加载历史失败");
    } finally {
      setLoadingHistory(false);
    }
  }

  async function createSession() {
    setError(null);
    if (incognitoEnabled) {
      setSelectedSessionId(null);
      setMessages([]);
      setCurrentMessageId(null);
      return;
    }
    try {
      const id = await createRemoteSession(accountId);
      setSelectedSessionId(id);
      setMessages([]);
      setCurrentMessageId(null);
      await loadSessions();
    } catch (err: any) {
      setError(err?.message ?? "创建会话失败");
    }
  }

  async function deleteSession(id: string) {
    try {
      await deleteRemoteSession(accountId, id);
      if (selectedSessionId === id) {
        setSelectedSessionId(null);
        setMessages([]);
        setCurrentMessageId(null);
      }
      await loadSessions();
    } catch (err: any) {
      setError(err?.message ?? "删除会话失败");
    }
  }

  async function handleSend(prompt: string, refFileIds: string[]) {
    if (!accountId) {
      setError("请先绑定 DeepSeek 账号");
      onOpenSettings();
      return;
    }
    setSending(true);
    setError(null);

    let sessionId = selectedSessionId;
    if (!sessionId) {
      if (!incognitoEnabled) {
        try {
          sessionId = await createRemoteSession(accountId);
          setSelectedSessionId(sessionId);
        } catch (err: any) {
          setError(err?.message ?? "创建会话失败");
          setSending(false);
          return;
        }
      } else {
        sessionId = "incognito-" + crypto.randomUUID();
        setSelectedSessionId(sessionId);
      }
    }

    const userMsg: ChatMessage = { role: "USER", files: [], sections: [{ kind: "response", content: prompt }] };
    const assistantMsg: ChatMessage = { role: "ASSISTANT", files: [], sections: [] };
    setMessages((m) => [...m, userMsg, assistantMsg]);
    stickToBottom.current = true;

    const model = resolveModel(modelId);
    let responseMessageId: string | null = null;

    try {
      await requestChatCompletion(
        {
          accountId,
          modelType: model.modelType,
          parentMessageId: currentMessageId,
          prompt,
          refFileIds,
          searchEnabled: model.searchEnabled,
          sessionId: sessionId!,
          stream: streamMode === "stream",
          thinkingEnabled: model.thinkingEnabled
        },
        {
          onReady: (id) => { responseMessageId = id; },
          onDelta: (delta) => {
            setMessages((m) => {
              const next = [...m];
              const last = next[next.length - 1];
              if (last && last.role === "ASSISTANT") {
                const sections = last.sections.length ? last.sections : [];
                const lastSection = sections[sections.length - 1];
                if (lastSection?.kind === delta.kind) {
                  next[next.length - 1] = { ...last, sections: [...sections.slice(0, -1), { kind: lastSection.kind, content: lastSection.content + delta.text }] };
                } else {
                  next[next.length - 1] = { ...last, sections: [...sections, { kind: delta.kind, content: delta.text }] };
                }
              }
              return next;
            });
          },
          onComplete: (finalMsg) => {
            setMessages((m) => {
              const next = [...m];
              if (next.length && next[next.length - 1].role === "ASSISTANT") {
                next[next.length - 1] = finalMsg.sections.length ? finalMsg : next[next.length - 1];
              }
              return next;
            });
          }
        }
      );
      if (responseMessageId) setCurrentMessageId(responseMessageId);
      if (!incognitoEnabled) await loadSessions();
    } catch (err: any) {
      setError(err?.message ?? "发送失败");
      setMessages((m) => {
        const next = [...m];
        if (next.length && next[next.length - 1].role === "ASSISTANT") {
          next[next.length - 1] = { ...next[next.length - 1], sections: [{ kind: "response", content: `[错误：${err?.message ?? "发送失败"}]` }] };
        }
        return next;
      });
    } finally {
      setSending(false);
    }
  }

  const hasAccount = accounts.length > 0;
  const currentAccount = accounts.find((a) => a.id === accountId);

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border bg-surface">
        <div className="border-b border-border px-3 py-2">
          <Select value={accountId} onChange={(e) => { setAccountId(e.target.value); setSelectedSessionId(null); setMessages([]); }} className="h-8">
            {accounts.length === 0 && <option value="">未绑定账号</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.displayName || a.loginValue}</option>
            ))}
          </Select>
        </div>
        {incognitoEnabled && (
          <div className="border-b border-border bg-accent-soft px-3 py-2 text-xs text-accent-strong">
            无痕模式已开启 — 会话不持久化
          </div>
        )}
        {loadingSessions ? (
          <div className="flex items-center justify-center py-8 text-muted"><Loader2 size={16} className="animate-spin" /></div>
        ) : (
          <SessionList
            sessions={sessions}
            selectedId={selectedSessionId}
            onSelect={selectSession}
            onCreate={createSession}
            onDelete={deleteSession}
            incognito={incognitoEnabled}
          />
        )}
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
          <Select value={modelId} onChange={(e) => setModelId(e.target.value)} className="h-8 w-44">
            {Array.from(new Set(MODELS.map((m) => m.group))).map((g) => (
              <optgroup key={g} label={g}>
                {MODELS.filter((m) => m.group === g).map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </optgroup>
            ))}
          </Select>
          <Tabs
            value={streamMode}
            onValueChange={(v) => setStreamMode(v as any)}
            items={[
              { value: "stream", label: "流式" },
              { value: "non-stream", label: "非流式" }
            ]}
          />
          <div className="flex-1" />
          {currentAccount && (
            <span className="hidden sm:inline text-xs text-muted">{currentAccount.displayName || currentAccount.loginValue}</span>
          )}
        </div>

        {/* Messages */}
        <div className="relative flex-1 overflow-y-auto" ref={scrollRef}>
          {!hasAccount ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center px-6">
              <p className="text-sm text-muted">尚未绑定 DeepSeek 账号</p>
              <button onClick={onOpenSettings} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong transition-colors">
                前往绑定
              </button>
            </div>
          ) : messages.length === 0 && !loadingHistory ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center px-6">
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 text-accent">
                <span className="text-lg font-semibold">DS</span>
              </div>
              <h2 className="text-lg font-semibold text-text">DeepSeek 控制台</h2>
              <p className="text-sm text-muted">发送消息开始对话</p>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl py-4">
              {loadingHistory && (
                <div className="flex items-center justify-center py-8 text-muted"><Loader2 size={16} className="animate-spin" /></div>
              )}
              {messages.map((m, i) => (
                <MessageItem key={i} message={m} streaming={sending && i === messages.length - 1 && m.role === "ASSISTANT"} />
              ))}
            </div>
          )}

          {showScrollDown && (
            <button
              onClick={() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; stickToBottom.current = true; }}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border bg-bg p-1.5 text-text shadow-md hover:bg-surface-2 transition-colors"
            >
              <ChevronDown size={16} />
            </button>
          )}
        </div>

        {error && (
          <div className="border-t border-border bg-danger/5 px-4 py-2 text-sm text-danger flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-danger/70 hover:text-danger">×</button>
          </div>
        )}

        <Composer accountId={accountId} disabled={!hasAccount} sending={sending} onSend={handleSend} />
      </div>
    </div>
  );
}

