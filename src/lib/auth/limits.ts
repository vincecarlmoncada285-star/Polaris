import { createRateLimiter, type RateLimiter } from "@/lib/rate-limit";

const MINUTE = 60_000;

export const RATE_LIMITED_MESSAGE = "Too many attempts. Try again later.";

export interface AuthLimits {
  /** Per email + IP: slows password guessing without letting one IP lock everyone out. */
  signIn: RateLimiter;
  /**
   * Per email, whatever the IP: a looser ceiling, so guessing one account's password stays
   * bounded even from many addresses (or a forged one).
   */
  signInPerEmail: RateLimiter;
  /** Per IP: slows account spam and probing which emails are registered. */
  signUp: RateLimiter;
  /** Per user: a stolen session should not be able to guess the current password quickly. */
  changePassword: RateLimiter;
  /** Records a sign-in attempt against both sign-in limits; false if either refuses it. */
  allowSignIn(email: string, ip: string): boolean;
}

export function createAuthLimits(now?: () => number): AuthLimits {
  const signIn = createRateLimiter({ limit: 10, windowMs: 15 * MINUTE, now });
  const signInPerEmail = createRateLimiter({ limit: 50, windowMs: 60 * MINUTE, now });
  return {
    signIn,
    signInPerEmail,
    signUp: createRateLimiter({ limit: 5, windowMs: 60 * MINUTE, now }),
    changePassword: createRateLimiter({ limit: 10, windowMs: 15 * MINUTE, now }),
    allowSignIn(email, ip) {
      // Per email + IP first: one address hammering away is refused without using up the
      // account's shared allowance.
      if (!signIn.hit(signInKey(email, ip)).ok) return false;
      return signInPerEmail.hit(normalizeEmailKey(email)).ok;
    },
  };
}

// Kept on globalThis so route handlers, server actions and dev hot reloads share one set of
// counters per process.
const globalForLimits = globalThis as unknown as { polarisAuthLimits?: AuthLimits };

export const limits: AuthLimits = (globalForLimits.polarisAuthLimits ??= createAuthLimits());

/**
 * How many reverse proxies in front of Polaris append the client address to X-Forwarded-For
 * (`TRUSTED_PROXY_HOPS`, default 0). Anything but a non-negative integer counts as 0.
 */
export function trustedProxyHops(raw: string | undefined = process.env.TRUSTED_PROXY_HOPS): number {
  const hops = Number(raw?.trim() || 0);
  return Number.isInteger(hops) && hops >= 0 ? hops : 0;
}

/** Shared by every client when their addresses cannot be trusted. */
export const UNKNOWN_IP = "unknown";

/**
 * The client address to rate-limit by.
 *
 * With no trusted proxy (`hops` 0, the default) it is always UNKNOWN_IP, so all clients share
 * the per-IP buckets: `next start` only fills X-Forwarded-For from the socket when the client
 * sent none (`??=`), so the header is whatever the client chose, and keying on it would hand
 * every request a fresh allowance.
 *
 * Behind `hops` proxies that each append the address they saw, the entry `hops` from the end
 * is the one the outermost trusted proxy saw; anything left of it may be forged.
 */
export function clientIp(headers: Headers, hops = trustedProxyHops()): string {
  if (hops < 1) return UNKNOWN_IP;
  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (forwarded?.length) return forwarded[Math.max(0, forwarded.length - hops)];
  return headers.get("x-real-ip")?.trim() || UNKNOWN_IP;
}

function normalizeEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

export function signInKey(email: string, ip: string): string {
  return `${normalizeEmailKey(email)}|${ip}`;
}
