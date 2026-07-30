import { describe, expect, it } from "vitest";

import {
  parseRetryableStage,
  podtracAuthenticationStatus,
  retryablePipelineStages,
} from "@/lib/admin-operations";
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

  it("derives Podtrac authentication state from only the latest authoritative sync run", () => {
    expect(podtracAuthenticationStatus({
      status: "failed",
      started_at: "2026-07-21T08:15:00Z",
      completed_at: "2026-07-21T08:15:05Z",
      error: "Podtrac authentication failed with HTTP 401",
    }).state).toBe("auth-error");
    expect(podtracAuthenticationStatus({
      status: "failed",
      started_at: "2026-07-21T08:15:00Z",
      completed_at: "2026-07-21T08:15:05Z",
      error: "Podtrac request failed with HTTP 403.",
    }).state).toBe("auth-error");
    expect(podtracAuthenticationStatus({
      status: "completed",
      started_at: "2026-07-22T08:15:00Z",
      completed_at: "2026-07-22T08:16:00Z",
      error: "",
    }, { asOfDate: "2026-07-22" })).toMatchObject({ state: "ok", checkedAt: "2026-07-22T08:16:00Z" });
    expect(podtracAuthenticationStatus({
      status: "completed",
      started_at: "2026-07-13T08:15:00Z",
      completed_at: "2026-07-13T08:16:00Z",
      error: "",
    }, { asOfDate: "2026-07-30" })).toMatchObject({
      state: "unknown",
      checkedAt: "2026-07-13T08:16:00Z",
      message: expect.stringContaining("no longer proves current access"),
    });
    expect(podtracAuthenticationStatus({
      status: "failed",
      started_at: "2026-07-22T08:15:00Z",
      completed_at: "2026-07-22T08:16:00Z",
      error: "database connection timed out",
    }).state).toBe("unknown");
    expect(podtracAuthenticationStatus({
      status: "failed",
      started_at: "2026-07-22T08:15:00Z",
      completed_at: "2026-07-22T08:16:00Z",
      error: "upstream returned HTTP 4010",
    }).state).toBe("unknown");
    expect(podtracAuthenticationStatus({
      status: "failed",
      started_at: "2026-07-22T08:15:00Z",
      completed_at: "2026-07-22T08:16:00Z",
      error: 'password authentication failed for user "aic_user"',
    }).state).toBe("unknown");
    expect(podtracAuthenticationStatus({
      status: "failed",
      started_at: "2026-07-22T08:15:00Z",
      completed_at: "2026-07-22T08:16:00Z",
      error: "operation forbidden by database policy",
    }).state).toBe("unknown");
    expect(podtracAuthenticationStatus(null).state).toBe("unknown");
  });
});
