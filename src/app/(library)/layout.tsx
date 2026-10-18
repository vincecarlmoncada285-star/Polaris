import { requirePageUser } from "@/lib/auth/session";

/**
 * Settles who is asking before anything is sent: the loading skeleton (loading.tsx) sits
 * inside this layout, and a redirect from the page behind it would come after the response
 * had already started.
 */
export default async function LibraryLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser("/");
  return children;
}
