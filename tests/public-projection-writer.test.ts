import { describe, expect, it, vi } from "vitest";

import {
  projectPublishedDocument,
  publicProjectionPayload,
  tombstonePublicProjection,
  type ProjectionTransaction,
} from "@/services/jimwood-cms/src/api/editorial-workflow/controllers/public-projection";

function transaction(resultForSql?: (sql: string) => unknown) {
  const raw = vi.fn(async (sql: string) => resultForSql?.(sql) ?? { rows: [{ document_id: "document-1" }] });
  return { trx: { raw } as ProjectionTransaction, raw };
}

describe("Strapi public continuity projection writer", () => {
  it("projects only public-safe relation identities and exact managed upload paths", () => {
    const payload = publicProjectionPayload("post", {
      documentId: "post-1",
      title: "Public post",
      slug: "public-post",
      author: { documentId: "person-1", biography: "Draft relation body must not leak" },
      featuredImage: { documentId: "featured-1", url: "/uploads/featured_hash.jpg", mime: "image/jpeg" },
      seo: {
        title: "Search title",
        socialImage: { documentId: "social-1", url: "/uploads/social_hash.jpg" },
      },
    }) as Record<string, unknown>;

    expect(payload.authorDocumentId).toBe("person-1");
    expect(payload).not.toHaveProperty("author");
    expect(JSON.stringify(payload)).not.toContain("Draft relation body");
    expect(payload.featuredImage).toMatchObject({ documentId: "featured-1", url: "/uploads/featured_hash.jpg" });

    for (const url of [
      "/uploads//double.jpg",
      "/uploads/subdirectory/file.jpg",
      "/uploads/%2e%2e/private.jpg",
      "/uploads/file.jpg?download=1",
      "https://evil.example/uploads/file.jpg",
    ]) {
      const rejected = publicProjectionPayload("media-asset", {
        documentId: "asset-1",
        visibility: "public",
        asset: { documentId: "asset-media-1", url },
      }) as Record<string, unknown>;
      expect(rejected.asset, url).toBeNull();
    }
  });

  it("projects only supported page typography presets", () => {
    const payload = publicProjectionPayload("page", {
      documentId: "page-1",
      title: "About",
      slug: "about",
      pageKey: "about",
      heroTitleSize: "small",
      heroBodySize: "large",
      sectionHeadingSize: "enormous",
    }) as Record<string, unknown>;

    expect(payload).toMatchObject({
      heroTitleSize: "small",
      heroBodySize: "large",
      sectionHeadingSize: "standard",
      sectionBodySize: "standard",
    });
    expect(JSON.stringify(payload)).not.toContain("enormous");
  });

  it("keeps strict managed episode audio routes for every operational Track ID", () => {
    const accepted = new Map([
      ["123", "/media/episodes/123"],
      ["sa_42", "/media/episodes/sa_42"],
      ["wp-sermon%3A14759", "/media/episodes/wp-sermon%3A14759"],
      ["cms_new-episode", "/media/episodes/cms_new-episode"],
    ]);
    for (const [pathId, expected] of accepted) {
      const trackId = decodeURIComponent(pathId);
      const payload = publicProjectionPayload("episode", {
        documentId: "episode-1",
        trackId,
        externalAudioUrl: `/media/episodes/${pathId}`,
      }) as Record<string, unknown>;
      expect(payload.externalAudioUrl, pathId).toBe(expected);
    }

    for (const value of [
      "/media/episodes/../api/private",
      "/media/episodes/%2e%2e/api/private",
      "/media/episodes//123",
      "/media/episodes/123/other",
      "/media/episodes/123?download=1",
      "/media/episodes/not-valid",
    ]) {
      const payload = publicProjectionPayload("episode", { documentId: "episode-1", trackId: "123", externalAudioUrl: value }) as Record<string, unknown>;
      expect(payload.externalAudioUrl, value).toBe("");
    }

    const mismatched = publicProjectionPayload("episode", {
      documentId: "episode-1",
      trackId: "123",
      externalAudioUrl: "/media/episodes/456",
    }) as Record<string, unknown>;
    expect(mismatched.externalAudioUrl).toBe("");
  });

  it("preserves strict legacy redirect source paths without exposing protected targets", () => {
    for (const fromPath of ["/wp-content/uploads/legacy.pdf", "/feed/old-program/"]) {
      const payload = publicProjectionPayload("redirect", {
        documentId: "redirect-1",
        fromPath,
        toPath: "/written-resources/",
        statusCode: 301,
        active: true,
      }) as Record<string, unknown>;
      expect(payload).toMatchObject({ fromPath, toPath: "/written-resources/", statusCode: 301, active: true });
    }
    for (const fromPath of ["//evil.example/path", "/old//path", "/old/%2e%2e/api", "/old/?query=1"]) {
      const payload = publicProjectionPayload("redirect", { documentId: "redirect-1", fromPath, toPath: "/" }) as Record<string, unknown>;
      expect(payload.fromPath, fromPath).toBe("");
    }
    const blockedTarget = publicProjectionPayload("redirect", {
      documentId: "redirect-1",
      fromPath: "/old/",
      toPath: "/api/private",
    }) as Record<string, unknown>;
    expect(blockedTarget.toPath).toBe("");
  });

  it("throws on an active identity conflict so the surrounding editorial transaction rolls back", async () => {
    const { trx, raw } = transaction((sql) => sql.includes("returning document_id") ? { rows: [] } : { rows: [] });

    await expect(projectPublishedDocument(trx, "page", "page-1", {
      documentId: "page-1",
      title: "Page",
      slug: "shared",
      pageKey: "shared",
      active: true,
    })).rejects.toThrow("identity is already owned by another published document");

    expect(raw.mock.calls.some(([sql]) => String(sql).includes("pastorwood_public_projection_identities"))).toBe(true);
    expect(raw.mock.calls.some(([sql]) => String(sql).startsWith("delete from public.pastorwood_public_projection_media"))).toBe(false);
  });

  it("tombstones payload and removes all projected media for the document", async () => {
    const { trx, raw } = transaction();
    await tombstonePublicProjection(trx, "episode", "episode-1", {
      documentId: "episode-1",
      slug: "episode-one",
      trackId: "1",
    });

    expect(raw.mock.calls[0]?.[0]).toContain("payload = null");
    expect(raw.mock.calls.at(-1)?.[0]).toContain("delete from public.pastorwood_public_projection_media");
  });
});
