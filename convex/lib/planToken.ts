// The preview→commit binding used by the MCP surface. Not a security token —
// stateless, and anyone holding the text can compute it. Its whole job is to
// force the model to round-trip through a preview tool with the EXACT payload
// it intends to commit: any drift between what was shown and what is being
// committed invalidates the token, so the human approved the real thing.

export function planToken(scope: string, text: string): string {
  let h = 0x811c9dc5;
  const s = `${scope} ${text}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `plan_${h.toString(16).padStart(8, "0")}_${s.length.toString(36)}`;
}

// Enabling a trigger binds the token to the CURRENT blast radius, not the
// trigger id alone: the count is recomputed at enable time, so a token from a
// stale preview (leads changed in between) refuses and forces a fresh look.
export function enableTriggerToken(
  triggerId: string,
  applyMode: string,
  eligibleCount: number,
): string {
  return planToken(`enable:${triggerId}`, `${applyMode}:${eligibleCount}`);
}
