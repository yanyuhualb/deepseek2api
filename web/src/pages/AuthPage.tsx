import { useState, type FormEvent } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Tabs } from "@/components/ui/Tabs";

export function AuthPage() {
  const setSession = useAppStore((s) => s.setSession);
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const session = useAppStore((s) => s.session);
  const inviteRequired = Boolean(session?.registration?.inviteRequired);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const s = tab === "login"
        ? await api.login(username, password)
        : await api.register(username, password, inviteCode || undefined);
      setSession(s);
    } catch (err: any) {
      setError(err?.message ?? "请求失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm animate-slide-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-white">
            <MessageSquare size={24} />
          </div>
          <h1 className="text-xl font-semibold text-text">DeepSeek 控制台</h1>
          <p className="mt-1 text-sm text-muted">登录或注册以进入工作区</p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
          <Tabs
            value={tab}
            onValueChange={(v) => { setTab(v as any); setError(null); }}
            items={[
              { value: "login", label: "登录" },
              { value: "register", label: "注册" }
            ]}
            className="mb-5 w-full"
          />

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">账号</label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="输入账号"
                autoComplete="username"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">密码</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="输入密码"
                autoComplete={tab === "login" ? "current-password" : "new-password"}
                required
              />
            </div>
            {tab === "register" && inviteRequired && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted">邀请码</label>
                <Input
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="输入邀请码"
                  required
                />
              </div>
            )}

            {error && (
              <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading && <Loader2 size={16} className="animate-spin" />}
              {tab === "login" ? "登录" : "注册并进入"}
            </Button>
          </form>

          {tab === "register" && !inviteRequired && (
            <p className="mt-4 text-center text-xs text-muted">当前开放注册，无需邀请码</p>
          )}
        </div>
      </div>
    </div>
  );
}
