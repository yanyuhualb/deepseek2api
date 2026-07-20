import { useEffect, useRef, useState, type FormEvent, type ChangeEvent } from "react";
import { ArrowUp, Paperclip, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { uploadFile } from "@/lib/chat";
import type { MappedFile } from "@/lib/deepseek-sse";

interface ComposerProps {
  accountId: string;
  disabled?: boolean;
  sending?: boolean;
  onSend: (prompt: string, refFileIds: string[]) => Promise<void>;
}

export function Composer({ accountId, disabled, sending, onSend }: ComposerProps) {
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<{ localId: string; file: File; remote?: MappedFile; error?: string }[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  }, [text]);

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length || !accountId) return;
    const newDrafts = Array.from(files).map((file) => ({ localId: crypto.randomUUID(), file }));
    setDrafts((d) => [...d, ...newDrafts]);

    for (const draft of newDrafts) {
      try {
        const remote = await uploadFile(accountId, draft.file, (f) => {
          setDrafts((d) => d.map((x) => x.localId === draft.localId ? { ...x, remote: f } : x));
        });
        setDrafts((d) => d.map((x) => x.localId === draft.localId ? { ...x, remote } : x));
      } catch (err: any) {
        setDrafts((d) => d.map((x) => x.localId === draft.localId ? { ...x, error: err?.message ?? "上传失败" } : x));
      }
    }
  }

  function removeDraft(localId: string) {
    setDrafts((d) => d.filter((x) => x.localId !== localId));
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!text.trim() || sending) return;
    const blocked = drafts.filter((d) => d.error || (d.remote && d.remote.status !== "SUCCESS"));
    if (blocked.length) return;
    const refFileIds = drafts.map((d) => d.remote?.id).filter(Boolean) as string[];
    const prompt = text;
    setText("");
    setDrafts([]);
    await onSend(prompt, refFileIds);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canSend = text.trim().length > 0 && !sending && drafts.every((d) => !d.error && (!d.remote || d.remote.status === "SUCCESS"));

  return (
    <div className="border-t border-border bg-bg px-4 py-3">
      <form onSubmit={submit} className="mx-auto max-w-3xl">
        <div className="rounded-xl border border-border bg-surface shadow-sm focus-within:border-accent transition-colors">
          {drafts.length > 0 && (
            <div className="flex flex-wrap gap-2 border-b border-border p-2">
              {drafts.map((d) => (
                <div key={d.localId} className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1 text-xs">
                  <Paperclip size={12} className="text-muted" />
                  <span className={cn("max-w-[160px] truncate", d.error && "text-danger")}>
                    {d.file.name}
                  </span>
                  {d.error ? (
                    <span className="text-danger">失败</span>
                  ) : d.remote?.status === "SUCCESS" ? (
                    <span className="text-accent">就绪</span>
                  ) : d.remote ? (
                    <Loader2 size={12} className="animate-spin text-muted" />
                  ) : (
                    <Loader2 size={12} className="animate-spin text-muted" />
                  )}
                  <button type="button" onClick={() => removeDraft(d.localId)} className="text-muted hover:text-text">
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="发送消息给 DeepSeek…  (Cmd/Ctrl + Enter)"
            className="block w-full resize-none bg-transparent px-4 py-3 text-sm text-text placeholder:text-muted focus:outline-none"
            style={{ maxHeight: 240 }}
          />
          <div className="flex items-center justify-between px-2 py-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!accountId || disabled}
              className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text transition-colors disabled:opacity-40"
              title="上传文件"
            >
              <Paperclip size={18} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button type="submit" size="sm" disabled={!canSend} className="gap-1">
              {sending ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}
              发送
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
