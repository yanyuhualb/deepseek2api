import { useState, type FormEvent } from "react";
import { Loader2, Plus, Trash2, Key, Copy, Check } from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Input";

export function KeysPanel() {
  const accounts = useAppStore((s) => s.accounts);
  const apiKeys = useAppStore((s) => s.apiKeys);
  const refreshApiKeys = useAppStore((s) => s.refreshApiKeys);
  const [accountId, setAccountId] = useState("");
  const [label, setLabel] = useState("");
  const [plainKey, setPlainKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    const targetId = accountId || accounts[0]?.id;
    if (!targetId) {
      setError("请先绑定账号");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.createApiKey(targetId, label, plainKey);
      await refreshApiKeys();
      setLabel("");
      setPlainKey("");
    } catch (err: any) {
      setError(err?.message ?? "创建失败");
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("确认删除该密钥？")) return;
    try {
      await api.deleteApiKey(id);
      await refreshApiKeys();
    } catch (err: any) {
      setError(err?.message ?? "删除失败");
    }
  }

  async function copyKey(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    } catch {}
  }

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.displayName || a.loginValue}</option>
          ))}
        </Select>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="标签（如：主账号）" />
        <Input value={plainKey} onChange={(e) => setPlainKey(e.target.value)} placeholder="自定义 Key（可留空）" />
        <Button type="submit" disabled={loading || accounts.length === 0} className="gap-1">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          保存
        </Button>
      </form>

      {error && <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

      <div className="space-y-1.5">
        {apiKeys.length === 0 && <p className="text-sm text-muted">尚未创建任何密钥</p>}
        {apiKeys.map((k) => {
          const account = accounts.find((a) => a.id === k.accountId);
          const keyText = k.plainKey || `（密钥已隐藏，ID: ${k.id.slice(0, 8)}）`;
          return (
            <div key={k.id} className="rounded-md border border-border bg-surface px-3 py-2">
              <div className="flex items-center gap-3">
                <Key size={16} className="shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-text">{k.label}</div>
                  <div className="truncate font-mono text-xs text-muted">{keyText}</div>
                </div>
                <button onClick={() => copyKey(keyText)} className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-text transition-colors">
                  {copied === keyText ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
                </button>
                <button onClick={() => remove(k.id)} className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-danger transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
              {account && <div className="mt-1 text-xs text-muted">绑定账号：{account.displayName || account.loginValue}</div>}
            </div>
          );
        })}
      </div>

      <div className="rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">
        <div className="mb-1 font-medium text-text">API 端点</div>
        <div>OpenAI：GET /v1/models、POST /v1/chat/completions、POST /v1/responses</div>
        <div>Anthropic：POST /v1/messages</div>
        <div className="mt-1">鉴权：Authorization: Bearer &lt;KEY&gt; 或 x-api-key: &lt;KEY&gt;</div>
      </div>
    </div>
  );
}
