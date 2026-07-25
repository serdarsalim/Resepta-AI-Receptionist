"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { isLanguage, type TranslationKey } from "@/lib/i18n";
import { useTheme, type Theme } from "@/lib/theme";

// Shell composition ported from Nudge (src/app/page.tsx + AppHeader there):
// fixed-height pane, recessed sidebar, floating main card that scrolls
// internally, settings behind the initials chip — never a nav tab.

export type TabId =
  | "appointments"
  | "customers"
  | "calls"
  | "messages"
  | "settings";

const NAV_TABS: { id: TabId; key: TranslationKey }[] = [
  { id: "appointments", key: "nav.appointments" },
  { id: "customers", key: "nav.customers" },
  { id: "calls", key: "nav.calls" },
  { id: "messages", key: "nav.messages" },
];

function initialsFrom(name?: string | null, email?: string | null): string {
  const source = (name || email || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

// Google OAuth carries no business name, so a fresh org arrives unnamed —
// this one-question gate runs before anything else and is the whole
// onboarding.
function OnboardingGate() {
  const { t } = useLanguage();
  const update = useMutation(api.orgs.update);
  return (
    <div className="flex h-[100dvh] items-center justify-center bg-[var(--pane)] p-6">
      <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-lg font-semibold">{t("onboarding.title")}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("onboarding.prompt")}</p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
            if (name) void update({ name });
          }}
        >
          <label className="block text-sm">
            {t("onboarding.businessName")}
            <input name="name" required autoFocus className="mt-1" />
          </label>
          <button
            type="submit"
            className="w-full rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-[var(--accent-fg)]"
          >
            {t("onboarding.start")}
          </button>
        </form>
      </div>
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
function AutoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function SignOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

// Ported from Nudge's AppHeader UserMenu, minus the Convex theme persistence
// (Randevu keeps the preference in localStorage only for now).
function UserMenu({
  name,
  email,
  remoteTheme,
  onOpenSettings,
}: {
  name?: string;
  email?: string;
  remoteTheme?: Theme;
  onOpenSettings: () => void;
}) {
  const { t } = useLanguage();
  const { signOut } = useAuthActions();
  const { theme, setTheme, mounted } = useTheme();
  const saveTheme = useMutation(api.users.setMyTheme);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Convex is the cross-device source of truth; localStorage (inside useTheme)
  // is the instant no-FOUC cache. Adopt the stored server preference, but hold
  // a pending ref so our own optimistic write doesn't get reverted by the
  // round-trip lag (Nudge's pattern, ported).
  const pending = useRef<Theme | null>(null);
  useEffect(() => {
    if (!mounted || !remoteTheme) return;
    if (pending.current) {
      if (remoteTheme === pending.current) pending.current = null;
      return;
    }
    if (remoteTheme !== theme) setTheme(remoteTheme);
  }, [mounted, remoteTheme, theme, setTheme]);

  const chooseTheme = (next: Theme) => {
    pending.current = next;
    setTheme(next);
    saveTheme({ theme: next }).catch(() => {
      pending.current = null;
    });
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const THEME_OPTIONS: { value: Theme; key: TranslationKey; Icon: () => React.ReactNode }[] = [
    { value: "light", key: "theme.light", Icon: SunIcon },
    { value: "dark", key: "theme.dark", Icon: MoonIcon },
    { value: "auto", key: "theme.auto", Icon: AutoIcon },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--muted-bg)] text-xs font-semibold text-[var(--foreground)] ring-1 ring-[var(--border)] hover:ring-[var(--muted)] transition-shadow"
      >
        {initialsFrom(name, email)}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg"
        >
          <div className="border-b border-[var(--border)] px-3 py-2.5">
            <div className="truncate text-sm font-medium">{name || email}</div>
            {name && email && (
              <div className="truncate text-xs text-[var(--muted)]">{email}</div>
            )}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-[var(--muted-bg)] transition-colors"
          >
            <span className="inline-flex h-[18px] w-[18px] items-center justify-center text-[var(--muted)]">
              <GearIcon />
            </span>
            {t("nav.settings")}
          </button>
          <div className="border-t border-[var(--border)] pt-1.5">
            <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
              {t("menu.appearance")}
            </div>
            {THEME_OPTIONS.map(({ value, key, Icon }) => {
              const active = mounted && theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => chooseTheme(value)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-[var(--muted-bg)] transition-colors"
                >
                  <span className="inline-flex h-[18px] w-[18px] items-center justify-center text-[var(--muted)]">
                    <Icon />
                  </span>
                  <span className="flex-1 text-left">{t(key)}</span>
                  {active && (
                    <span className="inline-flex h-[18px] w-[18px] items-center justify-center">
                      <CheckIcon />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="border-t border-[var(--border)]">
            <button
              type="button"
              role="menuitem"
              onClick={() => void signOut()}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-[var(--muted-bg)] transition-colors"
            >
              <span className="inline-flex h-[18px] w-[18px] items-center justify-center text-[var(--muted)]">
                <SignOutIcon />
              </span>
              {t("nav.signOut")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Workspace switcher (Retell-style): one login, many client businesses.
// Collapses to a plain label when the user belongs to exactly one.
function WorkspaceSwitcher({ fallbackName }: { fallbackName?: string }) {
  const { t } = useLanguage();
  const data = useQuery(api.users.myWorkspaces, {});
  const setActiveOrg = useMutation(api.users.setActiveOrg);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const active = data?.workspaces.find((w) => w.orgId === data.activeOrgId);
  const label = active?.name || fallbackName || t("app.name");

  if (!data || data.workspaces.length < 2) {
    return (
      <span className="block px-2 text-sm font-semibold tracking-tight">{label}</span>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-semibold tracking-tight transition-colors hover:bg-[var(--row-hover-bg)]"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="text-[10px] text-[var(--muted)]">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg"
        >
          <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
            {t("workspace.switch")}
          </div>
          {data.workspaces.map((workspace) => (
            <button
              key={workspace.orgId}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                if (workspace.orgId !== data.activeOrgId) {
                  void setActiveOrg({ orgId: workspace.orgId });
                }
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--muted-bg)]"
            >
              <span className="min-w-0 flex-1 truncate">
                {workspace.name || t("app.name")}
              </span>
              {workspace.orgId === data.activeOrgId && (
                <span className="text-[var(--brand)]">
                  <CheckIcon />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppShell({
  tab,
  onTab,
  children,
}: {
  tab: TabId;
  onTab: (tab: TabId) => void;
  children: React.ReactNode;
}) {
  const { t, language, setLanguage } = useLanguage();
  const settings = useQuery(api.orgs.current, {});
  const failedCount = useQuery(api.messages.failedCount, {});

  // The org's language is the app's language — set in Settings, nowhere else.
  const orgLanguage = settings?.org.language;
  useEffect(() => {
    if (isLanguage(orgLanguage) && orgLanguage !== language) setLanguage(orgLanguage);
  }, [orgLanguage, language, setLanguage]);

  if (settings && settings.org.name === "") return <OnboardingGate />;

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[var(--pane)] md:p-2 md:gap-2">
      {/* Sidebar: recessed pane, hidden on phones (bottom nav takes over). */}
      <aside className="app-pane hidden w-52 shrink-0 flex-col overflow-hidden md:flex">
        <div className="px-2 pb-2 pt-3">
          <WorkspaceSwitcher fallbackName={settings?.org.name} />
        </div>
        <nav className="flex-1 space-y-0.5 px-2">
          {NAV_TABS.map((entry) => {
            const active = tab === entry.id;
            return (
              <button
                key={entry.id}
                onClick={() => onTab(entry.id)}
                className={`flex w-full items-center rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-[var(--row-hover-bg)] font-medium text-[var(--foreground)]"
                    : "text-[var(--muted)] hover:bg-[var(--row-hover-bg)] hover:text-[var(--foreground)]"
                }`}
              >
                <span className="flex-1 text-left">{t(entry.key)}</span>
                {entry.id === "messages" && (failedCount ?? 0) > 0 && (
                  <span className="h-2 w-2 rounded-full bg-red-500" aria-label="failed sends" />
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Floating content card; scrolls internally (min-h-0 is load-bearing). */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--background)] md:rounded-xl md:border md:border-[var(--border)]">
        <header className="flex items-center justify-between gap-3 px-4 pb-1 pt-3">
          <h1 className="page-title truncate text-sm font-semibold md:text-base">
            {tab === "settings"
              ? t("settings.title")
              : t(NAV_TABS.find((entry) => entry.id === tab)?.key ?? "app.name")}
          </h1>
          <div className="flex items-center gap-2">
            {tab === "settings" && (
              <button
                aria-label="Close settings"
                onClick={() => onTab("appointments")}
                className="rounded-md px-2 py-1 text-lg leading-none text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
              >
                ×
              </button>
            )}
            <UserMenu
              name={settings?.me.name}
              email={settings?.me.email}
              remoteTheme={settings?.me.themePreference}
              onOpenSettings={() => onTab("settings")}
            />
          </div>
        </header>
        <main className="thin-scroll stable-gutter min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
          {children}
        </main>
        {/* Phone nav */}
        <nav className="flex border-t border-[var(--border)] md:hidden">
          {NAV_TABS.map((entry) => (
            <button
              key={entry.id}
              onClick={() => onTab(entry.id)}
              className={`flex-1 px-2 py-2.5 text-xs ${
                tab === entry.id
                  ? "font-semibold text-[var(--foreground)]"
                  : "text-[var(--muted)]"
              }`}
            >
              {t(entry.key)}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
