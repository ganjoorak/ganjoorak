import FollowingPage from "@/components/FollowingPage";

type Props = { searchParams: Promise<{ tab?: string | string[] }> };

export default async function Following({ searchParams }: Props) {
  const { tab } = await searchParams;
  return <FollowingPage initialTab={tab === "followers" ? "followers" : "following"} />;
}
