import {Check, Copy, KeyRound, Lock, ShieldCheck} from 'lucide-react';
import {type FormEvent, useState} from 'react';
import {MANTIS_PHASE1_SCHEMA_SQL} from '../lib/schemaText';
import {SUPABASE_URL, supabase} from '../lib/supabase';

interface AuthGateProps {
  onAuthenticated: () => void;
}

export function AuthGate({onAuthenticated}: AuthGateProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [showSql, setShowSql] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || password.length < 6) {
      setErrorMessage('Enter a valid email address and a password of at least 6 characters.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'signin') {
        const {data, error} = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) {
          setErrorMessage(error.message);
          return;
        }
        if (data.session) {
          onAuthenticated();
        }
      } else {
        const {data, error} = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });
        if (error) {
          setErrorMessage(error.message);
          return;
        }
        if (data.session) {
          onAuthenticated();
        } else {
          setInfoMessage(
            'Account created. Check your email inbox to confirm your address, then sign in.',
          );
          setMode('signin');
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopySql() {
    try {
      await navigator.clipboard.writeText(MANTIS_PHASE1_SCHEMA_SQL);
      setCopiedSql(true);
      window.setTimeout(() => setCopiedSql(false), 2500);
    } catch {
      setCopiedSql(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas px-4 py-10 text-ink sm:px-6">
      <div className="mx-auto max-w-xl space-y-6">
        <div className="space-y-2 border-b border-line pb-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold tracking-tight text-ink">Mantis</h1>
            <span className="font-mono text-xs text-ink-muted">Personal Coding AI Studio</span>
          </div>
          <p className="text-sm leading-relaxed text-ink-muted">
            Personal coding companion with persistent Supabase memory. Sign in to load your
            organized knowledge folders and conversation history.
          </p>
        </div>

        <section className="rounded-lg border border-line bg-surface p-6">
          <div className="mb-5 flex items-center gap-2 rounded-md border border-line bg-inset p-1">
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setErrorMessage(null);
                setInfoMessage(null);
              }}
              className={`min-h-[42px] flex-1 rounded px-3 text-xs font-semibold transition-colors ${
                mode === 'signin'
                  ? 'bg-elevated text-ink'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setErrorMessage(null);
                setInfoMessage(null);
              }}
              className={`min-h-[42px] flex-1 rounded px-3 text-xs font-semibold transition-colors ${
                mode === 'signup'
                  ? 'bg-elevated text-ink'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="mantis-email" className="block text-xs font-medium text-ink-muted">
                Email address
              </label>
              <input
                id="mantis-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3.5 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="mantis-password" className="block text-xs font-medium text-ink-muted">
                Password
              </label>
              <input
                id="mantis-password"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3.5 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
              />
            </div>

            {errorMessage && (
              <div
                role="alert"
                className="rounded-md border border-danger-border bg-danger-soft px-3.5 py-2.5 text-xs leading-relaxed text-danger"
              >
                {errorMessage}
              </div>
            )}

            {infoMessage && (
              <div
                role="status"
                className="rounded-md border border-accent-border bg-accent-soft px-3.5 py-2.5 text-xs leading-relaxed text-ink"
              >
                {infoMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Lock className="h-4 w-4" />
              <span>
                {isSubmitting
                  ? mode === 'signin'
                    ? 'Signing in…'
                    : 'Creating account…'
                  : mode === 'signin'
                    ? 'Sign In to Mantis'
                    : 'Create Single-User Account'}
              </span>
            </button>
          </form>

          <div className="mt-5 space-y-2 border-t border-line pt-4 text-xs text-ink-muted">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 shrink-0 text-accent-text" />
              <span>Protected by Supabase Auth &amp; Postgres Row Level Security</span>
            </div>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 shrink-0 text-ink-subtle" />
              <span className="truncate font-mono text-[11px]">
                Connected to {SUPABASE_URL.replace('https://', '')} (Publishable key only)
              </span>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-semibold text-ink">
                First-Time Supabase Database Setup
              </h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                Need to create the Phase 1 tables before or after signing in?
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowSql((prev) => !prev)}
              className="min-h-[42px] rounded-md border border-line-strong bg-inset px-3 py-1.5 text-xs font-medium text-ink hover:bg-elevated"
            >
              {showSql ? 'Hide SQL Script' : 'View Phase 1 SQL'}
            </button>
          </div>

          {showSql && (
            <div className="mt-3 space-y-2 border-t border-line pt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-ink-muted">
                  Run once in Supabase Dashboard &rarr; SQL Editor
                </span>
                <button
                  type="button"
                  onClick={handleCopySql}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded border border-line-strong bg-inset px-3 py-1 text-xs font-medium text-ink hover:bg-elevated"
                >
                  {copiedSql ? (
                    <Check className="h-3.5 w-3.5 text-accent-text" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>{copiedSql ? 'Copied' : 'Copy SQL'}</span>
                </button>
              </div>
              <pre className="max-h-52 overflow-auto rounded-md border border-line bg-inset p-3 font-mono text-[11px] leading-relaxed text-ink">
                {MANTIS_PHASE1_SCHEMA_SQL}
              </pre>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
