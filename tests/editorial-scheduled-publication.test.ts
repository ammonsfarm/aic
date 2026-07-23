import { afterEach, describe, expect, it, vi } from "vitest";

import editorialWorkflowController from "@/services/jimwood-cms/src/api/editorial-workflow/controllers/editorial-workflow";

const postUid = "api::post.post";
const revisionUid = "api::editorial-revision.editorial-revision";
const eventUid = "api::editorial-event.editorial-event";

function harness(scheduledFor: string) {
  let draft: Record<string, unknown> = {
    documentId: "post-1",
    title: "Scheduled post",
    scheduledFor,
    publishDate: null,
    archivedAt: null,
    updatedAt: "2026-07-22T11:59:00.000Z",
  };
  const revisions: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const postDocuments = {
    findOne: vi.fn(async () => draft),
    findMany: vi.fn(async () => []),
    create: vi.fn(),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      draft = { ...draft, ...data, updatedAt: "2026-07-22T12:00:01.000Z" };
      return draft;
    }),
    publish: vi.fn(async () => ({ entries: [{ ...draft, publishedAt: "2026-07-22T12:00:02.000Z" }] })),
    unpublish: vi.fn(),
    delete: vi.fn(),
  };
  const revisionDocuments = {
    findOne: vi.fn(),
    findMany: vi.fn(async () => []),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      revisions.push(data);
      return data;
    }),
  };
  const eventDocuments = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      events.push(data);
      return data;
    }),
  };
  const lock = vi.fn(async () => undefined);

  vi.stubGlobal("strapi", {
    components: {},
    contentType: () => ({ attributes: { publishDate: {} } }),
    documents: (uid: string) => {
      if (uid === postUid) return postDocuments;
      if (uid === revisionUid) return revisionDocuments;
      if (uid === eventUid) return eventDocuments;
      throw new Error(`Unexpected uid ${uid}`);
    },
    db: {
      config: { connection: { client: "postgres" } },
      transaction: vi.fn(async (callback: (value: { trx: { raw: typeof lock } }) => Promise<unknown>) => (
        callback({ trx: { raw: lock } })
      )),
      query: vi.fn(),
    },
  });

  const ctx: Record<string, unknown> = {
    params: { entityType: "post", documentId: "post-1", action: "publish-scheduled" },
    request: {
      body: {
        expectedUpdatedAt: "2026-07-22T11:59:00.000Z",
        actor: { id: "system:scheduled-publication", email: "publisher@example.test", name: "Worker" },
      },
    },
    status: 200,
    body: null,
  };
  ctx.badRequest = vi.fn((message: string) => {
    ctx.status = 400;
    ctx.badRequestMessage = message;
  });
  ctx.notFound = vi.fn();
  return { ctx, events, postDocuments, revisions };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("scheduled editorial publication", () => {
  it("clears a due schedule and records one normal publish revision", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T12:00:00.000Z"));
    const harnessState = harness("2026-07-22T12:00:00.000Z");

    await editorialWorkflowController.transition(harnessState.ctx as never);

    expect(harnessState.postDocuments.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { scheduledFor: null, publishDate: "2026-07-22T12:00:00.000Z" },
    }));
    expect(harnessState.postDocuments.publish).toHaveBeenCalledTimes(1);
    expect(harnessState.revisions.map((revision) => revision.action)).toEqual(["publish"]);
    expect(harnessState.events[0]?.detail).toEqual({
      scheduled: true,
      scheduledFor: "2026-07-22T12:00:00.000Z",
    });
  });

  it("does not publish a future schedule", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T12:00:00.000Z"));
    const harnessState = harness("2026-07-22T12:01:00.000Z");

    await editorialWorkflowController.transition(harnessState.ctx as never);

    expect(harnessState.ctx.badRequestMessage).toMatch(/not due/i);
    expect(harnessState.postDocuments.update).not.toHaveBeenCalled();
    expect(harnessState.postDocuments.publish).not.toHaveBeenCalled();
  });
});
