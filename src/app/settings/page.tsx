import type { Metadata } from "next";
import { isAiConfigured } from "@/lib/ai/client";
import { requirePageUser } from "@/lib/auth/session";
import { AiToggle } from "@/components/settings/AiToggle";
import { DataExport } from "@/components/settings/DataExport";
import { DeleteAccount } from "@/components/settings/DeleteAccount";
import { OtherDevices } from "@/components/settings/OtherDevices";
import { PasswordForm } from "@/components/settings/PasswordForm";
import { ProfileForm } from "@/components/settings/ProfileForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requirePageUser("/settings");
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <h1 className="font-serif text-3xl font-semibold">Settings</h1>
      <ProfileForm name={user.name} email={user.email} />
      <AiToggle enabled={user.aiEnabled} configured={isAiConfigured()} />
      <DataExport />
      <PasswordForm />
      <OtherDevices />
      <DeleteAccount email={user.email} />
    </div>
  );
}
