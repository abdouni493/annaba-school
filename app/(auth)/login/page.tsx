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
import { DEMO_ACCOUNTS, DEMO_ROLES, findDemoAccount } from "@/lib/demoAccounts";

export default function LoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const school = useData((s) => s.school);
  const login = useSession((s) => s.login);
  const sessionUser = useSession((s) => s.user);
  const hydrated = useSession((s) => s.hydrated);

  useEffect(() => {
    if (hydrated && sessionUser) router.replace(roleHome(sessionUser.role));
  }, [hydrated, sessionUser, router]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  /** Manual form: matches one of the demo accounts, any password. */
  const handleManual = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const account = findDemoAccount(email);
    if (!account) {
      setError(t("auth.invalidCredentials"));
      return;
    }
    login(account);
    router.replace(roleHome(account.role));
  };

  const signInAs = (role: keyof typeof DEMO_ACCOUNTS) => {
    const account = DEMO_ACCOUNTS[role];
    login(account);
    router.replace(roleHome(account.role));
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
          <p className="mt-1 text-sm text-muted">{t("auth.signInSubtitle")}</p>
        </div>

        {/* Manual sign-in — any password works on a demo email */}
        <form onSubmit={handleManual} className="mt-7 space-y-3">
          <Input
            type="email"
            placeholder={t("auth.email")}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError("");
            }}
          />
          <Input
            type="password"
            placeholder={t("auth.password")}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
          />
          {error && <p className="text-sm font-medium text-danger">{error}</p>}
          <Button type="submit" size="lg" className="w-full">
            {t("auth.signIn")}
          </Button>
        </form>

        {/* Separator */}
        <div className="my-6 flex items-center gap-3">
          <span className="h-px flex-1 bg-line" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            {t("auth.or")}
          </span>
          <span className="h-px flex-1 bg-line" />
        </div>

        {/* One-tap demo logins */}
        <div className="space-y-2">
          <p className="text-center text-sm font-semibold text-ink">{t("auth.demoLogin")}</p>
          <p className="text-center text-xs text-muted">{t("auth.chooseDemo")}</p>
          <div className="grid gap-2 pt-2">
            {DEMO_ROLES.map(({ role, label, emoji }) => (
              <Button
                key={role}
                variant="outline"
                className="w-full justify-center gap-2"
                onClick={() => signInAs(role)}
              >
                <span aria-hidden>{emoji}</span>
                {label}
              </Button>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
