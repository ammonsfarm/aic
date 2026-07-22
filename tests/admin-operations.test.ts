import { describe, expect, it } from "vitest";

import { parseRetryableStage, retryablePipelineStages } from "@/lib/admin-operations";
import { canGenerateForRole, canMutateForRole, roleLandingPath } from "@/lib/rbac";

describe("admin operation boundaries", () => {
  it("allows only fixed background stages", () => {
    expect(retryablePipelineStages).toEqual(["daily-ingest", "podtrac-import", "transcript-edits"]);
    expect(parseRetryableStage("podtrac-import")).toBe("podtrac-import");
    expect(parseRetryableStage("rm -rf /")).toBeNull();
    expect(parseRetryableStage({ stage: "daily-ingest" })).toBeNull();
  });

  it("keeps Read Only users out of generation and mutations", () => {
    expect(canGenerateForRole("Read Only")).toBe(false);
    expect(canMutateForRole("Read Only")).toBe(false);
    expect(canGenerateForRole("Research User")).toBe(true);
    expect(canMutateForRole("Content Manager")).toBe(true);
  });

  it("uses reachable role landing pages instead of redirect loops", () => {
    expect(roleLandingPath("Read Only")).toBe("/podcast");
    expect(roleLandingPath("Content Manager")).toBe("/content");
    expect(roleLandingPath("Admin")).toBe("/overview");
  });
});
