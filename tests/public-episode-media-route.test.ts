import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audio: vi.fn(),
  lookup: vi.fn(),
}));

vi.mock("@/lib/episode-audio", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/episode-audio")>(),
  publicEpisodeAudioResponse: mocks.audio,
}));

vi.mock("@/lib/strapi-structured-public", () => ({
  getPublishedEpisodeByTrackIdResult: mocks.lookup,
}));

import { GET, HEAD } from "@/app/media/episodes/[trackId]/route";

function context(trackId: string) {
  return { params: Promise.resolve({ trackId }) };
}

beforeEach(() => {
  mocks.audio.mockReset();
  mocks.lookup.mockReset();
  mocks.audio.mockResolvedValue(new Response(null, { status: 200 }));
});

describe("public episode media publication boundary", () => {
  it("keeps invalid and valid-missing Track IDs as 404", async () => {
    const invalid = await GET(new Request("https://www.pastorwood.org/media/episodes/bad.mp3"), context("bad.mp3"));
    expect(invalid.status).toBe(404);
    expect(mocks.lookup).not.toHaveBeenCalled();

    mocks.lookup.mockResolvedValue({ status: "not-found" });
    const missing = await GET(new Request("https://www.pastorwood.org/media/episodes/123"), context("123"));
    expect(missing.status).toBe(404);
    expect(mocks.audio).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", GET],
    ["HEAD", HEAD],
  ])("returns a private no-store 503 for %s while the CMS lookup is unavailable", async (method, handler) => {
    mocks.lookup.mockResolvedValue({ status: "unavailable" });
    const response = await handler(
      new Request("https://www.pastorwood.org/media/episodes/123", { method }),
      context("123"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.text()).toBe("");
    expect(mocks.audio).not.toHaveBeenCalled();
  });

  it("delegates a published Track ID to the bounded audio response", async () => {
    mocks.lookup.mockResolvedValue({ status: "found", item: { trackId: "123" } });
    const request = new Request("https://www.pastorwood.org/media/episodes/123");

    const response = await GET(request, context("123"));

    expect(response.status).toBe(200);
    expect(mocks.audio).toHaveBeenCalledWith(request, "123");
  });
});
