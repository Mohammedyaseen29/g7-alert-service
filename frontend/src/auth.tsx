import { createContext, useContext, useState, type ReactNode } from 'react';
import { removePushOnLogout } from './api.js';

interface AuthCtx {
  token: string | null;
  role: string | null;
  login: (t: string, role: string) => void;
  logout: () => void;
}
const Ctx = createContext<AuthCtx>({ token: null, role: null, login: () => {}, logout: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('g7_token'));
  const [role, setRole] = useState<string | null>(() => localStorage.getItem('g7_role'));
  return (
    <Ctx.Provider value={{
      token, role,
      login: (t, r) => { localStorage.setItem('g7_token', t); localStorage.setItem('g7_role', r); setToken(t); setRole(r); },
      logout: () => { if (token) void removePushOnLogout(token); localStorage.removeItem('g7_token'); localStorage.removeItem('g7_role'); setToken(null); setRole(null); },
    }}>
      {children}
    </Ctx.Provider>
  );
}
export const useAuth = () => useContext(Ctx);
