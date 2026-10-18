import type { Metadata } from "next";
import Link from "next/link";
import { sanitizeCallbackUrl } from "@/lib/auth/callback-url";
import { ACCOUNT_CREATED_PARAM, SIGN_UP_PATH } from "@/lib/auth/routes";
import { AuthCard } from "@/components/auth/AuthCard";
import { SignInForm } from "@/components/auth/SignInForm";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const notice =
    params[ACCOUNT_CREATED_PARAM] === "1"
      ? "Your account was created. Sign in to continue."
      : undefined;
  return (
    <AuthCard
      title="Sign in"
      subtitle="Pick up your writing where you left off."
      footer={
        <>
          New to Polaris?{" "}
          <Link href={SIGN_UP_PATH} className="font-medium text-accent underline">
            Create an account
          </Link>
        </>
      }
    >
      <SignInForm callbackUrl={sanitizeCallbackUrl(params.callbackUrl)} notice={notice} />
    </AuthCard>
  );
}
