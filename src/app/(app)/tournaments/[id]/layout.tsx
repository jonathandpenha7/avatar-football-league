import { getTournamentContext } from "@/lib/data/session";

/** Verifies access to the tournament for every nested page (404 when not a member). */
export default async function TournamentLayout(props: LayoutProps<"/tournaments/[id]">) {
  const { id } = await props.params;
  await getTournamentContext(id);
  return props.children;
}
