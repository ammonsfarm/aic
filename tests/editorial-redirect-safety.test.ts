import { afterEach, describe, expect, it, vi } from "vitest";

import editorialWorkflowController from "@/services/jimwood-cms/src/api/editorial-workflow/controllers/editorial-workflow";

const redirectUid = "api::redirect.redirect";
const revisionUid = "api::editorial-revision.editorial-revision";
const eventUid = "api::editorial-event.editorial-event";

type RedirectRecord = Record<string, unknown> & { documentId: string };

function workflowHarness(options: {
  current?: RedirectRecord;
  activeRules?: RedirectRecord[];
  revision?: Record<string, unknown> | null;
} = {}) {
  let current = options.current || {
    documentId: "redirect-1",
    fromPath: "/legacy/",
    toPath: "/final/",
    statusCode: 301,
    active: true,
    archivedAt: null,
    updatedAt: "2026-07-23T01:00:00.000Z",
  };
  const activeRules = options.activeRules || [current];
  const revisions: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const redirectDocuments = {
    findOne: vi.fn(async () => current),
    findMany: vi.fn(async ({ start = 0, limit = 100 }: { start?: number; limit?: number }) => (
      activeRules.slice(start, start + limit)
    )),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      current = {
        documentId: "redirect-created",
        updatedAt: "2026-07-23T01:01:00.000Z",
        ...data,
      };
      return current;
    }),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      current = { ...current, ...data, updatedAt: "2026-07-23T01:01:00.000Z" };
      return current;
    }),
    publish: vi.fn(),
    unpublish: vi.fn(),
    delete: vi.fn(),
  };
  const revisionDocuments = {
    findOne: vi.fn(async () => options.revision || null),
    findMany: vi.fn(async () => revisions.slice(-1)),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const revision = { documentId: `revision-${revisions.length + 1}`, ...data };
      revisions.push(revision);
      return revision;
    }),
  };
  const eventDocuments = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      events.push(data);
      return data;
    }),
  };
  const raw = vi.fn(async (sql: string, values?: unknown[]) => {
    void values;
    return sql.includes("returning document_id") ? { rows: [{ document_id: current.documentId }] } : { rows: [] };
  });
  const transaction = vi.fn(async (callback: (value: { trx: { raw: typeof raw } }) => Promise<unknown>) => (
    callback({ trx: { raw } })
  ));

  vi.stubGlobal("strapi", {
    components: {},
    contentType: () => ({
      attributes: {
        fromPath: { type: "string" },
        toPath: { type: "string" },
        statusCode: { type: "integer" },
        active: { type: "boolean" },
        sourceUrl: { type: "string" },
        notes: { type: "text" },
        lastVerifiedAt: { type: "datetime" },
        archivedAt: { type: "datetime" },
      },
    }),
    documents: (uid: string) => {
      if (uid === redirectUid) return redirectDocuments;
      if (uid === revisionUid) return revisionDocuments;
      if (uid === eventUid) return eventDocuments;
      throw new Error(`Unexpected uid ${uid}`);
    },
    db: {
      config: { connection: { client: "postgres" } },
      transaction,
      query: vi.fn(),
    },
  });

  function updateContext(data: Record<string, unknown>) {
    return context("", { data });
  }

  function context(action: string, extraBody: Record<string, unknown> = {}) {
    const ctx: Record<string, unknown> = {
      params: {
        entityType: "redirect",
        documentId: current.documentId,
        ...(action ? { action } : {}),
      },
      request: {
        body: {
          actor: { id: "user-1", email: "editor@example.test", name: "Editor" },
          expectedUpdatedAt: current.updatedAt,
          note: "Reviewed redirect change",
          ...extraBody,
        },
      },
      status: 200,
      body: null,
    };
    ctx.badRequest = vi.fn((message: string, details?: Record<string, unknown>) => {
      ctx.status = 400;
      ctx.badRequestMessage = message;
      ctx.badRequestDetails = details;
    });
    ctx.notFound = vi.fn();
    return ctx;
  }

  return {
    context,
    current: () => current,
    events,
    raw,
    redirectDocuments,
    revisions,
    transaction,
    updateContext,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authoritative Strapi redirect workflow", () => {
  it("uses the global graph lock when creating a redirect without a document id", async () => {
    const harness = workflowHarness();
    const ctx = harness.updateContext({ fromPath: "/created-legacy", toPath: "/created-final" });
    ctx.params = { entityType: "redirect" };

    await editorialWorkflowController.create(ctx as never);

    expect(harness.raw.mock.calls[0]?.[1]).toEqual(["pastorwood-editorial:redirect-graph"]);
    expect(harness.redirectDocuments.create).toHaveBeenCalledTimes(1);
  });

  it("uses the same global graph lock for a valid redirect update", async () => {
    const harness = workflowHarness();
    const ctx = harness.updateContext({ fromPath: "/LEGACY", toPath: "/new-final", statusCode: 308 });

    await editorialWorkflowController.update(ctx as never);

    expect(harness.transaction).toHaveBeenCalledTimes(1);
    expect(harness.raw.mock.calls[0]?.[1]).toEqual(["pastorwood-editorial:redirect-graph"]);
    expect(harness.redirectDocuments.update).toHaveBeenCalledTimes(1);
    expect(harness.current()).toMatchObject({
      fromPath: "/LEGACY/",
      toPath: "/new-final/",
      statusCode: 308,
      active: true,
    });
    expect(harness.revisions).toHaveLength(1);
    expect(harness.events).toHaveLength(1);
  });

  it("rejects an owned route before updating or projecting", async () => {
    const harness = workflowHarness();
    const ctx = harness.updateContext({ fromPath: "/CoNtAcT", toPath: "/donate/" });

    await editorialWorkflowController.update(ctx as never);

    expect(ctx.badRequestMessage).toMatch(/owned PastorWood public route/i);
    expect(ctx.badRequestDetails).toEqual({ code: "EDITORIAL_REDIRECT_OWNED_SOURCE" });
    expect(harness.redirectDocuments.update).not.toHaveBeenCalled();
    expect(harness.raw.mock.calls.some(([sql]) => String(sql).includes("pastorwood_public_projection"))).toBe(false);
  });

  it("validates a restored redirect against the current graph before writing", async () => {
    const current = {
      documentId: "redirect-restore",
      fromPath: "/legacy/",
      toPath: "/destination/",
      statusCode: 301,
      active: false,
      archivedAt: "2026-07-22T01:00:00.000Z",
      updatedAt: "2026-07-23T01:00:00.000Z",
    };
    const harness = workflowHarness({
      current,
      activeRules: [{
        documentId: "redirect-destination",
        fromPath: "/destination/",
        toPath: "/final/",
        statusCode: 301,
        active: true,
        archivedAt: null,
      }],
    });
    const ctx = harness.context("restore");

    await editorialWorkflowController.transition(ctx as never);

    expect(ctx.badRequestMessage).toMatch(/Redirect chains are not allowed/i);
    expect(harness.redirectDocuments.update).not.toHaveBeenCalled();
  });

  it("validates rollback snapshots and rejects an indirect cycle before restoring", async () => {
    const current = {
      documentId: "redirect-c",
      fromPath: "/c/",
      toPath: "/final/",
      statusCode: 301,
      active: true,
      archivedAt: null,
      updatedAt: "2026-07-23T01:00:00.000Z",
    };
    const harness = workflowHarness({
      current,
      activeRules: [
        { documentId: "redirect-a", fromPath: "/a/", toPath: "/b/", statusCode: 301, active: true, archivedAt: null },
        { documentId: "redirect-b", fromPath: "/b/", toPath: "/c/", statusCode: 301, active: true, archivedAt: null },
        current,
      ],
      revision: {
        documentId: "revision-c",
        entityType: "redirect",
        entityDocumentId: "redirect-c",
        revisionNumber: 2,
        snapshot: { fromPath: "/c/", toPath: "/a/", statusCode: 301, active: true, archivedAt: null },
      },
    });
    const ctx = harness.context("rollback", { revisionDocumentId: "revision-c" });

    await editorialWorkflowController.transition(ctx as never);

    expect(ctx.badRequestMessage).toMatch(/Redirect cycles are not allowed/i);
    expect(harness.redirectDocuments.update).not.toHaveBeenCalled();
    expect(harness.revisions).toHaveLength(0);
  });

  it("loads the complete paginated graph before accepting a mutation", async () => {
    const current = {
      documentId: "redirect-candidate",
      fromPath: "/candidate/",
      toPath: "/old-final/",
      statusCode: 301,
      active: true,
      archivedAt: null,
      updatedAt: "2026-07-23T01:00:00.000Z",
    };
    const activeRules = Array.from({ length: 3_001 }, (_, index) => ({
      documentId: `redirect-${String(index).padStart(4, "0")}`,
      fromPath: index === 2_923 ? "/late-source/" : `/legacy-${index}/`,
      toPath: `/final-${index}/`,
      statusCode: 301,
      active: true,
      archivedAt: null,
    }));
    const harness = workflowHarness({ current, activeRules });
    const ctx = harness.updateContext({ toPath: "/late-source/" });

    await editorialWorkflowController.update(ctx as never);

    expect(ctx.badRequestMessage).toMatch(/Redirect chains are not allowed/i);
    expect(harness.redirectDocuments.findMany.mock.calls.length).toBeGreaterThan(29);
    expect(harness.redirectDocuments.findMany.mock.calls.some(([query]) => (
      (query as { start?: number }).start === 2_900
    ))).toBe(true);
    expect(harness.redirectDocuments.update).not.toHaveBeenCalled();
  });
});
