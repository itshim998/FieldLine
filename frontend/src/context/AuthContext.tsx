import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

export type AccountType = 'worker' | 'admin';

export interface SessionIdentity {
  accountId: string;
  projectId: string;
  accountType: AccountType;
  displayName: string;
  roleTitle: string | null;
  issuedAt: number;
  expiresAt: number;
}

export interface AuthProject {
  id: string;
  code: string;
  name: string;
}

export interface LoginCredentials {
  projectId?: string;
  projectCode?: string;
  accountType: AccountType;
  passcode: string;
}

export interface AuthContextType {
  token: string | null;
  session: SessionIdentity | null;
  project: AuthProject | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

const STORAGE_KEY_AUTH_TOKEN = 'fieldline_session_token';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
    } catch {
      return null;
    }
  });
  const [session, setSession] = useState<SessionIdentity | null>(null);
  const [project, setProject] = useState<AuthProject | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Validate existing token on mount
  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      const storedToken = localStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      if (!storedToken) {
        if (isMounted) {
          setIsLoading(false);
        }
        return;
      }

      try {
        const res = await fetch('/api/auth/session', {
          headers: {
            Authorization: `Bearer ${storedToken}`
          }
        });

        if (res.ok) {
          const data = await res.json();
          if (isMounted && data.success && data.session) {
            setToken(storedToken);
            setSession(data.session);
            setProject(data.project || null);
          }
        } else {
          // Token invalid or expired
          try {
            localStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
          } catch {
            // ignore
          }
          if (isMounted) {
            setToken(null);
            setSession(null);
            setProject(null);
          }
        }
      } catch {
        // Network error during session restore - keep token temporarily or clear
        // We do not clear if network is down, but set loading false
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const login = useCallback(async (credentials: LoginCredentials) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(credentials)
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        const errorMessage = data.error?.message || data.message || 'Login failed. Check credentials.';
        return { success: false, error: errorMessage };
      }

      const newToken = data.token as string;
      const newSession = data.session as SessionIdentity;
      const newProject = data.project as AuthProject;

      try {
        localStorage.setItem(STORAGE_KEY_AUTH_TOKEN, newToken);
      } catch {
        // ignore
      }

      setToken(newToken);
      setSession(newSession);
      setProject(newProject);

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error connecting to auth server' };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
    } catch {
      // ignore
    }
    setToken(null);
    setSession(null);
    setProject(null);
  }, []);

  // Authenticated fetch wrapper injecting Authorization Bearer header
  const authFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const activeToken = token || localStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      const headers = new Headers(init?.headers);

      if (activeToken && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${activeToken}`);
      }

      const modifiedInit: RequestInit = {
        ...init,
        headers
      };

      const response = await fetch(input, modifiedInit);

      // If token is rejected as expired or unauthorized (401), trigger session clear
      if (response.status === 401 && activeToken) {
        try {
          localStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
        } catch {
          // ignore
        }
        setToken(null);
        setSession(null);
        setProject(null);
      }

      return response;
    },
    [token]
  );

  const value = useMemo<AuthContextType>(
    () => ({
      token,
      session,
      project,
      isAuthenticated: Boolean(token && session),
      isLoading,
      login,
      logout,
      authFetch
    }),
    [token, session, project, isLoading, login, logout, authFetch]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function useOptionalAuth(): AuthContextType | undefined {
  return useContext(AuthContext);
}
