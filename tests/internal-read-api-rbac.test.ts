import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  episodeAudioResponse: vi.fn(),
  getEpisodeArchiveRows: vi.fn(),
  getEpisodeDetail: vi.fn(),
  getInternalReadApiUser: vi.fn(),
  isPublicEpisodeTrackId: vi.fn(),
  searchEpisodesByText: vi.fn(),
  searchEpisodesWithVectorFallback: vi.fn(),
}));

vi.mock("@/lib/rbac", () => ({ getInternalReadApiUser: mocks.getInternalReadApiUser }));
vi.mock("@/lib/podcast-insights", () => ({ getEpisodeArchiveRows: mocks.getEpisodeArchiveRows }));
vi.mock("@/lib/podcast-data", () => ({
  getEpisodeDetail: mocks.getEpisodeDetail,
  searchEpisodesByText: mocks.searchEpisodesByText,
  searchEpisodesWithVectorFallback: mocks.searchEpisodesWithVectorFallback,
}));
vi.mock("@/lib/episode-audio", () => ({
  episodeAudioResponse: mocks.episodeAudioResponse,
  isPublicEpisodeTrackId: mocks.isPublicEpisodeTrackId,
}));

import { NextRequest } from "next/server";

import { GET as getPrivateAudio, HEAD as headPrivateAudio } from "@/app/api/audio/[trackId]/route";
import { GET as getEpisodeDetail } from "@/app/api/episodes/[trackId]/route";
import { GET as searchEpisodes } from "@/app/api/episodes/search/route";

const context = { params: Promise.resolve({ trackId: "12345" }) };

describe("internal episode API RBAC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEpisodeArchiveRows.mockResolvedValue([]);
    mocks.getEpisodeDetail.mockResolvedValue({ episode: { trackId: "12345" } });
    mocks.isPublicEpisodeTrackId.mockReturnValue(true);
    mocks.episodeAudioResponse.mockResolvedValue(new Response("audio", { status: 206 }));
  });

  it("returns 403 before reading internal data or audio for the default User role", async () => {
    mocks.getInternalReadApiUser.mockResolvedValue(null);
    const request = new NextRequest("https://aic.ammonsfarm.org/api/episodes/search");

    const responses = await Promise.all([
      searchEpisodes(request),
      getEpisodeDetail(new NextRequest("https://aic.ammonsfarm.org/api/episodes/12345"), context),
      getPrivateAudio(new Request("https://aic.ammonsfarm.org/api/audio/12345"), context),
      headPrivateAudio(new Request("https://aic.ammonsfarm.org/api/audio/12345", { method: "HEAD" }), context),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
    for (const response of responses) {
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(mocks.getEpisodeArchiveRows).not.toHaveBeenCalled();
    expect(mocks.getEpisodeDetail).not.toHaveBeenCalled();
    expect(mocks.episodeAudioResponse).not.toHaveBeenCalled();
  });

  it("keeps the internal read APIs available to a Read Only user", async () => {
    mocks.getInternalReadApiUser.mockResolvedValue({ role: "Read Only" });

    const searchResponse = await searchEpisodes(new NextRequest("https://aic.ammonsfarm.org/api/episodes/search"));
    const detailResponse = await getEpisodeDetail(
      new NextRequest("https://aic.ammonsfarm.org/api/episodes/12345"),
      context,
    );
    const audioResponse = await getPrivateAudio(
      new Request("https://aic.ammonsfarm.org/api/audio/12345"),
      context,
    );

    expect(searchResponse.status).toBe(200);
    expect(detailResponse.status).toBe(200);
    expect(audioResponse.status).toBe(206);
    expect(mocks.getEpisodeArchiveRows).toHaveBeenCalledOnce();
    expect(mocks.getEpisodeDetail).toHaveBeenCalledWith("12345");
    expect(mocks.episodeAudioResponse).toHaveBeenCalledOnce();
  });
});
