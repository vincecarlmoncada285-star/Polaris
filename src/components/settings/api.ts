/** A message for a failed /api/me request: the server's own wording when it sent one. */
export async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const error = body?.error;
  if (typeof error === "string") return error;
  // zod's flatten(): { formErrors: string[], fieldErrors: Record<string, string[]> }
  if (error && typeof error === "object") {
    const { formErrors = [], fieldErrors = {} } = error as {
      formErrors?: string[];
      fieldErrors?: Record<string, string[] | undefined>;
    };
    const first = [...formErrors, ...Object.values(fieldErrors).flatMap((v) => v ?? [])][0];
    if (first) return first;
  }
  return fallback;
}

export function patchMe(body: { name?: string | null; aiEnabled?: boolean }) {
  return fetch("/api/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
