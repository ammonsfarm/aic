import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRows: vi.fn() }));

vi.mock("@/lib/db", () => ({ queryRows: mocks.queryRows }));

import {
  getProjectedContentByIdentity,
  getProjectedPublicMedia,
  listProjectedContentPage,
} from "@/lib/public-content-projection";

beforeEach(() => {
  mocks.queryRows.mockReset();
});

describe("public continuity projection reader", () => {
  it("keeps page and person relations separate even when their document IDs collide", async () => {
    mocks.queryRows
      .mockResolvedValueOnce([{
        document_id: "settings-1",
        is_published: true,
        is_current: true,
        payload: {
          documentId: "settings-1",
          authorDocumentId: "shared-id",
          topNavigation: [
            { label: "Page", pageDocumentId: "shared-id", url: "" },
            { label: "Unpublished page", pageDocumentId: "missing-page", url: "/stale-page/" },
          ],
          footerNavigation: [],
          utilityNavigation: [],
        },
      }])
      .mockResolvedValueOnce([
        { entity_type: "person", document_id: "shared-id", is_published: true, payload: { name: "Correct person", active: true } },
        { entity_type: "page", document_id: "shared-id", is_published: true, payload: { title: "Correct page", slug: "correct-page", pageKey: "correct-page", active: true } },
      ]);

    const result = await getProjectedContentByIdentity<Record<string, unknown>>(
      "site-setting",
      "singleton",
      "site-setting",
    );

    expect(result).toMatchObject({
      status: "found",
      item: {
        author: { name: "Correct person" },
        topNavigation: [{ page: { title: "Correct page", slug: "correct-page" } }],
      },
    });
    const relationSql = String(mocks.queryRows.mock.calls[1]?.[0]);
    expect(relationSql).toContain("entity_type = 'person'");
    expect(relationSql).toContain("entity_type = 'page'");
  });

  it("uses the indexed identity table for detail lookups without enumerating projection rows", async () => {
    mocks.queryRows.mockResolvedValueOnce([{
      document_id: "episode-1",
      is_published: true,
      is_current: true,
      payload: { documentId: "episode-1", slug: "one", trackId: "1" },
    }]);

    await expect(getProjectedContentByIdentity("episode", "track-id", "1")).resolves.toMatchObject({ status: "found" });
    expect(mocks.queryRows).toHaveBeenCalledOnce();
    expect(String(mocks.queryRows.mock.calls[0]?.[0])).toContain("pastorwood_public_projection_identities i");
    expect(mocks.queryRows.mock.calls[0]?.[1]).toEqual(["episode", "track-id", "1"]);
  });

  it("resolves an endorsement person only from that person's published projection", async () => {
    mocks.queryRows
      .mockResolvedValueOnce([{
        document_id: "endorsement-1",
        is_published: true,
        is_current: true,
        payload: { documentId: "endorsement-1", attribution: "Public attribution", personDocumentId: "person-1" },
      }])
      .mockResolvedValueOnce([{
        entity_type: "person",
        document_id: "person-1",
        is_published: true,
        payload: { name: "Published person", title: "Pastor", active: true },
      }]);

    await expect(getProjectedContentByIdentity("endorsement", "slug", "endorsement-one")).resolves.toMatchObject({
      status: "found",
      item: {
        personDocumentId: "person-1",
        person: { documentId: "person-1", name: "Published person", title: "Pastor" },
      },
    });
  });

  it("authorizes projected media with one bounded indexed query and fails closed when absent", async () => {
    mocks.queryRows.mockResolvedValueOnce([]);
    await expect(getProjectedPublicMedia("media-1")).resolves.toBeNull();
    expect(mocks.queryRows).toHaveBeenCalledOnce();
    const sql = String(mocks.queryRows.mock.calls[0]?.[0]);
    expect(sql).toContain("where m.media_document_id = $1");
    expect(sql).toContain("limit 1");
    expect(sql).toContain("p.is_published = true");
  });

  it("retains projected empty state so tombstones cannot revive bootstrap rows", async () => {
    mocks.queryRows
      .mockResolvedValueOnce([{ total: "0" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ has_state: true }]);

    await expect(listProjectedContentPage("post", 1, 24)).resolves.toMatchObject({
      items: [],
      total: 0,
      hasState: true,
    });
  });
});
