import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  genericPage: vi.fn(),
  lookup: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
  shell: vi.fn(),
}));

vi.mock("@/components/pastor-wood-site", () => ({
  PageHero: vi.fn(),
  PastorWoodGenericCmsPage: mocks.genericPage,
  PastorWoodShell: mocks.shell,
}));
vi.mock("@/lib/strapi", () => ({ getStrapiPageBySlugResult: mocks.lookup }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import DynamicCmsPage, { generateMetadata } from "@/app/[slug]/page";

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const page = {
  pageKey: "custom-page",
  slug: "custom-page",
  title: "Custom page",
  active: true,
  showInNavigation: false,
  navigationLabel: "",
  navigationOrder: null,
  heroLabel: "Resource",
  heroTitle: "Custom page",
  heroBody: "Custom page body",
  seoTitle: "",
  seoDescription: "",
  sections: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dynamic public CMS page", () => {
  it("keeps a successful empty lookup as a real not-found", async () => {
    mocks.lookup.mockResolvedValue({ status: "not-found" });

    await expect(DynamicCmsPage(params("missing-page"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("renders a noindex service fallback during an outage", async () => {
    mocks.lookup.mockResolvedValue({ status: "unavailable" });

    const metadata = await generateMetadata(params("custom-page"));
    const rendered = await DynamicCmsPage(params("custom-page"));

    expect(metadata.title).toBe("Page temporarily unavailable");
    expect(metadata.robots).toMatchObject({ index: false, follow: false, noarchive: true });
    expect(typeof rendered.type).toBe("function");
    const fallback = (rendered.type as () => { type: unknown })();
    expect(fallback.type).toBe(mocks.shell);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("renders published content normally", async () => {
    mocks.lookup.mockResolvedValue({ status: "found", page });

    const metadata = await generateMetadata(params("custom-page"));
    const rendered = await DynamicCmsPage(params("custom-page"));

    expect(metadata.alternates).toEqual({ canonical: "https://www.pastorwood.org/custom-page/" });
    expect(rendered.type).toBe(mocks.genericPage);
    expect(rendered.props.cmsPage).toEqual(page);
  });

  it("renders a last-published projected page with an explicit degraded state", async () => {
    mocks.lookup.mockResolvedValue({ status: "found", page, degraded: true });

    const metadata = await generateMetadata(params("custom-page"));
    const rendered = await DynamicCmsPage(params("custom-page"));

    expect(metadata.title).toBe("Custom page");
    expect(rendered.type).toBe(mocks.genericPage);
    expect(rendered.props.degraded).toBe(true);
    expect(rendered.props.cmsPage).toEqual(page);
  });
});
