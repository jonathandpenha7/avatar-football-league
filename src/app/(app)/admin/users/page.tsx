import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { getMyTournaments, requireSession } from "@/lib/data/session";
import type { Profile } from "@/lib/types";
import { UsersView } from "./users-view";

export const metadata: Metadata = { title: "Users and permissions" };

export default async function UsersPage() {
  const { supabase, profile } = await requireSession();
  if (!profile.is_super_admin) notFound();
  const [{ data: profiles }, { data: memberships }, tournaments] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at"),
    supabase.from("tournament_members").select("user_id, tournament_id, role"),
    getMyTournaments(),
  ]);
  return (
    <>
      <PageHeader title="Users and permissions" description="Platform-wide access. Tournament roles are managed on each tournament's Organisers page." />
      <UsersView
        currentUserId={profile.id}
        users={(profiles ?? []) as Profile[]}
        memberships={(memberships ?? []) as { user_id: string; tournament_id: string; role: string }[]}
        tournaments={tournaments.map((t) => ({ id: t.id, name: t.name }))}
      />
    </>
  );
}
