import type { Metadata } from "next";
import Link from "next/link";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import { AuthCard } from "@/components/auth/AuthCard";
import { SignUpForm } from "@/components/auth/SignUpForm";

export const metadata: Metadata = { title: "Create an account · Polaris" };

export default function SignUpPage() {
  return (
    <AuthCard
      title="Create an account"
      subtitle="Your documents are private to your account."
      footer={
        <>
          Already have an account?{" "}
          <Link href={SIGN_IN_PATH} className="font-medium text-accent underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignUpForm />
    </AuthCard>
  );
}
