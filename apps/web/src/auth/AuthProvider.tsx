import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './firebaseClient';

interface AuthState { ready: boolean; user: User | null }
const AuthContext = createContext<AuthState>({ ready: false, user: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ ready: false, user: null });
  useEffect(() => onAuthStateChanged(auth, (user) => setState({ ready: true, user })), []);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }
