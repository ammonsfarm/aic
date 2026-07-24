import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queueEpisodeReprocessByTrackId: vi.fn(),
  redirect: vi.fn(),
  requireAdminApiUser: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/rbac", () => ({ requireAdminApiUser: mocks.requireAdminApiUser }));
vi.mock("@/lib/strapi-structured-management", () => ({
  queueEpisodeReprocessByTrackId: mocks.queueEpisodeReprocessByTrackId,
}));

import { queueEpisodeReprocessAction } from "@/app/podcast/episodes/actions";

const admin = {
  clerkUserId: "admin-1",
  email: "admin@example.test",
  name: "Admin",
  role: "Admin",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminApiUser.mockResolvedValue(admin);
  mocks.queueEpisodeReprocessByTrackId.mockResolvedValue({ documentId: "episode-123" });
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
});

describe("episode reprocess action", () => {
  it("requires the Administrator guard before queueing work", async () => {
    mocks.requireAdminApiUser.mockRejectedValue(new Error("Administrator role is required."));
    const formData = new FormData();
    formData.set("confirmReprocess", "confirmed");
    formData.set("reprocessNote", "Correct transcript");

    await expect(queueEpisodeReprocessAction("123", "/podcast/episodes?trackId=123", formData))
      .rejects.toThrow("Administrator role is required");
    expect(mocks.queueEpisodeReprocessByTrackId).not.toHaveBeenCalled();
  });

  it("queues the selected Track ID with an attributed reason", async () => {
    const formData = new FormData();
    formData.set("confirmReprocess", "confirmed");
    formData.set("reprocessNote", "Correct transcript");

    await expect(queueEpisodeReprocessAction(
      "123",
      "/podcast/episodes?range=30d&trackId=123",
      formData,
    )).rejects.toThrow(/reprocessQueued=1/);

    expect(mocks.queueEpisodeReprocessByTrackId).toHaveBeenCalledWith("123", admin, "Correct transcript");
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("/podcast/episodes?range=30d&trackId=123"));
  });

  it("does not queue without explicit destructive-action confirmation", async () => {
    const formData = new FormData();
    formData.set("reprocessNote", "Correct transcript");

    await expect(queueEpisodeReprocessAction("123", "/podcast/episodes?trackId=123", formData))
      .rejects.toThrow(/reprocessError=/);
    expect(mocks.queueEpisodeReprocessByTrackId).not.toHaveBeenCalled();
  });
});
