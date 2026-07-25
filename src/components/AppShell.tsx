"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { isLanguage, type TranslationKey } from "@/lib/i18n";
import { useTheme, type Theme } from "@/lib/theme";

// Shell composition ported from Nudge (src/app/page.tsx + AppHeader there):
// fixed-height pane, recessed sidebar, floating main card that scrolls
// internally. Settings is a sidebar destination in its own group at the foot
// (Nudge does the same); the initials menu keeps a shortcut to it because the
// sidebar is hidden on phones.

export type TabId = "appointments" | "customers" | "inbox" | "settings";

const SIDEBAR_COLLAPSED_KEY = "randevu.sidebar-collapsed";

type IconProps = React.SVGProps<SVGSVGElement>;

function makeIcon(paths: React.ReactNode) {
  function Icon(props: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        {...props}
      >
        {paths}
      </svg>
    );
  }
  return Icon;
}

const AppointmentsIcon = makeIcon(
  <>
    <rect x="3" y="4.5" width="18" height="16" rx="2" />
    <path d="M3 9.5h18" />
    <path d="M8 2.5v4M16 2.5v4" />
    <path d="m9 14.5 2 2 4-4" />
  </>,
);
// A group of three people, same glyph Nudge uses for Contacts.
const CustomersIcon = makeIcon(
  <>
    <circle cx="12" cy="6.5" r="3" />
    <path d="M6.5 19v-.5a5.5 5.5 0 0 1 11 0v.5" />
    <circle cx="4.5" cy="9" r="2" />
    <path d="M1 17v-.3a3.3 3.3 0 0 1 3.5-3.2" />
    <circle cx="19.5" cy="9" r="2" />
    <path d="M23 17v-.3a3.3 3.3 0 0 0-3.5-3.2" />
  </>,
);
// A tray, not a speech bubble: the tab holds WhatsApp, email, and calls.
const InboxIcon = makeIcon(
  <>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </>,
);
// One gear definition, used at 18px in the sidebar and 16px in the user menu.
const SettingsIcon = makeIcon(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>,
);

// Each tab keeps ONE hue, carried by its symbol. The active row's wash stays
// neutral — hue on the symbol plus a bold label is the selected cue, so the
// sidebar never turns into a stack of coloured blocks.
const NAV_TABS: {
  id: TabId;
  key: TranslationKey;
  Icon: (props: IconProps) => React.ReactElement;
  color: string;
}[] = [
  {
    id: "appointments",
    key: "nav.appointments",
    Icon: AppointmentsIcon,
    color: "var(--brand)",
  },
  {
    id: "customers",
    key: "nav.customers",
    Icon: CustomersIcon,
    color: "#8b5cf6",
  },
  { id: "inbox", key: "nav.inbox", Icon: InboxIcon, color: "#0ea5e9" },
];

// Settings is config, not a place you work, so it sits in its own group at the
// foot of the sidebar (Nudge's grammar: the config group closes the nav). It
// wears --foreground rather than a hue for the same reason.
const FOOT_TABS: typeof NAV_TABS = [
  {
    id: "settings",
    key: "nav.settings",
    Icon: SettingsIcon,
    color: "var(--foreground)",
  },
];

// Nudge's mark, drawn inline rather than shipped as a file: the square takes
// --brand, so it follows Randevu's own green (and any future theming) instead
// of hardcoding the sibling product's hex.
function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className="shrink-0"
      aria-hidden
    >
      <rect width="64" height="64" rx="14" fill="var(--brand)" />
      <path
        d="M18 20 L32 32 L18 44"
        stroke="#ffffff"
        strokeWidth="6.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M33 20 L47 32 L33 44"
        stroke="#ffffff"
        strokeWidth="6.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

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
              <SettingsIcon width={16} height={16} />
            </span>
            {t("nav.settings")}
          </button>
          <div className="border-t border-[var(--border)] pt-1.5">
            <div className="px-3 pb-1 text-[11px] font-medium text-[var(--muted)]">
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
const WORKSPACE_MENU_WIDTH = 224; // w-56, used for the viewport clamp

function WorkspaceSwitcher({
  fallbackName,
  collapsed = false,
}: {
  fallbackName?: string;
  // Collapsed, the brand mark IS the trigger — otherwise switching org would
  // mean expanding the sidebar first, which for an operator running several
  // client workspaces is the one thing they do most.
  collapsed?: boolean;
}) {
  const { t } = useLanguage();
  const data = useQuery(api.users.myWorkspaces, {});
  const setActiveOrg = useMutation(api.users.setActiveOrg);
  // Menu position, measured from the trigger at open time. Null = closed.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setPos(null);
    };
    // Capture, so a scroll inside any pane closes it rather than leaving the
    // menu floating away from its trigger.
    const onScroll = () => setPos(null);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const active = data?.workspaces.find((w) => w.orgId === data.activeOrgId);
  const label = active?.name || fallbackName || t("app.name");

  if (!data || data.workspaces.length < 2) {
    return collapsed ? (
      <BrandMark size={24} />
    ) : (
      <span className="block truncate text-sm font-semibold tracking-tight">
        {label}
      </span>
    );
  }

  const toggle = () => {
    if (open) return setPos(null);
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      top: r.bottom + 4,
      left: Math.max(
        8,
        Math.min(r.left, window.innerWidth - WORKSPACE_MENU_WIDTH - 8),
      ),
    });
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? label : undefined}
        className={
          collapsed
            ? "rounded-md transition-opacity hover:opacity-80"
            : "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm font-semibold tracking-tight transition-colors hover:bg-[var(--row-hover-bg)]"
        }
      >
        {collapsed ? (
          <BrandMark size={24} />
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="text-[10px] text-[var(--muted)]">▾</span>
          </>
        )}
      </button>
      {/* Through a portal with fixed positioning, never an absolute child: the
          sidebar is overflow-hidden, so an in-flow menu gets clipped at the
          pane edge (see AGENTS.md — this recurs). */}
      {pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", width: WORKSPACE_MENU_WIDTH, ...pos }}
            className="z-[100] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg"
          >
            <div className="px-3 pb-1 pt-2 text-[11px] font-medium text-[var(--muted)]">
              {t("workspace.switch")}
            </div>
            {data.workspaces.map((workspace) => (
              <button
                key={workspace.orgId}
                role="menuitem"
                onClick={() => {
                  setPos(null);
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
          </div>,
          document.body,
        )}
    </>
  );
}

// One sidebar row, shared by the work group and the config group at the foot.
function SidebarButton({
  entry,
  active,
  collapsed,
  dot,
  onClick,
}: {
  entry: (typeof NAV_TABS)[number];
  active: boolean;
  collapsed: boolean;
  // Failed sends. Rides the icon's corner when collapsed, the trailing edge
  // otherwise — either way it never moves the label.
  dot?: boolean;
  onClick: () => void;
}) {
  const { t } = useLanguage();
  const { Icon, color } = entry;
  const label = t(entry.key);
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      // The tab's hue as a variable so the collapsed active pill can tint with
      // it. Harmless when inactive.
      style={{ "--tab-hue": color } as React.CSSProperties}
      className={`group relative flex h-9 items-center rounded-lg text-sm transition-colors ${
        collapsed
          ? // A centered rounded square around the symbol, not a full-width
            // squat oval hugging it.
            "mx-auto h-9 w-9 justify-center px-0"
          : "w-full gap-3 px-3"
      } ${
        active
          ? // Expanded keeps the neutral wash — hue lives on the symbol and the
            // bold label finishes the job. Collapsed has no label, so the pill
            // earns a tint of the tab's own hue as the stronger selected cue.
            `bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] font-semibold text-[var(--foreground)] ${
              collapsed ? "bg-[color-mix(in_srgb,var(--tab-hue)_14%,transparent)]" : ""
            }`
          : "font-medium text-[var(--muted)] hover:bg-black/[0.045] hover:text-[var(--foreground)] dark:hover:bg-white/[0.05]"
      }`}
    >
      {/* Symbol carries the hue. Muted when idle so it accents rather than
          shouts; full strength once active or hovered. */}
      <Icon
        className="shrink-0 opacity-80 transition-opacity group-hover:opacity-100"
        style={{ color, opacity: active ? 1 : undefined }}
      />
      {!collapsed && <span className="flex-1 truncate text-left">{label}</span>}
      {dot && (
        <span
          className={`h-2 w-2 shrink-0 rounded-full bg-red-500 ${
            collapsed ? "absolute right-1.5 top-1.5" : "ml-auto"
          }`}
          aria-label="failed sends"
        />
      )}
    </button>
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

  // Read on mount, not during render: the server has no localStorage, so
  // seeding state from it directly would hydrate-mismatch. One frame expanded
  // is cheaper than a hydration error.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });

  // The org's language is the app's language — set in Settings, nowhere else.
  const orgLanguage = settings?.org.language;
  useEffect(() => {
    if (isLanguage(orgLanguage) && orgLanguage !== language) setLanguage(orgLanguage);
  }, [orgLanguage, language, setLanguage]);

  if (settings && settings.org.name === "") return <OnboardingGate />;

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[var(--pane)] md:p-2 md:gap-2">
      {/* Sidebar: recessed pane, hidden on phones (bottom nav takes over). */}
      <aside
        aria-label="Primary navigation"
        className={`app-pane hidden shrink-0 flex-col overflow-hidden transition-[width] duration-200 md:flex ${
          collapsed ? "w-14" : "w-52"
        }`}
      >
        {/* Brand row. The mark stays put across the collapse so the eye has a
            fixed anchor; the name and the switcher are what fold away. */}
        <div
          className={`flex items-center gap-2 pt-3 ${
            collapsed ? "flex-col gap-1 px-1 pb-1" : "px-2 pb-2"
          }`}
        >
          {collapsed ? (
            <WorkspaceSwitcher fallbackName={settings?.org.name} collapsed />
          ) : (
            <>
              <BrandMark size={26} />
              <div className="min-w-0 flex-1">
                <WorkspaceSwitcher fallbackName={settings?.org.name} />
              </div>
            </>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
            title={collapsed ? t("nav.expand") : t("nav.collapse")}
            className="rounded p-0.5 text-[var(--muted)] transition-colors hover:bg-black/[0.045] hover:text-[var(--foreground)] dark:hover:bg-white/[0.05]"
          >
            {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </button>
        </div>

        <nav className={`flex flex-1 flex-col py-1 ${collapsed ? "px-1" : "px-2"}`}>
          <div className="space-y-0.5">
            {NAV_TABS.map((entry) => (
              <SidebarButton
                key={entry.id}
                entry={entry}
                active={tab === entry.id}
                collapsed={collapsed}
                dot={entry.id === "inbox" && (failedCount ?? 0) > 0}
                onClick={() => onTab(entry.id)}
              />
            ))}
          </div>
          {/* Config closes the nav, under a hairline. */}
          <div className="mt-auto space-y-0.5 border-t border-[var(--border)] pt-1.5">
            {FOOT_TABS.map((entry) => (
              <SidebarButton
                key={entry.id}
                entry={entry}
                active={tab === entry.id}
                collapsed={collapsed}
                onClick={() => onTab(entry.id)}
              />
            ))}
          </div>
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
          {NAV_TABS.map(({ id, key, Icon, color }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => onTab(id)}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 flex-col items-center gap-0.5 px-2 py-2 text-[11px] ${
                  active
                    ? "font-semibold text-[var(--foreground)]"
                    : "text-[var(--muted)]"
                }`}
              >
                <Icon
                  className="shrink-0"
                  style={{ color, opacity: active ? 1 : 0.8 }}
                />
                {t(key)}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
