import { redirect } from "next/navigation";

export default async function NewsletterArchiveDetailRoute({
  params,
}: {
  params: Promise<{ newsletterId: string }>;
}) {
  const { newsletterId } = await params;
  redirect(`/content/posts/${encodeURIComponent(newsletterId)}`);
}
