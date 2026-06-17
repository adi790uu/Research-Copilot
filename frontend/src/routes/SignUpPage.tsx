import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ThemeToggle } from "../components/ui/ThemeToggle";
import { Wordmark } from "../components/ui/Wordmark";
import { useAuth } from "../lib/auth";

export default function SignUpPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setSubmitting(true);
    try {
      await signUp(email.trim(), password);
      navigate("/app", { replace: true });
    } catch (e) {
      setError((e as Error).message ?? "Sign-up failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      <aside className="hidden md:flex flex-col justify-between border-r border-rule/8 px-10 py-10 bg-bg-elev/40">
        <Wordmark />
        <div className="space-y-6 stagger">
          <p className="eyebrow">Welcome</p>
          <h1
            className="font-display text-4xl text-ink leading-tight"
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
          >
            New brief.{" "}
            <em
              className="italic text-accent"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1' }}
            >
              Same craft.
            </em>
          </h1>
          <p className="text-ink-soft leading-relaxed max-w-prose">
            Create an account and start commissioning research briefs. We hash
            your password with bcrypt and store nothing else you don't see here.
          </p>
        </div>
        <p className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint">
          Set in Fraunces &amp; Geist
        </p>
      </aside>

      <section className="flex flex-col">
        <header className="flex items-center justify-between px-6 md:px-10 h-14 border-b border-rule/8">
          <Link
            to="/"
            className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint hover:text-ink transition-colors"
          >
            ← Back home
          </Link>
          <ThemeToggle />
        </header>

        <div className="flex-1 flex items-center justify-center px-6 py-10">
          <form onSubmit={onSubmit} className="w-full max-w-sm space-y-7">
            <div className="space-y-1.5">
              <p className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint">
                Create account
              </p>
              <h2
                className="font-display text-3xl text-ink"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
              >
                Start your archive.
              </h2>
            </div>

            <div className="space-y-5">
              <label className="block space-y-2">
                <span className="field-label">Email</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input"
                  placeholder="you@example.com"
                />
              </label>
              <label className="block space-y-2">
                <span className="field-label">Password</span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  placeholder="at least 8 characters"
                />
              </label>
              <label className="block space-y-2">
                <span className="field-label">Confirm</span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="input"
                  placeholder="repeat password"
                />
              </label>
            </div>

            {error && (
              <p className="font-mono text-xs uppercase tracking-wider text-bad border-l-2 border-bad/60 pl-3 py-1">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-ink-soft">
                Already have one?{" "}
                <Link to="/sign-in" className="text-accent hover:underline">
                  Sign in
                </Link>
              </p>
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? "Creating…" : (<>Create account<span className="arrow">→</span></>)}
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
