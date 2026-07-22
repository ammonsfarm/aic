import { PastorWoodStructuredRadioPage } from "@/components/pastor-wood-structured-listings";

type PageProps = {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<{ page?: string }>;
};

export default async function Page({ params, searchParams }: PageProps) {
  const { slug = [] } = await params;
  const requestedPage = Number((await searchParams).page || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  return <PastorWoodStructuredRadioPage slug={slug} page={page} />;
}
