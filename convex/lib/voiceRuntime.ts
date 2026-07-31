const PREFIX = "rv1";

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array | null {
  if (!value || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export async function hashVoiceRuntimeToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return hex(new Uint8Array(digest));
}

export function createVoiceRuntimeToken(agentId: string): string {
  const random = crypto.getRandomValues(new Uint8Array(32));
  const encodedAgent = hex(new TextEncoder().encode(agentId));
  return `${PREFIX}.${encodedAgent}.${hex(random)}`;
}

export function agentFromVoiceRuntimeToken(token: string): string | null {
  const [prefix, encodedAgent, secret, extra] = token.split(".");
  if (prefix !== PREFIX || extra !== undefined || !secret || secret.length < 32) return null;
  const bytes = fromHex(encodedAgent);
  if (!bytes) return null;
  const agentId = new TextDecoder().decode(bytes).trim();
  return agentId || null;
}
