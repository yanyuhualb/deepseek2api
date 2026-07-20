import { useState, type FormEvent } from "react";
import { Loader2, Plus, Trash2, User } from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function AccountsPanel() {
  const accounts = useAppStore((s) => s.accounts);
  const refreshAccounts = useAppStore((s) => s.refreshAccounts);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [deviceId] = useState(() => "web-" + crypto.randomUUID().slice(0, 12));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function bind(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.bindAccount(username, password, deviceId);
      await refreshAccounts();
      setUsername("");
      setPassword("");
    } catch (err: any) {
      setError(err?.message ?? "绑定失败");
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("确认删除该账号？")) return;
    try {
      await api.deleteAccount(id);
      await refreshAccounts();
    } catch (err: any) {
      setError(err?.message ?? "删除失败");
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={bind} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="手机号 / 邮箱" required />
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" required />
        <Button type="submit" disabled={loading} className="gap-1">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          绑定
        </Button>
      </form>

      {error && <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

      <div className="space-y-1.5">
        {accounts.length === 0 && <p className="text-sm text-muted">尚未绑定任何账号</p>}
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted">
              <User size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-text">{a.displayName || a.loginValue}</div>
              <div className="truncate text-xs text-muted">{a.emailMasked || a.mobileMasked || a.loginValue}</div>
            </div>
            <button onClick={() => remove(a.id)} className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-danger transition-colors">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
