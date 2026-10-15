import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { SignOutButton } from "./SignOutButton";

const linkClass = "shrink-0 text-sm text-muted hover:text-foreground";

export async function Navbar() {
  const user = await getCurrentUser();
  const who = user ? user.name || user.email : null;

  return (
    <nav aria-label="Main" className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-6">
      <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
        <span aria-hidden className="text-accent">
          ✦
        </span>{" "}
        Polaris
      </Link>
      {/* The logo already links home; on phones the extra link costs space the name needs. */}
      {user && (
        <Link href="/" className={`hidden sm:inline ${linkClass}`}>
          Documents
        </Link>
      )}
      <div className="ml-auto flex min-w-0 items-center gap-3 sm:gap-4">
        {user ? (
          <>
            <span
              className="min-w-0 truncate text-sm"
              title={who ?? undefined}
              data-testid="nav-user"
            >
              <span className="sr-only">Signed in as </span>
              {who}
            </span>
            <Link href="/settings" className={linkClass}>
              Settings
            </Link>
            <SignOutButton />
          </>
        ) : (
          <Link href="/signin" className={linkClass}>
            Sign in
          </Link>
        )}
      </div>
    </nav>
  );
}
