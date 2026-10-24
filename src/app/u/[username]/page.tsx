import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicProfilePage } from "@/components/AccountPages";
import { publicProfilePath } from "@/utils/accountApi";
import { getPublicProfile } from "@/utils/publicProfile";

// Shared as /@username; next.config.js rewrites that here.
type Props = { params: Promise<{ username: string }> };

const describe = (displayName: string, nowReading: string | undefined, favoriteCount: number) => {
  const parts = [nowReading ? `در حال خواندن «${nowReading}»` : `${displayName} در گنجورک`];
  if (favoriteCount > 0) {
    parts.push(`${new Intl.NumberFormat("fa-IR").format(favoriteCount)} شعر پسندیده`);
  }
  return parts.join(" · ");
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await getPublicProfile((await params).username);
  if (!profile) {
    return { title: "نمایه پیدا نشد | گنجورک", robots: { index: false } };
  }
  const title = `${profile.displayName} (@${profile.username}) | گنجورک`;
  const description = describe(profile.displayName, profile.nowReading?.title, profile.favoriteCount);
  const url = publicProfilePath(profile.username);
  return {
    title,
    description,
    alternates: { canonical: url },
    // A page's openGraph replaces the layout's, so repeat the site image.
    openGraph: {
      type: "profile",
      title,
      description,
      url,
      username: profile.username,
      images: [{ url: "/icon-192-maskable.png" }],
    },
    twitter: { card: "summary", title, description },
  };
}

export default async function Page({ params }: Props) {
  const profile = await getPublicProfile((await params).username);
  if (!profile) {
    notFound();
  }
  return <PublicProfilePage profile={profile} />;
}
