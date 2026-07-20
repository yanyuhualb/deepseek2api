import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, ChevronDown, ChevronRight, Brain } from "lucide-react";
import type { ChatMessage } from "@/lib/deepseek-sse";
import { cn } from "@/lib/utils";

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const lang = /language-(\w+)/.exec(className || "")?.[1] ?? "text";
  const text = String(children ?? "").replace(/\n$/, "");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <div className="group relative my-3 overflow-hidden rounded-md border border-border bg-surface-2">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-muted">{lang}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-surface hover:text-text transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

function ThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 rounded-md border border-border bg-surface-2/50">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted hover:text-text transition-colors"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Brain size={14} />
        <span>思维链</span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2 text-sm text-muted whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}

export const MessageItem = memo(function MessageItem({ message, streaming }: { message: ChatMessage; streaming?: boolean }) {
  const isUser = message.role?.toUpperCase() === "USER";
  const responseSections = message.sections.filter((s) => s.kind === "response" && s.content);
  const thinkingSections = message.sections.filter((s) => s.kind === "thinking" && s.content);

  if (isUser) {
    const text = message.sections.map((s) => s.content).join("\n\n") || "";
    return (
      <div className="flex justify-end px-4 py-3">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-accent text-white px-4 py-2.5 text-sm leading-relaxed">
          {text}
        </div>
      </div>
    );
  }

  const responseText = responseSections.map((s) => s.content).join("\n\n");

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent text-xs font-semibold">
          DS
        </div>
        <div className="min-w-0 flex-1">
          {thinkingSections.map((s, i) => (
            <ThinkingBlock key={i} content={s.content} />
          ))}
          <div className="prose-chat text-sm leading-relaxed text-text">
            {responseText ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
                components={{
                  pre: ({ children }) => <>{children}</>,
                  code: ({ inline, className, children }: any) =>
                    inline ? (
                      <code className="rounded bg-surface-2 px-1 py-0.5 text-[13px] font-mono">{children}</code>
                    ) : (
                      <CodeBlock className={className}>{children}</CodeBlock>
                    ),
                  a: ({ children, ...props }) => (
                    <a {...props} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">{children}</a>
                  ),
                  table: ({ children }) => (
                    <div className="my-3 overflow-x-auto rounded-md border border-border">
                      <table className="w-full text-sm">{children}</table>
                    </div>
                  ),
                  th: ({ children }) => <th className="border-b border-border px-3 py-1.5 text-left font-medium">{children}</th>,
                  td: ({ children }) => <td className="border-b border-border px-3 py-1.5">{children}</td>
                }}
              >
                {responseText}
              </ReactMarkdown>
            ) : streaming ? (
              <span className="inline-block h-4 w-2 animate-pulse-soft bg-accent align-middle" />
            ) : null}
          </div>
          {message.files.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {message.files.map((f) => (
                <span key={f.id} className="rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-muted">
                  {f.fileName}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
