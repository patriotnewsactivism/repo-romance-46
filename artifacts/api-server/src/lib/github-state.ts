import { createHmac } from "crypto";

function hmac(userId: string) {
  const secret = process.env.GITHUB_CLIENT_SECRET;
  if (!secret) {
    throw new Error("GitHub OAuth not configured. Ask the admin to set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.");
  }
  return createHmac("sha256", secret).update(userId).digest("hex").slice(0, 32);
}

export function makeState(userId: string) {
  return `${userId}.${hmac(userId)}`;
}

export function parseState(state: string): string | null {
  const [userId, sig] = state.split(".");
  if (!userId || !sig) return null;
  try {
    if (hmac(userId) !== sig) return null;
    return userId;
  } catch {
    return null;
  }
}
