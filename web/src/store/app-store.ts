import { create } from "zustand";
import { api, type SessionPayload, type Account, type ApiKey, type IncognitoState, type AdminData } from "@/lib/api";

interface AppState {
  session: SessionPayload | null;
  loading: boolean;
  error: string | null;

  loadSession: () => Promise<void>;
  setSession: (s: SessionPayload) => void;
  clearSession: () => void;

  accounts: Account[];
  apiKeys: ApiKey[];
  incognito: IncognitoState | null;
  adminData: AdminData | null;

  refreshAccounts: () => Promise<void>;
  refreshApiKeys: () => Promise<void>;
  setIncognitoState: (s: IncognitoState) => void;
  setAdminData: (d: AdminData) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  session: null,
  loading: true,
  error: null,

  accounts: [],
  apiKeys: [],
  incognito: null,
  adminData: null,

  loadSession: async () => {
    set({ loading: true, error: null });
    try {
      const s = await api.me();
      set({
        session: s,
        loading: false,
        accounts: s.accounts ?? [],
        apiKeys: s.apiKeys ?? [],
        incognito: s.incognito ?? null,
        adminData: s.adminData ?? null
      });
    } catch (e: any) {
      set({ session: { authenticated: false }, loading: false, error: e?.message ?? "load failed" });
    }
  },

  setSession: (s) => set({
    session: s,
    accounts: s.accounts ?? get().accounts,
    apiKeys: s.apiKeys ?? get().apiKeys,
    incognito: s.incognito ?? get().incognito,
    adminData: s.adminData ?? get().adminData
  }),

  clearSession: () => set({ session: { authenticated: false }, accounts: [], apiKeys: [], incognito: null, adminData: null }),

  refreshAccounts: async () => {
    try { const r = await api.listAccounts(); set({ accounts: r.accounts }); } catch {}
  },
  refreshApiKeys: async () => {
    try { const r = await api.listApiKeys(); set({ apiKeys: r.apiKeys }); } catch {}
  },
  setIncognitoState: (s) => set({ incognito: s }),
  setAdminData: (d) => set({ adminData: d })
}));
