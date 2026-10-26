import type { Metadata } from "next";
import Link from "next/link";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import { domainsText, SIGNUP_CLOSED_MESSAGE, signupPolicy } from "@/lib/auth/signup-policy";
import { AuthCard } from "@/components/auth/AuthCard";
import { SignUpForm } from "@/components/auth/SignUpForm";

export const metadata: Metadata = { title: "Create an account" };

// The sign-up policy comes from the environment at request time, not at build time.
export const dynamic = "force-dynamic";

export default function SignUpPage() {
  const policy = signupPolicy();
  const footer = (
    <>
      Already have an account?{" "}
      <Link href={SIGN_IN_PATH} className="font-medium text-accent underline">
        Sign in
      </Link>
    </>
  );
  if (!policy.open) {
    return (
      <AuthCard title="Create an account" subtitle="New accounts are closed." footer={footer}>
        <p role="status">{SIGNUP_CLOSED_MESSAGE}</p>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="Create an account"
      subtitle={
        policy.domains.length > 0
          ? `Your documents are private to your account. Sign up with your ${domainsText(policy.domains)} email address.`
          : "Your documents are private to your account."
      }
      footer={footer}
    >
      <SignUpForm />
    </AuthCard>
  );
}
