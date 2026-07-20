import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Play } from "lucide-react";
import { api, proxyJson } from "@/lib/api";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select } from "@/components/ui/Input";

export function ProxyPanel() {
  const accounts = useAppStore((s) => s.accounts);
  const [accountId, setAccountId] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [path, setPath] = useState("");
  const [method, setMethod] = useState<"GET" | "POST">("GET");
  const [query, setQuery] = useState("");
  const [body, setBody] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.discovery().then((r) => { setPaths(r.paths); if (!path && r.paths[0]) setPath(r.paths[0]); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  async function run(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setOutput(null);
    try {
      let queryObj: Record<string, string> | undefined;
      if (query.trim()) {
        const parsed = JSON.parse(query);
        queryObj = typeof parsed === "object" && !Array.isArray(parsed)
          ? Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]))
          : undefined;
      }
      let bodyObj: any = undefined;
      if (body.trim()) bodyObj = JSON.parse(body);
      const result = await proxyJson(path, { method, body: bodyObj, query: queryObj, accountId });
      setOutput(JSON.stringify(result, null, 2));
    } catch (err: any) {
      setOutput(`错误：${err?.message ?? "请求失败"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr]">
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName || a.loginValue}</option>)}
        </Select>
        <Select value={path} onChange={(e) => setPath(e.target.value)}>
          {paths.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
        <Select value={method} onChange={(e) => setMethod(e.target.value as any)}>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
        </Select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted">查询参数（JSON）</label>
        <Textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={3} placeholder='{"chat_session_id":"..."}' />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted">请求体（JSON）</label>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder='{"message":"hello"}' />
      </div>
      <Button type="submit" onClick={run} disabled={loading} className="gap-1">
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
        执行
      </Button>
      {output && (
        <pre className="max-h-80 overflow-auto rounded-md border border-border bg-surface-2 p-3 text-xs font-mono text-text whitespace-pre-wrap">{output}</pre>
      )}
    </div>
  );
}
