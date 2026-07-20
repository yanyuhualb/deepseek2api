import { useMemo, useState } from "react";
import { MessageSquarePlus, Trash2, Search } from "lucide-react";
import type { DeepSeekSession } from "@/lib/chat";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

interface SessionListProps {
  sessions: DeepSeekSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete?: (id: string) => void;
  incognito?: boolean;
}

function groupByTime(sessions: DeepSeekSession[]): { label: string; items: DeepSeekSession[] }[] {
  const now = Math.floor(Date.now() / 1000);
  const day = 86400;
  const groups: Record<string, DeepSeekSession[]> = { 今天: [], 昨天: [], "前 7 天": [], 更早: [] };
  for (const s of sessions) {
    const age = now - (s.updated_at || 0);
    if (age < day) groups["今天"].push(s);
    else if (age < day * 2) groups["昨天"].push(s);
    else if (age < day * 7) groups["前 7 天"].push(s);
    else groups["更早"].push(s);
  }
  return Object.entries(groups).filter(([, v]) => v.length).map(([label, items]) => ({ label, items }));
}

export function SessionList({ sessions, selectedId, onSelect, onCreate, onDelete, incognito }: SessionListProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return sessions;
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => (s.title || "").toLowerCase().includes(q) || s.id.includes(q));
  }, [sessions, query]);

  const groups = useMemo(() => groupByTime(filtered), [filtered]);

  return (
    <div className="flex h-full flex-col">
      <div className="p-2">
        <button
          onClick={onCreate}
          className="flex w-full items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-text hover:bg-surface-2 transition-colors"
        >
          <MessageSquarePlus size={16} />
          {incognito ? "新会话（无痕）" : "新建会话"}
        </button>
      </div>
      <div className="px-2 pb-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索会话"
            className="pl-8"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {groups.length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-muted">暂无会话</div>
        )}
        {groups.map((g) => (
          <div key={g.label} className="mb-2">
            <div className="px-3 py-1.5 text-xs font-medium text-muted">{g.label}</div>
            {g.items.map((s) => (
              <div
                key={s.id}
                onClick={() => onSelect(s.id)}
                className={cn(
                  "group flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  selectedId === s.id ? "bg-surface-2 text-text" : "text-muted hover:bg-surface hover:text-text"
                )}
              >
                <span className="flex-1 truncate">{s.title || "未命名会话"}</span>
                {onDelete && !incognito && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                    className="shrink-0 rounded p-1 text-muted opacity-0 hover:text-danger group-hover:opacity-100 transition-opacity"
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
