import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/pastor-wood-site", () => ({
  PastorWoodShell: ({ children }: { children: React.ReactNode }) => React.createElement("main", null, children),
  PageHero: ({ title, body }: { title: string; body: string }) => React.createElement(
    "header",
    null,
    React.createElement("h1", null, title),
    React.createElement("p", null, body),
  ),
}));
vi.mock("@/lib/strapi-structured-public", () => ({ getPublishedPostBySlugResult: mocks.lookup }));

import WritingDetailPage, { generateMetadata } from "@/app/writings/[slug]/page";

beforeEach(() => {
  mocks.lookup.mockReset();
  mocks.notFound.mockClear();
});

describe("public writing detail availability", () => {
  it("uses a real 404 and noindex metadata only for a valid missing result", async () => {
    mocks.lookup.mockResolvedValue({ status: "not-found" });
    const props = { params: Promise.resolve({ slug: "missing-writing" }) };

    await expect(WritingDetailPage(props)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(generateMetadata(props)).resolves.toMatchObject({ robots: { index: false } });
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("renders a retryable alert and outage metadata when Strapi is unavailable", async () => {
    mocks.lookup.mockResolvedValue({ status: "unavailable" });
    const props = { params: Promise.resolve({ slug: "temporarily-down" }) };

    const markup = renderToStaticMarkup(await WritingDetailPage(props));
    const metadata = await generateMetadata(props);

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("This writing is temporarily unavailable");
    expect(markup).toContain("not a missing page");
    expect(markup).toContain("Retry this writing");
    expect(metadata).toMatchObject({
      title: "Writing temporarily unavailable",
      robots: { index: false, follow: true, noarchive: true },
    });
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
