// The words the phone line's speech recogniser should expect: the business's
// own name, the people who work there and the services it sells, set on the
// agent as the provider's boosted_keywords whenever Resepta publishes it
// (Nudge 3379705e, 61788709). A line hears "Keratin bakımı" or "Gökçe" far more
// reliably when it has been told those words exist, and a misheard service or
// name is a booking for the wrong thing.
//
// A LEAF: imports nothing, so retell.ts (which reads the org's rows) and
// retellAgent.ts (which publishes) can both use it.
//
// DERIVED, never edited. Nudge keeps an editable list per knowledge base;
// Resepta already holds the vocabulary as org data, so the list is computed at
// publish from the rows the owner maintains anyway, and a renamed service
// reaches the recogniser the next time anything about the agent is published.
// Only this org's rows: agentEditorContext reads them by orgId after proving
// the agent is the org's, because one provider account carries every
// business's agents and another salon's staff names on this line would be a
// leak and a mishearing at once.
//
// OURS REPLACES OURS, THEIRS SURVIVES. The provider's list may also hold words
// somebody typed into its dashboard. Resepta remembers which words it put
// there (retellAgents.boostedKeywords) and replaces only those, the bargain
// syncTemplate already strikes for the analysis fields and the voicemail
// detection prompt. Before the first such publish nothing is remembered, so
// every word the agent already carries is kept: Nudge's first build would
// have published an empty list over fifty place names (61788709). A merged
// list that comes out empty is never sent at all.

// Fifty, under the sixty-one Nudge runs in production on one agent. The
// provider documents no ceiling, and a list it refused would fail the whole
// publish (the owner's prompt save included), so the cap stays inside what has
// been seen to work. Who comes first decides who survives it: words somebody
// else placed (few, and deliberate), then the business, its team, its
// services.
export const MAX_BOOSTED_KEYWORDS = 50;

// A recogniser hint is a name or a short phrase. A forty-word service title is
// neither, and is left out rather than cut.
const MAX_KEYWORD_LENGTH = 50;

// Case, accents and the Turkish dotless i folded, for telling two spellings of
// one word apart ("Saç kesimi" and "SAÇ KESİMİ"); never for what is sent.
function fold(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/\s+/g, " ")
    .trim();
}

// First spelling wins, blanks and over-long entries dropped, capped.
function dedupe(words: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of words) {
    const word = raw.replace(/\s+/g, " ").trim();
    const key = fold(word);
    if (!key || word.length > MAX_KEYWORD_LENGTH || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length === MAX_BOOSTED_KEYWORDS) break;
  }
  return out;
}

type Ordered = { name: string; active: boolean; order?: number };

function inOrder(rows: readonly Ordered[]): string[] {
  return rows
    .filter((row) => row.active)
    .sort((a, b) => {
      // Unset order sorts after set order, alphabetically: the services
      // table's own rule (schema services.order).
      const ao = a.order ?? Number.POSITIVE_INFINITY;
      const bo = b.order ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao < bo ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((row) => row.name);
}

/** This org's words, as of now: its name, then its active team and active
 *  services in the order the owner sorted them. */
export function orgKeywords(args: {
  businessName: string;
  staff: readonly Ordered[];
  services: readonly Ordered[];
}): string[] {
  return dedupe([args.businessName, ...inOrder(args.staff), ...inOrder(args.services)]);
}

/** The list to publish: words somebody else placed on the agent, then ours.
 *  `previous` is what Resepta published last time (null: never), and only
 *  those words are treated as ours to replace. Null means send nothing, so an
 *  agent's list is never overwritten with an empty one. */
export function mergeBoostedKeywords(args: {
  live: unknown;
  ours: readonly string[];
  previous: readonly string[] | null;
}): string[] | null {
  const mine = new Set((args.previous ?? []).map(fold));
  const theirs = (Array.isArray(args.live) ? args.live : []).filter(
    (word): word is string => typeof word === "string" && !mine.has(fold(word)),
  );
  const next = dedupe([...theirs, ...args.ours]);
  return next.length > 0 ? next : null;
}
