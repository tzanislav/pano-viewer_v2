import { useState, type FormEvent } from 'react';
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { auth } from './firebaseClient';
import { useAuth } from './AuthProvider';
import { logAction } from '../app/logAction';

type Mode = 'sign-in' | 'create-account' | 'forgot-password';
const headings: Record<Mode, string> = {
  'sign-in': 'Welcome back', 'create-account': 'Create your account', 'forgot-password': 'Reset your password'
};

function authErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code === 'auth/invalid-email') return 'Enter a valid email address.';
  if (code === 'auth/weak-password') return 'Use a stronger password.';
  if (code === 'auth/email-already-in-use') return 'An account already uses this email address.';
  if (code === 'auth/invalid-credential') return 'Email or password is incorrect.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Try again later.';
  return 'We could not complete this request. Please try again.';
}

export function AuthScreen({ mode }: { mode: Mode }) {
  const { ready, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  if (!ready) return <main className="loading-screen">Restoring your session…</main>;
  if (user) return <Navigate to={from} replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'forgot-password') {
        await sendPasswordResetEmail(auth, email.trim());
        setSuccess(true);
        setMessage('If an account exists for this address, a reset email is on its way.');
      } else if (mode === 'create-account') {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
        navigate(from, { replace: true });
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
        navigate(from, { replace: true });
      }
      logAction(`auth.${mode}`, 'success');
    } catch (error) {
      setSuccess(false);
      setMessage(authErrorMessage(error));
      logAction(`auth.${mode}`, 'failure');
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-page">
    <Link className="brand" to="/">360<span>Walkthrough</span></Link>
    <section className="auth-card">
      <p className="eyebrow">Creator access</p>
      <h1>{headings[mode]}</h1>
      <p className="muted">{mode === 'forgot-password' ? 'Enter your email to receive a reset link.' : 'Build and revisit your private 360 walkthroughs.'}</p>
      <form onSubmit={(event) => void submit(event)}>
        <label className="field">Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        {mode !== 'forgot-password' && <label className="field">Password<input type="password" autoComplete={mode === 'create-account' ? 'new-password' : 'current-password'} required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
        {message && <p className="status" data-tone={success ? 'success' : 'error'} role="status">{message}</p>}
        <button className="button" disabled={busy}>{busy ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : mode === 'create-account' ? 'Create account' : 'Send reset email'}</button>
      </form>
      <div className="auth-links">
        {mode !== 'sign-in' && <Link to="/sign-in" state={{ from }}>Sign in</Link>}
        {mode !== 'create-account' && <Link to="/create-account" state={{ from }}>Create account</Link>}
        {mode !== 'forgot-password' && <Link to="/forgot-password" state={{ from }}>Forgot password?</Link>}
      </div>
    </section>
  </main>;
}
