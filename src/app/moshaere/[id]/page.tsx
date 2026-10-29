import { notFound } from "next/navigation";
import MatchPage from "@/components/moshaere/MatchPage";

type Props = { params: Promise<{ id: string }> };

export default async function MoshaereMatch({ params }: Props) {
  const { id } = await params;
  const matchId = /^[0-9]{1,12}$/.test(id) ? Number(id) : 0;
  if (!matchId) notFound();
  return <MatchPage id={matchId} />;
}
