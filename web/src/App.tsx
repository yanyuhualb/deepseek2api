import { useEffect, useState } from "react";
import { MessageSquare, Settings, LogOut, Sun, Moon, Menu } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { useTheme, useApplyTheme } from "@/store/theme";
import { api } from "@/lib/api";
import { ChatView } from "@/components/chat/ChatView";
import { SettingsDrawer } from "@/components/settings/SettingsDrawer";
import { AuthPage } from "@/pages/AuthPage";
import { cn } from "@/lib/utils";

export default function App() {
  useApplyTheme();
  const { theme, toggle } = useTheme();
  const { session, loading, loadSession, clearSession } = useAppStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => { loadSession(); }, [loadSession]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg text-muted">
        <div className="animate-pulse-soft">加载中…</div>
      </div>
    );
  }

  if (!session?.authenticated) {
    return <AuthPage />;
  }

  async function logout() {
    try { await api.logout(); } catch {}
    clearSession();
  }

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2 md:hidden">
        <button onClick={() => setSidebarOpen((v) => !v)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text">
          <Menu size={18} />
        </button>
        <span className="text-sm font-medium">DeepSeek</span>
        <button onClick={toggle} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text">
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left rail (desktop) / slide-over (mobile) */}
        <aside
          className={cn(
            "z-40 flex w-60 shrink-0 flex-col border-r border-border bg-surface transition-transform md:translate-x-0 md:static md:flex",
            sidebarOpen ? "absolute inset-y-0 left-0 translate-x-0 shadow-xl" : "absolute inset-y-0 left-0 -translate-x-full md:translate-x-0"
          )}
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
              <MessageSquare size={18} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text">DeepSeek 控制台</div>
              <div className="truncate text-xs text-muted">{session.username || (session.role === "admin" ? "管理员" : "本地用户")}</div>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto p-2">
            <button
              onClick={() => { setSidebarOpen(false); }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-text hover:bg-surface-2 transition-colors md:hidden"
            >
              <MessageSquare size={16} /> 聊天
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-text transition-colors"
            >
              <Settings size={16} /> 设置
            </button>
          </nav>

          <div className="border-t border-border p-2">
            <div className="hidden items-center justify-between rounded-md px-3 py-2 md:flex">
              <span className="text-xs text-muted">主题</span>
              <button onClick={toggle} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-text">
                {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
            <button
              onClick={logout}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-danger transition-colors"
            >
              <LogOut size={16} /> 退出
            </button>
          </div>
        </aside>

        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div className="absolute inset-0 z-30 bg-black/30 md:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Main chat area */}
        <main className="flex min-w-0 flex-1 flex-col">
          <ChatView onOpenSettings={() => setSettingsOpen(true)} />
        </main>
      </div>

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
