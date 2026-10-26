/**
 * Who may create an account on this server, from the environment:
 * - POLARIS_SIGNUP: "open" (the default) or "closed" (no new accounts; existing ones still
 *   sign in). Anything else counts as open.
 * - POLARIS_SIGNUP_EMAIL_DOMAINS: a comma-separated list such as "uni.edu, college.ac.uk".
 *   When set, only emails at those domains or their subdomains may sign up (an instructor's
 *   server for one university, say). Empty means any domain.
 */
export interface SignupPolicy {
  open: boolean;
  domains: string[];
}

export function signupPolicy(env: Record<string, string | undefined> = process.env): SignupPolicy {
  return {
    open: env.POLARIS_SIGNUP?.trim().toLowerCase() !== "closed",
    domains: (env.POLARIS_SIGNUP_EMAIL_DOMAINS ?? "")
      .split(",")
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean),
  };
}

/** Whether `email` (already normalized) may sign up under `policy`. */
export function emailAllowed(email: string, policy: SignupPolicy): boolean {
  if (policy.domains.length === 0) return true;
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  return policy.domains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** How the allowed domains read in a sentence: "uni.edu", "uni.edu or college.edu", ... */
export function domainsText(domains: string[]): string {
  if (domains.length <= 1) return domains[0] ?? "";
  return `${domains.slice(0, -1).join(", ")} or ${domains.at(-1)}`;
}

export const SIGNUP_CLOSED_MESSAGE =
  "This Polaris server is not taking new accounts. Ask the person who runs it.";
