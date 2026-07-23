import { describe, expect, it, vi } from "vitest";

import { createNewUploadCleanup } from "@/lib/strapi-upload-cleanup";

describe("new Strapi upload cleanup", () => {
  it("removes every distinct upload tracked before a save commits", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const uploads = createNewUploadCleanup(remove);

    expect(uploads.track(11)).toBe(11);
    uploads.track(12);
    uploads.track(11);
    await uploads.cleanup();

    expect(remove.mock.calls.map(([fileId]) => fileId)).toEqual([11, 12]);
  });

  it("never removes tracked uploads after the entry save commits", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const uploads = createNewUploadCleanup(remove);
    uploads.track(21);

    uploads.commit();
    await uploads.cleanup();

    expect(remove).not.toHaveBeenCalled();
  });

  it("attempts all removals and absorbs cleanup and reporting failures", async () => {
    const originalError = new Error("entry create failed");
    const cleanupError = new Error("cleanup failed");
    const remove = vi.fn(async (fileId: number) => {
      if (fileId === 31) throw cleanupError;
    });
    const report = vi.fn(() => {
      throw new Error("reporting failed");
    });
    const uploads = createNewUploadCleanup(remove, report);
    uploads.track(31);
    uploads.track(32);

    await expect((async () => {
      try {
        throw originalError;
      } catch (error) {
        await uploads.cleanup();
        throw error;
      }
    })()).rejects.toBe(originalError);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledWith(31, cleanupError);
  });
});
