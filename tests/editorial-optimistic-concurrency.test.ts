import { afterEach, describe, expect, it, vi } from "vitest";

import editorialWorkflowController from "@/services/jimwood-cms/src/api/editorial-workflow/controllers/editorial-workflow";

const postUid = "api::post.post";

function harness(expectedUpdatedAt: string) {
  const current = {
    documentId: "post-1",
    title: "Current title",
    updatedAt: "2026-07-22T12:00:00.000Z",
    publishedAt: null,
  };
  const postDocuments = {
    findOne: vi.fn(async () => current),
    findMany: vi.fn(async () => []),
    create: vi.fn(),
    update: vi.fn(async () => ({ ...current, title: "Edited title" })),
    publish: vi.fn(),
    unpublish: vi.fn(),
    delete: vi.fn(),
  };
  const lock = vi.fn(async () => undefined);

  vi.stubGlobal("strapi", {
    components: {},
    contentType: () => ({ attributes: {} }),
    documents: (uid: string) => {
      if (uid === postUid) return postDocuments;
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
    params: { entityType: "post", documentId: current.documentId },
    request: {
      body: {
        data: { title: "Edited title" },
        expectedUpdatedAt,
        actor: { id: "user-1", email: "editor@example.test", name: "Editor" },
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
  return { ctx, postDocuments };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("editorial optimistic concurrency", () => {
  it("rejects a stale structured-content save before changing the draft", async () => {
    const { ctx, postDocuments } = harness("2026-07-22T11:59:00.000Z");

    await editorialWorkflowController.update(ctx as never);

    expect(ctx.badRequestMessage).toMatch(/changed after this editor was loaded/i);
    expect(postDocuments.update).not.toHaveBeenCalled();
  });
});
