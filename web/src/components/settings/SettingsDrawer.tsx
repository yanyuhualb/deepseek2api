import { useEffect, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Tabs } from "@/components/ui/Tabs";
import { AccountsPanel } from "./AccountsPanel";
import { KeysPanel } from "./KeysPanel";
import { ProxyPanel } from "./ProxyPanel";
import { IncognitoPanel } from "./IncognitoPanel";
import { AdminPanel } from "./AdminPanel";
import { useAppStore } from "@/store/app-store";

type SettingsTab = "accounts" | "keys" | "proxy" | "incognito" | "admin";

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
}

export function SettingsDrawer({ open, onClose, initialTab = "accounts" }: SettingsDrawerProps) {
  const session = useAppStore((s) => s.session);
  const isAdmin = session?.role === "admin";
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  const items: { value: SettingsTab; label: ReactNode }[] = [
    { value: "accounts", label: "账号" },
    { value: "keys", label: "密钥" },
    { value: "proxy", label: "代理" },
    { value: "incognito", label: "无痕" }
  ];
  if (isAdmin) items.push({ value: "admin", label: "管理" });

  return (
    <Dialog open={open} onClose={onClose} title="设置" description="账号、密钥、代理与管理" className="max-w-2xl">
      <Tabs value={tab} onValueChange={(v) => setTab(v as SettingsTab)} items={items} className="mb-4 w-full" />
      <div className="space-y-4">
        {tab === "accounts" && <AccountsPanel />}
        {tab === "keys" && <KeysPanel />}
        {tab === "proxy" && <ProxyPanel />}
        {tab === "incognito" && <IncognitoPanel />}
        {tab === "admin" && isAdmin && <AdminPanel />}
      </div>
    </Dialog>
  );
}
