"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/SearchInput";
import { ThemeToggle } from "@/components/controls/ThemeToggle";
import { LanguageSwitcher } from "@/components/controls/LanguageSwitcher";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { useData } from "@/lib/store/data";
import { useSession } from "@/lib/store/session";
import { roleHome } from "@/lib/nav";
import { adminExists, bootstrapAdmin } from "@/lib/accounts/users";

export default function LoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const school = useData((s) => s.school);
  const signIn = useSession((s) => s.signIn);
  const sessionUser = useSession((s) => s.user);
  const hydrated = useSession((s) => s.hydrated);

  useEffect(() => {
    if (hydrated && sessionUser) router.replace(roleHome(sessionUser.role));
  }, [hydrated, sessionUser, router]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // ---- "Créer un compte administrateur" -----------------------------------
  // The button only exists while the school has no administrator at all. Once
  // one is created it disappears for good — `admin_exists()` answers false only
  // on a brand-new database.
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [adminName, setAdminName] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [createError, setCreateError] = useState("");
  const [createdMessage, setCreatedMessage] = useState("");
  /** The database has not had `supabase/schema.sql` run against it yet. */
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    let cancelled = false;
    adminExists()
      .then((exists) => {
        if (cancelled) return;
        setHasAdmin(exists);
        setSetupError("");
      })
      .catch(() => {
        if (cancelled) return;
        // Nothing to create an admin against: say so plainly rather than
        // hiding the button and leaving the visitor with a dead screen.
        setHasAdmin(true);
        setSetupError(t("auth.databaseNotReady"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const user = await signIn(email, password);
      router.replace(roleHome(user.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.invalidCredentials"));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");

    if (!adminName.trim() || !adminUsername.trim() || !adminEmail.trim()) {
      setCreateError(t("auth.allFieldsRequired"));
      return;
    }
    if (adminPassword.length < 6) {
      setCreateError(t("auth.passwordTooShort"));
      return;
    }

    setBusy(true);
    try {
      await bootstrapAdmin({
        fullName: adminName,
        username: adminUsername,
        email: adminEmail,
        password: adminPassword,
      });

      // Created: the button is gone for good, whatever happens next.
      setHasAdmin(true);
      setShowCreate(false);
      setCreatedMessage(t("auth.adminCreated"));

      // Sign the new administrator straight in.
      try {
        const user = await signIn(adminEmail, adminPassword);
        router.replace(roleHome(user.role));
      } catch {
        // Account is there but the sign-in did not go through: hand the form
        // back with the email already filled in.
        setEmail(adminEmail.trim().toLowerCase());
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t("auth.createAdminFailed"));
      // A concurrent creation is the usual cause — re-check and hide the button.
      adminExists()
        .then(setHasAdmin)
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-canvas p-4">
      {/* Decorative gradient backdrop */}
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-gradient-primary blur-3xl opacity-30" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-gradient-danger blur-3xl opacity-30" />
      </div>

      {/* Top controls */}
      <div className="absolute end-4 top-4 z-10 flex items-center gap-2">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-0 w-full max-w-md rounded-3xl border border-line bg-surface p-8 card-shadow-lg"
      >
        {/* Logo + school name */}
        <div className="flex flex-col items-center text-center">
          <div className="login-logo-frame card-shadow">
            <div className="h-20 w-20 rounded-[1.25rem] bg-surface flex items-center justify-center overflow-hidden">
              {school.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={school.logo}
                  alt={school.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-4xl bg-gradient-to-br from-red-500/10 to-red-500/20">
                  🏫
                </div>
              )}
            </div>
          </div>
          <h1 className="mt-4 text-2xl font-extrabold login-name-gradient">{school.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {showCreate ? t("auth.createAdminSubtitle") : t("auth.signInSubtitle")}
          </p>
        </div>

        {!showCreate ? (
          <>
            {/* Sign in */}
            <form onSubmit={handleSignIn} className="mt-7 space-y-3">
              <Input
                type="email"
                autoComplete="email"
                placeholder={t("auth.email")}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError("");
                }}
              />
              <Input
                type="password"
                autoComplete="current-password"
                placeholder={t("auth.password")}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
              />
              {error && <p className="text-sm font-medium text-danger">{error}</p>}
              {setupError && (
                <p className="rounded-xl bg-danger/10 p-3 text-xs font-medium text-danger">
                  {setupError}
                </p>
              )}
              {createdMessage && (
                <p className="text-sm font-medium text-success">{createdMessage}</p>
              )}
              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy ? t("auth.signingIn") : t("auth.signIn")}
              </Button>
            </form>

            {/* Shown only while the school has no administrator yet. */}
            {hasAdmin === false && (
              <>
                <div className="my-6 flex items-center gap-3">
                  <span className="h-px flex-1 bg-line" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                    {t("auth.or")}
                  </span>
                  <span className="h-px flex-1 bg-line" />
                </div>
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full justify-center gap-2"
                  onClick={() => {
                    setCreateError("");
                    setShowCreate(true);
                  }}
                >
                  <span aria-hidden>🛡️</span>
                  {t("auth.createAdmin")}
                </Button>
                <p className="mt-2 text-center text-xs text-muted">
                  {t("auth.createAdminHint")}
                </p>
              </>
            )}
          </>
        ) : (
          /* Create the first administrator */
          <form onSubmit={handleCreateAdmin} className="mt-7 space-y-3">
            <Input
              placeholder={t("auth.fullName")}
              autoComplete="name"
              value={adminName}
              onChange={(e) => {
                setAdminName(e.target.value);
                setCreateError("");
              }}
            />
            <Input
              placeholder={t("auth.adminUsername")}
              autoComplete="username"
              value={adminUsername}
              onChange={(e) => {
                setAdminUsername(e.target.value);
                setCreateError("");
              }}
            />
            <Input
              type="email"
              placeholder={t("auth.email")}
              autoComplete="email"
              value={adminEmail}
              onChange={(e) => {
                setAdminEmail(e.target.value);
                setCreateError("");
              }}
            />
            <Input
              type="password"
              placeholder={t("auth.password")}
              autoComplete="new-password"
              value={adminPassword}
              onChange={(e) => {
                setAdminPassword(e.target.value);
                setCreateError("");
              }}
            />
            {createError && <p className="text-sm font-medium text-danger">{createError}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? t("auth.creating") : t("auth.createAccount")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setShowCreate(false)}
            >
              {t("auth.backToLogin")}
            </Button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
