import { describe, expect, it } from "vitest";

import { parseRetryableStage, retryablePipelineStages } from "@/lib/admin-operations";
import {
  canGenerateForRole,
  canMutateForRole,
  isResearchUserRole,
  roleLandingPath,
  type AicRole,
} from "@/lib/rbac";

describe("admin operation boundaries", () => {
  it("allows only fixed background stages", () => {
    expect(retryablePipelineStages).toEqual(["daily-ingest", "podtrac-import", "transcript-edits"]);
    expect(parseRetryableStage("podtrac-import")).toBe("podtrac-import");
    expect(parseRetryableStage("rm -rf /")).toBeNull();
    expect(parseRetryableStage({ stage: "daily-ingest" })).toBeNull();
  });

  it("allows protected corpus actions only for explicitly privileged roles", () => {
    const expectations: Array<[AicRole, boolean]> = [
      ["Admin", true],
      ["Content Manager", true],
      ["Research User", true],
      ["Read Only", false],
      ["User", false],
    ];

    for (const [role, allowed] of expectations) {
      expect(isResearchUserRole(role), `${role} research access`).toBe(allowed);
      expect(canGenerateForRole(role), `${role} generation access`).toBe(allowed);
      expect(canMutateForRole(role), `${role} mutation access`).toBe(allowed);
    }
  });

  it("uses reachable role landing pages instead of redirect loops", () => {
    expect(roleLandingPath("Read Only")).toBe("/podcast");
    expect(roleLandingPath("Content Manager")).toBe("/content");
    expect(roleLandingPath("Admin")).toBe("/overview");
  });
});
