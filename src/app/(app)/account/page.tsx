import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { requireSession } from "@/lib/data/session";
import { AccountForm } from "./account-form";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const { profile } = await requireSession();
  return (
    <>
      <PageHeader title="Your account" description={profile.email} />
      <AccountForm name={profile.full_name ?? ""} />
    </>
  );
}
