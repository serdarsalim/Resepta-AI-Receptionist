# Design language

Derived in Resepta (randevu) on 2026-08-14, against Meta's WhatsApp Manager as
the reference. Applies to Resepta and Nudge, which share a token structure —
Resepta's was ported from Nudge, and this document sends the improvements back.

Read this before changing a colour, a border, or a card. The values matter
less than the reasons; the reasons are what stop the next session re-deciding.

## The one idea: plane and paper

Everything follows from a single relationship. The page is a **plane** with a
faint wash across it. Content sits on it as **paper** — white cards that are
*lifted*, never *outlined*.

That is the whole system. A surface is either the plane or paper on it, and
almost every rule below is a consequence.

## Tokens

Light, then dark. All in `src/app/globals.css`.

| Token | Light | Dark |
|---|---|---|
| `--table-header-fg` | `#1c2b33` | `#ededed` |
| `--table-divider` | `#e4e6eb` | `#2e2e2e` |
| `--row-hover-bg` | `#f5f6f7` | `#202020` |
| `--card-shadow` | `0 1px 2px /.04`, `0 3px 10px /.05` | `0 0 0 1px var(--border)` |
| `--content-bg` | `linear-gradient(140deg, accent 7% → pane 48% → brand 8%)` | same at 4% |
| `--bubble-shadow` | `0 1px 0.5px rgba(11,20,26,.13)` | `0 1px 0.5px rgba(0,0,0,.4)` |
| `--thread-bg` | `#f4f4f5` | `#101010` |

Two things about these worth keeping.

**The table tokens are literal hex, not `color-mix` of `--brand`.** That is
deliberate. They used to be brand mixes, and the table inherited every brand
decision by accident. Tune these three lines and every table in the app
follows; nothing else has to change.

**`--card-shadow` is one property doing two different jobs.** In light mode it
is a real shadow. In dark mode a shadow on `#0a0a0a` is nothing at all, so the
token becomes a hairline ring instead. Call sites never know the difference —
they just apply `shadow-[var(--card-shadow)]`.

## Rules

### Cards are lifted, not outlined

No border. `rounded-lg` (8px). `shadow-[var(--card-shadow)]`.

The radius and the border go together. Dropping the 1px line is what softens
the corners — a line makes a curve explicit in a way a shadow never does — so
`rounded-xl` behind a shadow reads as a pill. If you put a border back, put
the larger radius back with it.

The shadow needs a wide low-opacity layer, not just tight ones. A downward
drop puts nothing at the top and left corners, so a card with only tight
layers meets the plane at a hard line, which is the opposite of the intent.

A three-layer version with a `0 0 0 1px /.03` spread ring was tried and backed
out: the ring gives the edge definition, which is the thing the reference
deliberately does not do.

### Tables: the header carries no fill

The header is separated from the body by **weight and one rule**, nothing else.
`font-semibold`, `--table-header-fg`, `border-bottom: 1px solid
--table-divider` on `thead`.

Set on `thead`, not on each `th`, so a header that wraps to two lines still
draws one continuous line.

What this replaced: an 8%-of-brand mint band. It was the only place the brand
green appeared as a large fill, and since every *action* wears `--accent` blue,
the first thing the eye landed on was the one colour that never means "do
something".

**Row rules stop short of the card edge.** They are drawn by the table, so they
can only ever run its full width — the way to inset them is to make the table
narrower than the card. Put the horizontal padding on the scroll container
(`px-4`), not on the card, and drop cell padding a step (`px-3`) in exchange so
the first column lands where it did.

**Row hover is neutral grey**, not a brand tint. Selection may still be
branded — selection is a state worth colouring; hovering is not.

### The primary action sits top right of the card it acts on (2026-08-21)

A solid `--accent` button, no `+` in the label. **Inside** the card, hard right
on its title line — `Card` takes an `action` node for exactly this. Never a
ghost "+ Add thing" at the foot of the list, which puts the primary action
below however many rows the data happens to have and loses it entirely in the
empty state, where you need it most.

Two tiers, and they are different jobs:

- A **card's** own primary action: filled, no `+`, in the card header.
- A **section's** action inside a card: outlined, keeps its `+`. The contact
  record's "+ Add appointment" is the reference — filling it would make it the
  loudest thing on the page, competing with the page's real primary, and it
  sits directly above a blue disclosure link it must not be confused with.

A card that IS the page keeps a toolbar row instead of a card header
(Customers, Voice agent) — same visual corner, but a page-level table's
controls are a toolbar, and a `DataTable` has no header slot to put them in.
Move that row inside the card's own padding, and gate the card on LOADED
rather than on having rows, or the button disappears exactly when a new
workspace needs it.

> This supersedes the original "above the card, right-aligned" rule. Above the
> card put the action on the page rather than on the thing it acts on, and it
> read as page chrome; the corner is the same, the ownership is not.

Adding something opens a **sheet**, never an inline form that unfolds at the
bottom of a list. An empty field parked in a list is a question the page asks
nobody, and it costs vertical space on every visit to pay for a task done a few
times a year.

### A section names itself on the page; a card holds content

Where a page stacks several labelled sections, the heading (`h2` + its
`InfoTip`) sits on the page ground and the card below holds only content.
A section that keeps its title inside its card reads as a box you have to open
to identify, while its neighbours announce themselves.

### Colour means one thing at a time

Emerald is ON — every toggle in the app already said so. Amber is UNSAVED, and
only that. Violet is a PIN: mine, a debt I created and only I can clear.
`--brand` green means "something new is in there". `--accent` blue means "do
something", `--now-line` red means "now", `--event` lavender means a booking.

Before reaching for a hue, check what it already says on that surface. Amber
once meant unsaved, selected-day and active-channel at once, with two
same-size amber pills on one row meaning a warning and a steady state.

### The shell header has a floor

`min-h-13`. Without it the header is as tall as whatever it holds — ~55px on a
tab with a search box, ~42px on one without — so switching tabs jumps every
card up or down the screen. The floor is the search box's own height plus the
header padding, so tabs that have one are unchanged and the rest stop shifting.

Verify by measuring, not by eye: every tab's first row should report the same
`getBoundingClientRect().top`.

### Chat

Bubbles carry **one hairline shadow and no border**. Ours had a full 1px border
*and* Tailwind's `shadow-sm`, so every incoming bubble drew its edge twice.

That only works if the ground steps back. A white bubble on a white card is
invisible without a line around it, which is why `--thread-bg` exists — the
flat, neutral version of what WhatsApp does with its beige pattern. Only the
scroll area wears it; the contact header above and the composer below share it
too, because a white composer under a tinted thread puts a hard seam exactly
where the conversation ends. The input pill goes the other way, to white: on a
tinted strip the one thing you put a cursor into should be what stands out.

Bubbles are `w-fit`, not blocks. As plain blocks they fill their `max-w`
whatever they hold, so a two-word reply and a paragraph are the same width and
the column reads as a wall.

The timestamp sits **beside the last line** (`flex items-end`), never on a line
of its own underneath — that made every bubble a line taller than its content.

### The calendar is a card, not an exception

The grid sits on the plane like everything else. Inside it, nothing changed:
white paper, closed hours shaded on top, every hour line drawn over that.

Painting only the *open* hours white and letting the plane show through closed
time was tried and reverted — the white band is an overlay, so it buried the
hour lines it was laid over and the grid lost its ruler.

### Events wear lavender, and only events do (2026-08-19)

`--event` (`#7c5cf0` light / `#8b6ef5` dark) with `--event-soft`,
`--event-past`, `--event-past-fg` derived beside it. A third hue on purpose:
`--brand` green means the product, `--accent` blue means "do something", so
bookings needed a colour that means neither. Tense outranks status — an
upcoming booking is the solid with white text, a finished one the pale wash,
decided by its end against the live clock. The now-line is `--now-line` red,
Google's red, and red there means only "now"; today's circles are `--accent`.

## What we deliberately did not take from the reference

- **Its exact palette.** Meta's blue-grey system on a gradient page. Lifting
  the hex values gives a Meta-flavoured app, not a better one. `--content-bg`
  runs `--accent` → `--brand` instead, which lands in nearly the same place
  because their lavender is blue-tinted and their mint is green.
- **The patterned chat background.** Consumer messenger, not business grade.
- **Two-line table rows.** Right for eight columns of metrics, wrong for five
  columns of short values.
- **Auto-hiding empty columns.** There is a column picker; the user decides.

The reference has real problems of its own — truncated status text, five
columns showing `--`, four filter dropdowns where one would do. It is a
reference, not a target.

## The operator console is not an exception

`/admin` runs the same system as the salon app, ported 2026-08-15. It has no
`AppShell`, so the plane goes on the page root instead (`parts.tsx`'s `Plane`):
`bg-[image:var(--content-bg)]` plus **`bg-fixed`**, which is load-bearing here
and not in the salon app. A gradient restarts inside whatever box draws it, and
this route scrolls the document rather than a pane, so without `bg-fixed` the
wash slides out from under the cards as you scroll.

Two calls worth keeping:

**The fleet table keeps full-bleed rules.** Nine columns you track across to the
last cell make each rule a reading rail. The inset gutter is for the four-column
case (Customers). Same language, opposite call, decided by column count.

**Every state wears the plane, loading included.** A bare `Loading…` painted flat
white until the query landed and then washed over, which reads as arriving in a
different app for as long as the round trip takes.

## Porting this to another app

Both apps share the token structure, so the order is:

1. Retire `--table-header-bg`. Add `--table-header-fg` and `--table-divider`.
   Move `--row-hover-bg` off the brand mix. Grep for the old token — it is
   usually also hardcoded on `thead` elements as a Tailwind class.
2. Add `--card-shadow` and `--content-bg`, both modes.
3. Swap the global `thead` rule from `background-color` to `color` +
   `border-bottom`. Remove per-table `text-[var(--muted-strong)]` overrides
   that would fight it.
4. Card component: border out, shadow in, `rounded-xl` → `rounded-lg`. Then
   sweep for hand-rolled cards still wearing
   `rounded-xl border border-[var(--border)]`.
5. Inset the table rules (container padding, cell padding down a step).
6. Header floor on the shell.
7. Chat surfaces last, if the app has any.

Check dark mode at every step. It is where a shadow-based system quietly
fails.
