"use client";

// The feed's filter row, shared by the inbox and the contact page. One
// implementation on purpose: these pills decide what a row in the feed even is,
// and two copies drifting apart is how a channel ends up filterable in one
// place and invisible in the other.
//
// These belong in the PAGE HEADER, on the same line as the contact's name —
// never in a band above the conversation card. A band pushes the right card
// down and the two panes stop starting on the same line (Nudge's rule).

import { filterPillClass } from "./filterPill";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { FeedIcon, CHANNELS, type Channel } from "./FeedIcon";
import { HoverTip } from "./HoverTip";
import type { FeedFilter } from "./ConversationPanel";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";

export const CHANNEL_LABEL: Record<Channel, TranslationKey> = {
  whatsapp: "channel.whatsapp",
  email: "channel.email",
  call: "channel.call",
};

// Channels first, then the two things that are not channels — a form arrival
// and a note.
//
// "all" is not among them and has no pill (Serdar, 2026-08-18). It used to sit
// past a rule as the way back out, which made five controls in a header whose
// thread often holds one message, and spent the widest pill in the row saying
// "no filter". The way back out is now the open pill itself: picking it again
// clears it, which is what every other filter chip in the world does. The
// STATE stays — the panel composes and restores scroll against it — only the
// button is gone.
type FeedTab = Exclude<FeedFilter, "all">;
const TABS: readonly FeedTab[] = [...CHANNELS, "form", "note"];

export function FeedFilterPills({
  customerId,
  value,
  onChange,
  className,
}: {
  customerId: Id<"customers">;
  value: FeedFilter;
  onChange: (next: FeedFilter) => void;
  className?: string;
}) {
  const { t } = useLanguage();
  // The same query the panel runs, so Convex serves both from one subscription
  // rather than a counts callback threaded back up through the parent.
  const feed = useQuery(api.messages.feedForCustomer, { customerId });
  // WhatsApp shows whether or not a number is connected (Serdar, 2026-08-17).
  //
  // It used to hide until connected, on the grounds that an org with no number
  // has no WhatsApp history and no way to make any — a permanently empty tab
  // advertising a channel it does not have. That reasoning contradicted the one
  // two paragraphs down, which is the right one: an empty Call or Email tab
  // means "we haven't yet", and the tab is a STANDING OFFER. WhatsApp is a
  // standing offer too — connecting a number is a thing the owner can go and
  // do, and a channel hidden until it works is a channel nobody discovers.
  //
  // The tab is not a dead end either. Its composer says the number is missing
  // instead of offering a Send that fails (ConversationPanel), which is what
  // hiding the pill was really protecting against.
  const countOf = (tab: FeedTab) =>
    (feed ?? []).filter((item) => item.channel === tab).length;

  // Form hides when this customer has never sent one, which is the same
  // judgement as WhatsApp's above reached from the other direction. An empty
  // Call or Email tab means "we haven't yet" — those are ways to REACH this
  // person, and the tab is a standing offer. The form is not: it is a link a
  // stranger either used or didn't, and there is no action on this page that
  // fills it. So on a customer who phoned, an empty Form tab advertises
  // something that will never arrive for them.
  //
  // Notes stays visible at zero on the same test — you can write one from
  // there, so the empty tab is a place to do something, not a dead end.
  //
  // Kept while it is the open tab, or the pills would renumber under someone
  // who is looking at them.
  const hasForm = countOf("form") > 0 || value === "form";
  const tabs = TABS.filter((tab) => tab !== "form" || hasForm);

  const pill = (tab: FeedTab) => {
    const count = countOf(tab);
    const active = value === tab;
    const label =
      tab === "note"
        ? t("notes.title")
        : tab === "form"
          ? t("forms.title")
          : t(CHANNEL_LABEL[tab]);
    return (
      // The word left the pill, so the name has to live somewhere a mouse can
      // reach: aria-label covers the screen reader, the hover label everyone
      // else, at once and in the app's one tooltip look (P20).
      <HoverTip key={tab} text={label}>
      <button
        type="button"
        // Picking the open one clears it. This is the only route back to the
        // merged feed now, and it has to keep working: the composer is live on
        // "all" and dead on Call and Form (ConversationPanel), so a thread you
        // could not unfilter would be a thread you could not reply to.
        onClick={() => onChange(active ? "all" : tab)}
        aria-label={label}
        aria-pressed={active}
        // text-sm and the glyph at 15: the pills sit beside the conversation's
        // name and were reading a size below everything around them. 28px
        // tall, inside the fixed h-9 header track.
        // The shared filter pill since P21 (filterPill.ts): selected is an
        // accent fill, not an accent outline with semibold ink, and the
        // height is fixed at the 28px py-1 used to give. A channel with
        // nothing in it yet is still a live control (it opens the composer
        // for that channel), so it is not greyed out (P12, Nudge 1a1b00dd:
        // "no dimmed pills"). The count already says there is nothing there.
        className={filterPillClass(active)}
      >
        {/* Every pill with a mark is its mark and its count, nothing else
            (Serdar's call, 2026-08-17). Notes and Form used to carry their word
            on the theory that a bare pencil among channel glyphs reads as "edit
            this contact" — but four words across this row was most of the header
            spent labelling controls whose marks the reader already knows, and it
            made the pills renumber sideways every time one was picked. The name
            is on the tooltip and the aria-label. */}
        {/* Tinted in every state, open one included: the glyph's colour is how
            you find the channel, and dropping it to accent on select means the
            pill you're looking at is the one that stopped being recognizable. */}
        <FeedIcon type={tab} size={15} />
        {/* Zero renders nothing. A row of noughts is noise, and the dimmed
            pill already says the tab is empty. */}
        {/* leading-none, or the count sets the pill's height: text-sm's 20px
            line box outgrows the 15px glyph, so a pill that gained a digit
            stood 5px taller than its neighbours and closed the gap to the
            card under the row. With the line box pinned the glyph governs
            every pill, counted or not. */}
        {count > 0 && <span className="leading-none tabular-nums">{count}</span>}
      </button>
      </HoverTip>
    );
  };

  return (
    // No wrap: the inbox header is a fixed h-9 track (it exists to line the two
    // cards up), so a second row of pills would spill out of it rather than
    // push the card down. The pills are small enough to hold one line.
    <div className={`flex shrink-0 flex-nowrap items-center gap-1.5 ${className ?? ""}`}>
      {tabs.map(pill)}
    </div>
  );
}
