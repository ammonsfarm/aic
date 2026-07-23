import "server-only";

type DeleteUpload = (fileId: number) => Promise<unknown>;
type ReportCleanupError = (fileId: number, error: unknown) => void;

export type NewUploadCleanup = {
  track(fileId: number): number;
  commit(): void;
  cleanup(): Promise<void>;
};

function defaultCleanupErrorReporter(fileId: number, error: unknown) {
  console.error(`Failed to remove rejected Strapi upload ${fileId}.`, error);
}

export function createNewUploadCleanup(
  deleteUpload: DeleteUpload,
  reportCleanupError: ReportCleanupError = defaultCleanupErrorReporter,
): NewUploadCleanup {
  const pendingFileIds = new Set<number>();
  let committed = false;

  return {
    track(fileId) {
      if (!Number.isSafeInteger(fileId) || fileId <= 0) {
        throw new Error("A newly uploaded Strapi media identifier must be a positive integer.");
      }
      if (!committed) {
        pendingFileIds.add(fileId);
      }
      return fileId;
    },
    commit() {
      committed = true;
      pendingFileIds.clear();
    },
    async cleanup() {
      if (committed || pendingFileIds.size === 0) {
        return;
      }

      const fileIds = [...pendingFileIds];
      pendingFileIds.clear();
      const results = await Promise.allSettled(
        fileIds.map((fileId) => Promise.resolve().then(() => deleteUpload(fileId))),
      );
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          try {
            reportCleanupError(fileIds[index], result.reason);
          } catch {
            // Cleanup and reporting are both best-effort; neither may replace the save error.
          }
        }
      });
    },
  };
}
