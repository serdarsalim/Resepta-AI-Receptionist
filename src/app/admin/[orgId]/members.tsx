"use client";

// Who can sign in to one business, and the operator's ability to change it.
//
// This card used to be a read-only list, which meant "add my new receptionist"
// — a request that arrives by WhatsApp, not through the app — was answered by
// signing into the client's own workspace and using their Team card. The
// writes behind this are convex/platform.ts, which runs the same lib/members
// code the salon's own card does; only the gate differs.
//
// The words are the CLIENT'S words. Admin and Member are what role.owner and
// role.staff render as in every language of the tenant app, so an operator on
// a support call and the person they are talking to are describing the same
// two tiers. The raw owner/staff tokens never reach this screen.

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CopyId, Section } from "../parts";

type Role = "owner" | "staff";

const ROLE_LABEL: Record<Role, string> = { owner: "Admin", staff: "Member" };

const SELECT_CLASS =
  "rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function errorText(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Convex prefixes a thrown Error with its own framing; the useful part is
  // the code the mutation actually threw, and these five are the ones a person
  // standing here can do something about.
  if (raw.includes("last-admin")) {
    return "That is the last admin. Make somebody else an admin first.";
  }
  if (raw.includes("already-member")) return "They are already in this business.";
  if (raw.includes("already-invited")) return "There is already an open invite for that address.";
  if (raw.includes("bad-email")) return "That is not an email address.";
  if (raw.includes("demo-workspace")) return "The demo workspace does not take members.";
  return fallback;
}

function relative(ms: number): string {
  const days = Math.round((ms - Date.now()) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

export function MembersCard({
  orgId,
  members,
  pendingInvites,
}: {
  orgId: Id<"orgs">;
  members: {
    userId: Id<"users">;
    name: string | null;
    email: string | null;
    role: string;
    seenAt: number | null;
  }[];
  pendingInvites: {
    _id: Id<"invites">;
    email: string;
    role: string;
    invitedAt: number;
    expiresAt: number | null;
  }[];
}) {
  const addOrgMember = useMutation(api.platform.addOrgMember);
  const setOrgMemberRole = useMutation(api.platform.setOrgMemberRole);
  const removeOrgMember = useMutation(api.platform.removeOrgMember);
  const revokeOrgInvite = useMutation(api.platform.revokeOrgInvite);

  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [busy, setBusy] = useState(false);
  // The form's own error, shown inside the form next to the field that caused
  // it. Kept apart from `notice` so a failed Add does not clear the line
  // telling you the last person was invited.
  const [error, setError] = useState<string | null>(null);
  // What just happened to the LIST, and how it went. One state carrying its
  // own tone: an outcome and a failure are the same slot on the page, and a
  // separate success-only box means the first refused role change paints
  // itself green.
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // Which row is mid-removal. A two-press confirm rather than window.confirm,
  // whose sheet is titled with the ORIGIN and reads as the browser warning you
  // about the site you are on.
  const [confirming, setConfirming] = useState<string | null>(null);

  // Only while the form is open. This is a bounded SCAN of the users table —
  // no reason to run it for every operator who opens a business to read its
  // WhatsApp credentials.
  const candidates = useQuery(
    api.platform.orgMemberCandidates,
    adding ? { orgId, query } : "skip",
  );

  const typed = query.trim().toLowerCase();
  const people = candidates?.people ?? [];
  // What the button will actually DO, said on the button. An address already
  // holding an account joins outright and can sign in a second later; one with
  // no account behind it gets a mailed token and nothing happens until they
  // use it. Those are different enough that the control should not call both
  // of them "Add".
  const match = people.find((person) => person.email.toLowerCase() === typed);
  const canInvite = EMAIL_RE.test(typed) && !match;
  const submitLabel = match ? "Add" : "Invite";

  function reset() {
    setAdding(false);
    setQuery("");
    setRole("staff");
    setError(null);
  }

  function submit(email: string, asRole: Role) {
    setBusy(true);
    setError(null);
    setNotice(null);
    void addOrgMember({ orgId, email, role: asRole })
      .then((outcome) => {
        setNotice({
          ok: true,
          text:
            outcome === "joined"
              ? `${email} was added. They can sign in now.`
              : `${email} has no account yet — invite mailed, good for 14 days.`,
        });
        reset();
      })
      .catch((err: unknown) => setError(errorText(err, "Could not add them.")))
      .finally(() => setBusy(false));
  }

  return (
    <Section
      title="Members"
      description="Who can sign in to this business. Sign-in is Google-only, so the address here is the only one that works, and there is no way to look it up from the other side. Adding somebody who already has an account puts them in straight away; a new address is mailed a link instead."
      action={
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            setAdding((was) => !was);
          }}
          className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-[var(--row-hover-bg)]"
        >
          {adding ? "Cancel" : "Add member"}
        </button>
      }
    >
      {adding && (
        <div className="mb-2 rounded-lg bg-[var(--muted-bg)] p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setError(null);
              }}
              placeholder="Name or email address"
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs"
            />
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
              className={SELECT_CLASS}
            >
              <option value="staff">Member</option>
              <option value="owner">Admin</option>
            </select>
            <button
              type="button"
              disabled={busy || (!match && !canInvite)}
              onClick={() => submit(match ? match.email : typed, role)}
              className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
            >
              {busy ? "Working…" : submitLabel}
            </button>
          </div>

          {/* The existing-account pool. Most people being added already have a
              login from another business, and picking them beats retyping an
              address that can be got wrong by one character. */}
          {people.length > 0 && (
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg bg-[var(--card)]">
              {people.map((person) => (
                <button
                  key={person.userId}
                  type="button"
                  disabled={busy}
                  onClick={() => submit(person.email, role)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-[var(--row-hover-bg)] disabled:pointer-events-none disabled:opacity-40"
                >
                  <span className="font-medium">{person.name ?? person.email}</span>
                  {person.name && (
                    <span className="text-[var(--muted)]">{person.email}</span>
                  )}
                  {/* A bare address cannot tell a client's own staff from a
                      stranger with a similar name. This is the fact that can. */}
                  {person.alreadyIn.length > 0 && (
                    <span className="ml-auto shrink-0 pl-2 text-[var(--muted)]">
                      in {person.alreadyIn.join(", ")}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {candidates?.capped && (
            <p className="mt-1.5 text-[11px] text-[var(--muted)]">
              More accounts match than are shown. Keep typing to narrow it.
            </p>
          )}

          {!match && !canInvite && typed.length > 0 && people.length === 0 && (
            <p className="mt-1.5 text-[11px] text-[var(--muted)]">
              No account matches. Type the full email address to invite them.
            </p>
          )}

          {error && (
            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">{error}</p>
          )}
        </div>
      )}

      {notice && (
        <p
          className={`mb-2 rounded-lg px-2 py-1.5 text-xs ${
            notice.ok
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
              : "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
          }`}
        >
          {notice.text}
        </p>
      )}

      {members.length === 0 ? (
        <p className="py-2.5 text-xs text-[var(--muted)]">Nobody has signed in yet.</p>
      ) : (
        members.map((member) => {
          const key = member.userId as string;
          return (
            <div
              key={key}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
            >
              <span className="text-sm font-medium">
                {member.name ?? <span className="text-[var(--muted)]">No name</span>}
              </span>
              {member.email ? (
                <CopyId value={member.email} />
              ) : (
                <span className="text-xs text-[var(--muted)]">No address</span>
              )}
              <span className="ml-auto flex items-center gap-2">
                {/* Unset seenAt means somebody else added them and they have
                    not signed in to find out — a seat, not yet a user. */}
                {member.seenAt === null && (
                  <span className="text-xs text-[var(--muted)]">Never signed in</span>
                )}
                {confirming === key ? (
                  <>
                    <span className="text-xs text-[var(--muted)]">Remove access?</span>
                    <button
                      type="button"
                      onClick={() => {
                        setNotice(null);
                        setConfirming(null);
                        void removeOrgMember({ orgId, userId: member.userId }).catch(
                          (err: unknown) =>
                            setNotice({
                              ok: false,
                              text: errorText(err, "Could not remove them."),
                            }),
                        );
                      }}
                      className="rounded-lg border border-red-500/40 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="text-xs text-[var(--muted)] hover:underline"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <select
                      value={member.role}
                      onChange={(event) => {
                        setNotice(null);
                        void setOrgMemberRole({
                          orgId,
                          userId: member.userId,
                          role: event.target.value as Role,
                        }).catch((err: unknown) =>
                          setNotice({
                            ok: false,
                            text: errorText(err, "Could not change their tier."),
                          }),
                        );
                      }}
                      className={SELECT_CLASS}
                    >
                      <option value="owner">{ROLE_LABEL.owner}</option>
                      <option value="staff">{ROLE_LABEL.staff}</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setConfirming(key)}
                      title="Remove access"
                      className="rounded-md px-1.5 py-0.5 text-xs text-[var(--muted)] hover:bg-[var(--row-hover-bg)] hover:text-red-600 dark:hover:text-red-400"
                    >
                      ✕
                    </button>
                  </>
                )}
              </span>
            </div>
          );
        })
      )}

      {/* Not members, and not drawn as one: nobody holds these seats until the
          mailed token is used. Leaving them out entirely is how the same person
          gets added twice and nobody works out why nothing arrived. */}
      {pendingInvites.length > 0 && (
        <div className="mt-2 border-t border-[var(--border)] pt-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-strong)]">
            Invited, not yet accepted
          </p>
          {pendingInvites.map((invite) => (
            <div key={invite._id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
              <span className="text-xs">{invite.email}</span>
              <span className="text-xs text-[var(--muted)]">
                {ROLE_LABEL[invite.role as Role] ?? invite.role}
                {invite.expiresAt !== null && ` · expires in ${relative(invite.expiresAt)}`}
              </span>
              <button
                type="button"
                onClick={() => {
                  setNotice(null);
                  void revokeOrgInvite({ orgId, inviteId: invite._id }).catch(
                    (err: unknown) =>
                      setNotice({
                        ok: false,
                        text: errorText(err, "Could not revoke the invite."),
                      }),
                  );
                }}
                className="ml-auto text-xs text-[var(--muted)] hover:text-red-600 hover:underline dark:hover:text-red-400"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
