import MoshaerePage from "@/components/moshaere/MoshaerePage";

type Props = { searchParams: Promise<{ tab?: string | string[] }> };

export default async function Moshaere({ searchParams }: Props) {
  const { tab } = await searchParams;
  return <MoshaerePage initialTab={tab === "matches" ? "matches" : "public"} />;
}
