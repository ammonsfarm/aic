import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const forbidden = new Error("forbidden");
  return {
    episodeAudioResponse: vi.fn(),
    forbidden,
    queryRows: vi.fn(),
    requireUser: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  queryRows: mocks.queryRows,
}));

vi.mock("@/lib/episode-audio", () => ({
  episodeAudioResponse: mocks.episodeAudioResponse,
  isPublicEpisodeTrackId: (value: string) => (
    value.length <= 100
    && /^(?:\d+|sa_\d+|wp-sermon:\d+|cms_[a-z0-9][a-z0-9_-]{0,62})$/.test(value)
  ),
}));

vi.mock("@/lib/rbac", () => ({
  isForbiddenError: (error: unknown) => error === mocks.forbidden,
  requireContentManagerApiUser: mocks.requireUser,
}));

import {
  assertCanonicalEpisodeMediaSelection,
  getCanonicalEpisodeMedia,
  listCanonicalEpisodeMedia,
} from "@/lib/canonical-episode-media";
import { GET as listRoute } from "@/app/api/content/canonical-media/route";
import {
  GET as previewRoute,
  HEAD as previewHeadRoute,
} from "@/app/api/content/canonical-media/episodes/[trackId]/route";

const row = {
  track_id: "wp-sermon:14759",
  title: "Faith and the Wilderness",
  publish_date: "2024-07-21",
  total_count: "3311",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({
    email: "editor@example.test",
    role: "Content Manager",
  });
  mocks.queryRows.mockResolvedValue([row]);
  mocks.episodeAudioResponse.mockResolvedValue(
    new Response("audio", {
      status: 206,
      headers: { "Content-Type": "audio/mpeg" },
    }),
  );
});

describe("canonical episode media inventory", () => {
  it("uses bounded SQL pagination and reports a catalog larger than 1,000 without loading it", async () => {
    const result = await listCanonicalEpisodeMedia({ page: 2, pageSize: 500 });

    expect(result.items).toHaveLength(1);
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 50,
      pageCount: 67,
      total: 3311,
    });
    const [sql, values] = mocks.queryRows.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("from public.episodes");
    expect(sql).toContain("limit $2");
    expect(sql).toContain("offset $3");
    expect(values).toEqual(["", 50, 50]);
  });

  it("searches titles, dates, and track IDs with wildcard characters escaped", async () => {
    await listCanonicalEpisodeMedia({ search: "  Faith_100%\\  " });

    const [sql, values] = mocks.queryRows.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("title ilike");
    expect(sql).toContain("track_id ilike");
    expect(sql).toContain("publish_date");
    expect(values[0]).toBe("Faith\\_100\\%\\\\");
  });

  it("returns only local safe public and protected preview URLs", async () => {
    const item = await getCanonicalEpisodeMedia("wp-sermon:14759");

    expect(item).toMatchObject({
      source: "aic-postgresql-minio",
      previewUrl: "/api/content/canonical-media/episodes/wp-sermon%3A14759",
      publicUrl: "/media/episodes/wp-sermon%3A14759",
      mime: "audio/mpeg",
    });
    expect(JSON.stringify(item)).not.toContain("/mnt/storage");
    expect(JSON.stringify(item)).not.toContain("local-minio");
  });

  it("rejects malformed and missing selections", async () => {
    await expect(getCanonicalEpisodeMedia("../secret")).resolves.toBeNull();
    expect(mocks.queryRows).not.toHaveBeenCalled();

    mocks.queryRows.mockResolvedValueOnce([]);
    await expect(assertCanonicalEpisodeMediaSelection("123")).rejects.toThrow(
      "no longer available",
    );
  });
});

describe("protected canonical media routes", () => {
  it("requires the Content Manager role for search", async () => {
    mocks.requireUser.mockRejectedValueOnce(mocks.forbidden);
    const response = await listRoute(
      new NextRequest("https://example.test/api/content/canonical-media"),
    );

    expect(response.status).toBe(403);
    expect(mocks.queryRows).not.toHaveBeenCalled();
  });

  it("passes bounded search pagination to the protected list source", async () => {
    const response = await listRoute(
      new NextRequest("https://example.test/api/content/canonical-media?page=2&pageSize=999&search=faith"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(payload.pagination.total).toBe(3311);
    expect(mocks.queryRows.mock.calls[0]?.[1]).toEqual(["faith", 50, 50]);
  });

  it("requires authorization before resolving or streaming a preview", async () => {
    mocks.requireUser.mockRejectedValueOnce(mocks.forbidden);
    const response = await previewRoute(
      new NextRequest("https://example.test/api/content/canonical-media/episodes/123"),
      { params: Promise.resolve({ trackId: "123" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.queryRows).not.toHaveBeenCalled();
    expect(mocks.episodeAudioResponse).not.toHaveBeenCalled();
  });

  it("streams only a canonical DB-backed track and preserves HEAD", async () => {
    const request = new NextRequest(
      "https://example.test/api/content/canonical-media/episodes/wp-sermon%3A14759",
      { headers: { Range: "bytes=0-99" } },
    );
    const response = await previewRoute(request, {
      params: Promise.resolve({ trackId: "wp-sermon:14759" }),
    });

    expect(response.status).toBe(206);
    expect(mocks.episodeAudioResponse).toHaveBeenCalledWith(
      request,
      "wp-sermon:14759",
      "private, no-store, max-age=0",
    );

    const headRequest = new NextRequest(request.url, { method: "HEAD" });
    await previewHeadRoute(headRequest, {
      params: Promise.resolve({ trackId: "wp-sermon:14759" }),
    });
    expect(mocks.episodeAudioResponse).toHaveBeenLastCalledWith(
      headRequest,
      "wp-sermon:14759",
      "private, no-store, max-age=0",
    );
  });
});
