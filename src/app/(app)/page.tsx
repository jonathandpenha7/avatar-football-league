import { redirect } from "next/navigation";
import { getMyTournaments } from "@/lib/data/session";

/** Send organisers straight to their most relevant tournament. */
export default async function Home() {
  const tournaments = await getMyTournaments();
  const live = tournaments.find((t) => t.status === "live") ?? tournaments.find((t) => !t.archived_at);
  redirect(live ? `/tournaments/${live.id}` : "/tournaments");
}
