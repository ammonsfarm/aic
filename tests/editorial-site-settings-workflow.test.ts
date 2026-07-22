import { afterEach, describe, expect, it, vi } from "vitest";

import editorialWorkflowController from "@/services/jimwood-cms/src/api/editorial-workflow/controllers/editorial-workflow";

const revisionUid = "api::editorial-revision.editorial-revision";
const eventUid = "api::editorial-event.editorial-event";
const settingsUid = "api::site-setting.site-setting";

function workflowHarness() {
  const calls: string[] = [];
  const revisions: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const current = {
    id: 1,
    documentId: "settings-1",
    siteName: "Before",
    updatedAt: "2026-07-22T12:00:00.000Z",
    publishedAt: null,
  };
  const updated = {
    ...current,
    siteName: "After",
    updatedAt: "2026-07-22T12:01:00.000Z",
  };
  const published = {
    ...updated,
    publishedAt: "2026-07-22T12:01:01.000Z",
  };
  let draft = current;

  const settingsDocuments = {
    findOne: vi.fn(async () => draft),
    findMany: vi.fn(async () => []),
    create: vi.fn(),
    update: vi.fn(async () => {
      calls.push("update-draft");
      draft = updated;
      return updated;
    }),
    publish: vi.fn(async () => {
      calls.push("publish");
      return { entries: [published] };
    }),
    unpublish: vi.fn(async () => {
      calls.push("unpublish");
      return { entries: [draft] };
    }),
    delete: vi.fn(),
  };
  const revisionDocuments = {
    findOne: vi.fn(),
    findMany: vi.fn(async () => [...revisions].reverse().slice(0, 1)),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      revisions.push({ documentId: `revision-${revisions.length + 1}`, ...data });
      return revisions.at(-1);
    }),
  };
  const eventDocuments = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      events.push(data);
      return data;
    }),
  };
  const lock = vi.fn(async () => undefined);
  const transaction = vi.fn(async (callback: (value: { trx: { raw: typeof lock } }) => Promise<unknown>) => {
    calls.push("transaction");
    const result = await callback({ trx: { raw: lock } });
    calls.push("commit");
    return result;
  });

  vi.stubGlobal("strapi", {
    components: {},
    contentType: () => ({ attributes: {} }),
    documents: (uid: string) => {
      if (uid === settingsUid) return settingsDocuments;
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

  function context(action: string, expectedUpdatedAt = current.updatedAt) {
    const ctx: Record<string, unknown> = {
      params: { entityType: "site-setting", documentId: current.documentId, action },
      request: {
        body: {
          data: { siteName: "After" },
          expectedUpdatedAt,
          note: "Publish the reviewed settings",
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
    ctx.notFound = vi.fn((message: string) => {
      ctx.status = 404;
      ctx.notFoundMessage = message;
    });
    return ctx;
  }

  return {
    calls,
    context,
    events,
    lock,
    revisionDocuments,
    revisions,
    settingsDocuments,
    transaction,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("site-settings editorial transaction", () => {
  it("updates and publishes under one lock with matching attribution", async () => {
    const harness = workflowHarness();
    const ctx = harness.context("publish");

    await editorialWorkflowController.transition(ctx as never);

    expect(harness.transaction).toHaveBeenCalledTimes(1);
    expect(harness.lock).toHaveBeenCalledTimes(1);
    expect(harness.calls).toEqual(["transaction", "update-draft", "publish", "commit"]);
    expect(harness.revisions.map((revision) => revision.action)).toEqual(["save", "publish"]);
    expect(harness.revisions.every((revision) => revision.actorEmail === "editor@example.test")).toBe(true);
    expect(harness.events.map((event) => event.action)).toEqual(["save", "publish"]);
    expect((ctx.body as { data: { siteName: string } }).data.siteName).toBe("After");
  });

  it("rejects a stale editor before changing or publishing the draft", async () => {
    const harness = workflowHarness();
    const ctx = harness.context("publish", "2026-07-22T11:00:00.000Z");

    await editorialWorkflowController.transition(ctx as never);

    expect(ctx.badRequestMessage).toMatch(/changed after this editor was loaded/i);
    expect(harness.settingsDocuments.update).not.toHaveBeenCalled();
    expect(harness.settingsDocuments.publish).not.toHaveBeenCalled();
    expect(harness.revisions).toHaveLength(0);
  });

  it("updates and unpublishes under the same transaction", async () => {
    const harness = workflowHarness();
    const ctx = harness.context("unpublish");

    await editorialWorkflowController.transition(ctx as never);

    expect(harness.calls).toEqual(["transaction", "update-draft", "unpublish", "commit"]);
    expect(harness.revisions.map((revision) => revision.action)).toEqual(["save", "unpublish"]);
  });

  it("rejects a stale rollback before reading or applying the revision", async () => {
    const harness = workflowHarness();
    const ctx = harness.context("rollback", "2026-07-22T11:00:00.000Z");
    (ctx.request as { body: Record<string, unknown> }).body.revisionDocumentId = "revision-1";

    await editorialWorkflowController.transition(ctx as never);

    expect(ctx.badRequestMessage).toMatch(/changed after this editor was loaded/i);
    expect(harness.revisionDocuments.findOne).not.toHaveBeenCalled();
    expect(harness.settingsDocuments.update).not.toHaveBeenCalled();
  });

  it("adopts an existing record once without rewriting its content", async () => {
    const harness = workflowHarness();
    const first = harness.context("baseline");
    const second = harness.context("baseline");

    await editorialWorkflowController.transition(first as never);
    await editorialWorkflowController.transition(second as never);

    expect((first.body as { adopted: boolean }).adopted).toBe(true);
    expect((second.body as { adopted: boolean }).adopted).toBe(false);
    expect(harness.settingsDocuments.update).not.toHaveBeenCalled();
    expect(harness.revisions.map((revision) => revision.action)).toEqual(["baseline"]);
  });
});
