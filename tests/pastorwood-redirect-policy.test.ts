import { describe, expect, it } from "vitest";

import {
  isOwnedPastorWoodPublicRoute,
  normalizePastorWoodRedirectPath,
  PASTORWOOD_OWNED_PUBLIC_ROUTES,
  PASTORWOOD_PROTECTED_REDIRECT_PREFIXES,
  validatePastorWoodRedirectGraph,
  type PastorWoodRedirectRule,
} from "@/services/jimwood-cms/src/shared/pastorwood-redirect-policy";

function rule(
  documentId: string,
  fromPath: string,
  toPath: string,
  overrides: Partial<PastorWoodRedirectRule> = {},
): PastorWoodRedirectRule {
  return { documentId, fromPath, toPath, statusCode: 301, active: true, archivedAt: null, ...overrides };
}

describe("PastorWood managed redirect policy", () => {
  it("normalizes safe paths and rejects ambiguous URL syntax", () => {
    expect(normalizePastorWoodRedirectPath("/Legacy//Path")).toBe("/Legacy/Path/");
    expect(normalizePastorWoodRedirectPath("/legacy/file.JPG")).toBe("/legacy/file.JPG");
    expect(normalizePastorWoodRedirectPath("//evil.example/path")).toBe("");
    expect(normalizePastorWoodRedirectPath("/legacy/../contact")).toBe("");
    expect(normalizePastorWoodRedirectPath("/legacy/?next=/contact")).toBe("");
  });

  it("protects every owned route across case and trailing-slash variants", () => {
    for (const path of PASTORWOOD_OWNED_PUBLIC_ROUTES) {
      expect(isOwnedPastorWoodPublicRoute(path), path).toBe(true);
      expect(isOwnedPastorWoodPublicRoute(path.toUpperCase()), path).toBe(true);
      expect(isOwnedPastorWoodPublicRoute(path === "/" ? path : path.replace(/\/+$/, "")), path).toBe(true);
      expect(validatePastorWoodRedirectGraph(rule("candidate", path, "/final/"), [])).toMatchObject({
        ok: false,
        code: "owned-source",
      });
    }
    expect(isOwnedPastorWoodPublicRoute("/media/cms/document/file.jpg")).toBe(true);
    expect(isOwnedPastorWoodPublicRoute("/privacy/archive")).toBe(true);
    expect(isOwnedPastorWoodPublicRoute("/writings/a-published-post")).toBe(true);
    expect(validatePastorWoodRedirectGraph(
      rule("writing", "/WRITINGS/A-PUBLISHED-POST", "/final/"),
      [],
    )).toMatchObject({ ok: false, code: "owned-source" });
  });

  it("rejects every auth-owned route prefix before proxy authentication", () => {
    for (const prefix of PASTORWOOD_PROTECTED_REDIRECT_PREFIXES) {
      expect(validatePastorWoodRedirectGraph(
        rule("candidate", `${prefix.toUpperCase()}/nested`, "/final/"),
        [],
      ), prefix).toMatchObject({ ok: false, code: "invalid-source" });
    }
    for (const prefix of ["/episodes", "/podcast", "/reading-plan", "/sermons"]) {
      expect(PASTORWOOD_PROTECTED_REDIRECT_PREFIXES).toContain(prefix);
    }
  });

  it("allows a valid final-hop legacy rule and the intentional upload alias family", () => {
    expect(validatePastorWoodRedirectGraph(
      rule("candidate", "/2020/04/old-message/", "/writings/current-message/", { statusCode: 308 }),
      [rule("other", "/2019/old/", "/radio/current/")],
    )).toMatchObject({
      ok: true,
      rule: { fromPath: "/2020/04/old-message/", toPath: "/writings/current-message/", statusCode: 308 },
    });
    expect(validatePastorWoodRedirectGraph(
      rule("upload", "/wp-content/uploads/2020/04/photo.jpg", "/media/legacy/2020/04/photo.jpg"),
      [],
    )).toMatchObject({ ok: true });
  });

  it("rejects direct and indirect cycles before reporting their component chains", () => {
    expect(validatePastorWoodRedirectGraph(
      rule("b", "/b/", "/a/"),
      [rule("a", "/a/", "/b/")],
    )).toMatchObject({ ok: false, code: "cycle" });

    expect(validatePastorWoodRedirectGraph(
      rule("c", "/c/", "/a/"),
      [rule("a", "/a/", "/b/"), rule("b", "/b/", "/c/")],
    )).toMatchObject({ ok: false, code: "cycle" });
  });

  it("rejects both outbound and inbound redirect chains", () => {
    expect(validatePastorWoodRedirectGraph(
      rule("a", "/a/", "/b/"),
      [rule("b", "/b/", "/final/")],
    )).toMatchObject({ ok: false, code: "chain" });

    expect(validatePastorWoodRedirectGraph(
      rule("a", "/a/", "/final/"),
      [rule("incoming", "/old/", "/a/")],
    )).toMatchObject({ ok: false, code: "chain" });
  });

  it("treats case and trailing-slash variants as one source", () => {
    expect(validatePastorWoodRedirectGraph(
      rule("candidate", "/LEGACY", "/final/"),
      [rule("existing", "/legacy/", "/other-final/")],
    )).toMatchObject({ ok: false, code: "duplicate-source" });
    expect(validatePastorWoodRedirectGraph(
      rule("candidate", "/legacy/", "/LEGACY"),
      [],
    )).toMatchObject({ ok: false, code: "self-loop" });
  });

  it("excludes the current document on update and always permits removal from the active graph", () => {
    expect(validatePastorWoodRedirectGraph(
      rule("same", "/legacy/", "/new-final/"),
      [rule("same", "/legacy/", "/old-final/")],
    )).toMatchObject({ ok: true });
    expect(validatePastorWoodRedirectGraph(
      rule("same", "/legacy/", "/owned-later/", { active: false }),
      [rule("a", "/a/", "/b/"), rule("b", "/b/", "/a/")],
    )).toMatchObject({ ok: true, rule: { active: false } });
  });
});
