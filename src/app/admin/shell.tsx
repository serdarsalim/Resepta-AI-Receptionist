"use client";

// The operator console's frame, Nudge admin's shape (autonudge/admin
// AppShell): a flush rail with the sections and the signed-in person at its
// foot, the workspace beside it. It replaced a title row plus an underline
// tab strip, which made four rooms of one console read as four views of one
// table (Serdar, 2026-10-27: "similar to the UI that we have for nudge").
//
// The sections stay one route (/admin?tab=…), as they were: the business page
// lives at /admin/<id> and lights Businesses, and the rail sends it back to a
// section with a push. The shell draws only for an operator; anyone else gets
// the page's own 404 with no frame around it.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { UserMenu } from "@/components/AppShell";
import { BrandMark } from "@/components/BrandMark";

export type AdminSection = "businesses" | "onboarding" | "templates" | "platform";

const SECTIONS: { id: AdminSection; label: string; icon: React.ReactNode }[] = [
  { id: "businesses", label: "Businesses", icon: <BusinessesIcon /> },
  { id: "onboarding", label: "Onboarding", icon: <OnboardingIcon /> },
  { id: "templates", label: "Templates", icon: <TemplatesIcon /> },
  { id: "platform", label: "Platform", icon: <PlatformIcon /> },
];

export function sectionLabel(id: AdminSection): string {
  return SECTIONS.find((s) => s.id === id)!.label;
}

function hrefFor(id: AdminSection): string {
  return id === "businesses" ? "/admin" : `/admin?tab=${id}`;
}

const SectionContext = createContext<{
  section: AdminSection;
  setSection: (next: AdminSection) => void;
} | null>(null);

export function useAdminSection() {
  const ctx = useContext(SectionContext);
  if (!ctx) throw new Error("useAdminSection outside AdminShell");
  return ctx;
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/admin";
  const router = useRouter();
  const allowed = useQuery(api.platform.amPlatformAdmin, {});
  const onList = pathname === "/admin";

  // The tab rides the URL so a refresh lands where it was (2026-08-28). Read
  // once on mount, written with replaceState: useSearchParams would demand a
  // Suspense boundary around the whole console for one string. Only on the
  // list: the business page has a ?tab of its own.
  const [section, setSectionState] = useState<AdminSection>("businesses");
  useEffect(() => {
    if (!onList) return;
    const raw = new URLSearchParams(window.location.search).get("tab");
    if (raw === "onboarding" || raw === "templates" || raw === "platform") {
      setSectionState(raw);
    }
  }, [onList]);
  const setSection = useCallback(
    (next: AdminSection) => {
      setSectionState(next);
      if (window.location.pathname === "/admin") {
        window.history.replaceState(null, "", hrefFor(next));
      } else {
        router.push(hrefFor(next));
      }
    },
    [router],
  );

  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [pathname, section]);

  // Still asking: the empty frame, so the console never paints as a bare
  // white page first and then grows a rail.
  if (allowed === undefined) return <div className="app-pane h-dvh" />;
  if (!allowed) {
    return (
      <SectionContext.Provider value={{ section, setSection }}>
        {children}
      </SectionContext.Provider>
    );
  }

  // On a business's page the rail lights Businesses: that is where it lives.
  const lit: AdminSection = onList ? section : "businesses";

  return (
    <SectionContext.Provider value={{ section, setSection }}>
      <div className="app-pane flex h-dvh overflow-hidden">
        {/* Phone: a bar opens the same rail as a drawer. */}
        <div className="app-pane fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-2 px-3 md:hidden">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Open menu"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted-strong)] hover:bg-[var(--control-hover)] hover:text-[var(--foreground)]"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE} aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <Brand />
        </div>
        {drawer && (
          <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={() => setDrawer(false)} />
        )}

        <aside
          className={`app-pane fixed inset-y-0 left-0 z-50 flex w-56 shrink-0 flex-col transition-transform md:static md:z-auto md:translate-x-0 ${
            drawer ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex h-14 items-center px-4">
            <Brand />
          </div>
          <nav className="flex flex-col gap-0.5 px-2">
            {SECTIONS.map((item) => {
              const active = lit === item.id;
              return (
                <Link
                  key={item.id}
                  href={hrefFor(item.id)}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                    e.preventDefault();
                    setSection(item.id);
                  }}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-[var(--row-active-bg)] text-[var(--foreground)]"
                      : "text-[var(--muted-strong)] hover:bg-[var(--control-hover)] hover:text-[var(--foreground)]"
                  }`}
                >
                  <span className={active ? "" : "opacity-80"}>{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto p-2">
            <Account />
          </div>
        </aside>

        <div className="relative flex min-w-0 flex-1 flex-col overflow-y-auto bg-[image:var(--content-bg)] bg-fixed pt-12 md:pt-0 page-scroll thin-scroll">
          {children}
        </div>
      </div>
    </SectionContext.Provider>
  );
}

function Account() {
  // The operator always has an org (their own, or the one they act as), so
  // the salon shell's own read gives the name, photo and theme preference.
  const current = useQuery(api.orgs.current, {});
  const me = current?.me;
  return (
    <UserMenu
      variant="row"
      name={me?.name}
      email={me?.email}
      image={me?.image}
      remoteTheme={me?.themePreference}
    />
  );
}

function Brand() {
  return (
    <span className="flex items-center gap-2">
      <BrandMark small />
      <span className="text-[15px] font-bold tracking-tight">resepta admin</span>
    </span>
  );
}

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" className="shrink-0" {...STROKE} aria-hidden>
      {children}
    </svg>
  );
}

function BusinessesIcon() {
  return (
    <Glyph>
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
    </Glyph>
  );
}

function OnboardingIcon() {
  return (
    <Glyph>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </Glyph>
  );
}

function TemplatesIcon() {
  return (
    <Glyph>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 9h8M8 13h5" />
    </Glyph>
  );
}

function PlatformIcon() {
  return (
    <Glyph>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1 14h6M9 8h6M17 16h6" />
    </Glyph>
  );
}
