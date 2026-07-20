import { useState } from "react";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export function IncognitoPanel() {
  const incognito = useAppStore((s) => s.incognito);
  const setIncognitoState = useAppStore((s) => s.setIncognitoState);
  const [enabled, setEnabled] = useState(incognito?.scopeEnabled ?? false);
  const [loading, setLoading] = useState(false);

  async function save() {
    setLoading(true);
    try {
      const r = await api.setIncognito(enabled);
      setIncognitoState(r.incognito);
    } finally {
      setLoading(false);
    }
  }

  if (!incognito) return <p className="text-sm text-muted">无法获取无痕状态</p>;

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-surface px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-text">
              {incognito.scope === "global" ? "全局无痕" : "仅自己无痕"}
            </div>
            <div className="mt-0.5 text-xs text-muted">
              开启后聊天完成后自动清理 DeepSeek 会话，不留痕迹
            </div>
          </div>
          <button
            onClick={() => setEnabled((v) => !v)}
            className={cn(
              "relative h-6 w-11 shrink-0 rounded-full transition-colors",
              enabled ? "bg-accent" : "bg-border"
            )}
          >
            <span className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
              enabled ? "translate-x-[22px]" : "translate-x-0.5"
            )} />
          </button>
        </div>
        {incognito.globalEnabled && incognito.scope === "self" && (
          <div className="mt-2 text-xs text-accent-strong">管理员已开启全局无痕，你的会话也将被清理</div>
        )}
      </div>
      <Button onClick={save} disabled={loading} className="gap-1">
        {loading ? <Loader2 size={14} className="animate-spin" /> : enabled ? <EyeOff size={14} /> : <Eye size={14} />}
        保存
      </Button>
    </div>
  );
}
