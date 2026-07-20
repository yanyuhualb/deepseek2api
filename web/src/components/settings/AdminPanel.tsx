import { useState } from "react";
import { Loader2, Plus, Trash2, UserCog } from "lucide-react";
import { api, type Invite, type PublicUser } from "@/lib/api";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

export function AdminPanel() {
  const adminData = useAppStore((s) => s.adminData);
  const setAdminData = useAppStore((s) => s.setAdminData);
  const [inviteRequired, setInviteRequired] = useState(adminData?.registration.inviteRequired ?? false);
  const [inviteCount, setInviteCount] = useState(1);
  const [selectedInvites, setSelectedInvites] = useState<Set<string>>(new Set());
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!adminData) return <p className="text-sm text-muted">无法加载管理数据</p>;

  async function saveRegistration() {
    setLoading("reg");
    try {
      await api.setRegistration(inviteRequired);
      setAdminData({ ...adminData!, registration: { inviteRequired } });
    } catch (err: any) {
      setError(err?.message ?? "保存失败");
    } finally { setLoading(null); }
  }

  async function genInvites() {
    setLoading("inv");
    try {
      const r = await api.createInvites(inviteCount);
      setAdminData({ ...adminData!, invites: [...r.invites, ...adminData!.invites] });
    } catch (err: any) {
      setError(err?.message ?? "生成失败");
    } finally { setLoading(null); }
  }

  async function deleteSelectedInvites() {
    if (selectedInvites.size === 0) return;
    setLoading("inv-del");
    try {
      await api.deleteInvites([...selectedInvites]);
      setAdminData({ ...adminData!, invites: adminData!.invites.filter((i) => !selectedInvites.has(i.id)) });
      setSelectedInvites(new Set());
    } catch (err: any) {
      setError(err?.message ?? "删除失败");
    } finally { setLoading(null); }
  }

  async function toggleUser(u: PublicUser, enabled: boolean) {
    setLoading(`user-${u.id}`);
    try {
      await api.setUserEnabled(u.id, enabled);
      setAdminData({ ...adminData!, users: adminData!.users.map((x) => x.id === u.id ? { ...x, enabled } : x) });
    } finally { setLoading(null); }
  }

  async function deleteSelectedUsers() {
    if (selectedUsers.size === 0) return;
    if (!confirm(`确认删除 ${selectedUsers.size} 个用户？`)) return;
    setLoading("user-del");
    try {
      await api.batchDeleteUsers([...selectedUsers]);
      setAdminData({ ...adminData!, users: adminData!.users.filter((u) => !selectedUsers.has(u.id)) });
      setSelectedUsers(new Set());
    } finally { setLoading(null); }
  }

  function toggle(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }

  return (
    <div className="space-y-5">
      {error && <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

      {/* Registration */}
      <section className="rounded-md border border-border bg-surface p-4">
        <h3 className="mb-3 text-sm font-semibold text-text">注册开关</h3>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={inviteRequired} onChange={(e) => setInviteRequired(e.target.checked)} className="accent-accent" />
            启用邀请码注册
          </label>
          <Button size="sm" onClick={saveRegistration} disabled={loading === "reg"}>
            {loading === "reg" && <Loader2 size={14} className="animate-spin" />}
            保存
          </Button>
        </div>
      </section>

      {/* Invites */}
      <section className="rounded-md border border-border bg-surface p-4">
        <h3 className="mb-3 text-sm font-semibold text-text">邀请码</h3>
        <div className="mb-3 flex items-center gap-2">
          <Input type="number" min={1} value={inviteCount} onChange={(e) => setInviteCount(Number(e.target.value) || 1)} className="w-24" />
          <Button size="sm" onClick={genInvites} disabled={loading === "inv"} className="gap-1">
            {loading === "inv" ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            生成
          </Button>
          <div className="flex-1" />
          <Button size="sm" variant="danger" onClick={deleteSelectedInvites} disabled={selectedInvites.size === 0 || loading === "inv-del"}>
            批量删除 ({selectedInvites.size})
          </Button>
        </div>
        <div className="max-h-60 space-y-1.5 overflow-y-auto">
          {adminData.invites.length === 0 && <p className="text-sm text-muted">暂无邀请码</p>}
          {adminData.invites.map((inv) => (
            <InviteRow key={inv.id} inv={inv} selected={selectedInvites.has(inv.id)} onToggle={() => setSelectedInvites((s) => toggle(s, inv.id))} />
          ))}
        </div>
      </section>

      {/* Users */}
      <section className="rounded-md border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">用户</h3>
          <Button size="sm" variant="danger" onClick={deleteSelectedUsers} disabled={selectedUsers.size === 0 || loading === "user-del"}>
            批量删除 ({selectedUsers.size})
          </Button>
        </div>
        <div className="max-h-60 space-y-1.5 overflow-y-auto">
          {adminData.users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2">
              <input
                type="checkbox"
                checked={selectedUsers.has(u.id)}
                onChange={() => setSelectedUsers((s) => toggle(s, u.id))}
                className="accent-accent"
              />
              <UserCog size={16} className="text-muted" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text">{u.username}</div>
                <div className="text-xs text-muted">{u.role === "admin" ? "管理员" : "本地用户"}</div>
              </div>
              <span className={cn("text-xs", u.enabled ? "text-accent" : "text-muted")}>{u.enabled ? "启用" : "禁用"}</span>
              <button
                onClick={() => toggleUser(u, !u.enabled)}
                disabled={loading === `user-${u.id}` || u.role === "admin"}
                className="rounded px-2 py-1 text-xs text-muted hover:bg-surface hover:text-text disabled:opacity-40"
              >
                {u.role === "admin" ? "—" : u.enabled ? "禁用" : "启用"}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function InviteRow({ inv, selected, onToggle }: { inv: Invite; selected: boolean; onToggle: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(inv.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }
  return (
    <div className="flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2">
      <input type="checkbox" checked={selected} onChange={onToggle} className="accent-accent" />
      <code className="flex-1 truncate font-mono text-sm text-text">{inv.code}</code>
      <span className="text-xs text-muted">{inv.usedAt ? "已使用" : "可用"}</span>
      <button onClick={copy} className="rounded px-2 py-1 text-xs text-muted hover:text-text">
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}
