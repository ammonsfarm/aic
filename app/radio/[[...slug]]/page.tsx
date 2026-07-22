import { PastorWoodStructuredRadioPage } from "@/components/pastor-wood-structured-listings";

type PageProps = {
  params: Promise<{ slug?: string[] }>;
};

export default async function Page({ params }: PageProps) {
  const { slug = [] } = await params;
  return <PastorWoodStructuredRadioPage slug={slug} />;
}
