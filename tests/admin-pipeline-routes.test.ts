import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parseRetryableStage: vi.fn(),
  queuePipelineRetry: vi.fn(),
  reconcilePodtracEpisode: vi.fn(),
  requireAdminApiUser: vi.fn(),
}));

vi.mock("@/lib/admin-operations", () => ({
  parseRetryableStage: mocks.parseRetryableStage,
  queuePipelineRetry: mocks.queuePipelineRetry,
  reconcilePodtracEpisode: mocks.reconcilePodtracEpisode,
}));
vi.mock("@/lib/rbac", () => ({
  requireAdminApiUser: mocks.requireAdminApiUser,
  isForbiddenError: (error: unknown) => error instanceof Error && error.message === "Administrator role is required.",
}));

import { NextRequest } from "next/server";

import { POST as reconcilePodtrac } from "@/app/api/admin/pipeline/reconcile/route";
import { POST as retryPipeline } from "@/app/api/admin/pipeline/retry/route";

function postRequest(path: string, payload: Record<string, unknown>) {
  return new NextRequest(`https://aic.ammonsfarm.org${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("Administrator pipeline mutation routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminApiUser.mockResolvedValue({ email: "admin@example.test" });
    mocks.parseRetryableStage.mockReturnValue("daily-ingest");
  });

  it("rejects a blank retry reason at the API boundary", async () => {
    const response = await retryPipeline(postRequest("/api/admin/pipeline/retry", {
      stage: "daily-ingest",
      reason: "   ",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/audit reason is required/i) });
    expect(mocks.queuePipelineRetry).not.toHaveBeenCalled();
  });

  it("rejects a blank audit note for a manual Podtrac match at the API boundary", async () => {
    const response = await reconcilePodtrac(postRequest("/api/admin/pipeline/reconcile", {
      action: "match",
      podtracEpisodeId: "podtrac-1",
      trackId: "episode-1",
      note: "",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/audit note is required/i) });
    expect(mocks.reconcilePodtracEpisode).not.toHaveBeenCalled();
  });

  it("rejects a manual match without an archive candidate at the API boundary", async () => {
    const response = await reconcilePodtrac(postRequest("/api/admin/pipeline/reconcile", {
      action: "match",
      podtracEpisodeId: "podtrac-1",
      trackId: "",
      note: "title and date verified",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/candidate is required/i) });
    expect(mocks.reconcilePodtracEpisode).not.toHaveBeenCalled();
  });

  it("checks Administrator RBAC before validating or queueing a retry", async () => {
    mocks.requireAdminApiUser.mockRejectedValue(new Error("Administrator role is required."));
    const response = await retryPipeline(postRequest("/api/admin/pipeline/retry", {
      stage: "daily-ingest",
      reason: "",
    }));

    expect(response.status).toBe(403);
    expect(mocks.parseRetryableStage).not.toHaveBeenCalled();
    expect(mocks.queuePipelineRetry).not.toHaveBeenCalled();
  });
});
