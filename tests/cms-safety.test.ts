import { describe, expect, it } from "vitest";

import { safeCmsHref, safeCmsImageSrc, sanitizeCmsHtml } from "@/lib/cms-html";
import { safeExternalDonationUrl } from "@/lib/public-donation";
import {
  assertAllowedPageSlug,
  assertUniquePageSlug,
  immutablePageKey,
} from "@/lib/cms-page-validation";
import { isKnownPrivatePath, singleSegmentSlug } from "@/lib/route-access";
import { isContentManagerRole, isResearchUserRole, normalizeAicRole } from "@/lib/rbac";
import { applicationSecurityHeaders, contentSecurityPolicy } from "@/lib/security-headers";
import { isPublicStrapiChange } from "@/lib/strapi-webhook";

describe("CMS page identity", () => {
  it("keeps an existing page key immutable when its slug changes", () => {
    expect(
      immutablePageKey({
        existingPageKey: "about",
        requestedPageKey: "about-pastor-wood",
        slug: "our-story",
      }),
    ).toBe("about");
  });

  it("rejects a newly claimed reserved slug", () => {
    expect(() => assertAllowedPageSlug({ slug: "admin" })).toThrow(/reserved/);
  });

  it("allows an existing fixed page to retain its reserved slug", () => {
    expect(assertAllowedPageSlug({ slug: "about-pastor-wood", originalSlug: "about-pastor-wood" }))
      .toBe("about-pastor-wood");
  });

  it("rejects duplicate slugs server-side", () => {
    expect(() =>
      assertUniquePageSlug({
        slug: "our-story",
        pages: [{ slug: "Our Story", documentId: "other-document" }],
        excludeDocumentId: "this-document",
      }),
    ).toThrow(/already used/);
  });
});

describe("CMS HTML sanitizer", () => {
  it.each([
    '<a href=javascript:alert(1)>bad</a>',
    '<a href="java&#x73;cript:alert(1)">bad</a>',
    '<a href="data:text/html,<script>alert(1)</script>">bad</a>',
    '<a href="java\nscript:alert(1)" onclick="alert(2)">bad</a>',
  ])("removes executable link payloads from %s", (payload) => {
    const clean = sanitizeCmsHtml(payload);
    expect(clean.toLowerCase()).not.toContain("javascript:");
    expect(clean.toLowerCase()).not.toContain("data:text/html");
    expect(clean.toLowerCase()).not.toContain("onclick");
  });

  it("drops active and unapproved elements while retaining basic rich text", () => {
    const clean = sanitizeCmsHtml(
      '<script>alert(1)</script><img src=x onerror=alert(2)><p style="text-align: center; color: red"><strong>Safe</strong></p>',
    );
    expect(clean).toContain("<strong>Safe</strong>");
    expect(clean).toContain("text-align:center");
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("img");
    expect(clean).not.toContain("color");
  });

  it("allows safe CTA destinations and rejects executable ones", () => {
    expect(safeCmsHref("/donate")).toBe("/donate");
    expect(safeCmsHref("https://wvr.org/books")).toBe("https://wvr.org/books");
    expect(safeCmsHref("javascript:alert(1)")).toBe("");
    expect(safeCmsHref("data:text/html,bad")).toBe("");
    expect(safeCmsHref("//evil.example/path")).toBe("");
    expect(safeCmsHref("http://evil.example/path")).toBe("");
    expect(sanitizeCmsHtml('<a href="http://evil.example/path">insecure</a>')).not.toContain("href");
    expect(sanitizeCmsHtml('<a href="/radio/">radio</a>')).toContain('href="/radio/"');
  });

  it("preserves only same-origin routed or bundled images", () => {
    for (const source of ["/media/legacy/2019/photo.jpg", "/media/cms/doc/photo.jpg", "/images/pastor.jpg"]) {
      expect(safeCmsImageSrc(source)).toBe(source);
      expect(sanitizeCmsHtml(`<p>Before</p><img src="${source}" alt="Pastor Jim"><p>After</p>`)).toContain(`src="${source}"`);
    }
    expect(sanitizeCmsHtml('<img src="https://gallery.mailchimp.com/tracker.jpg"><img src="javascript:alert(1)">')).not.toContain("img");
  });

  it("restricts external donation destinations to approved hosts and path", () => {
    expect(safeExternalDonationUrl("https://www.pastorwood.org/?givewp-route=donation-form-view&form-id=14759"))
      .toBe("https://www.pastorwood.org/?givewp-route=donation-form-view&form-id=14759");
    expect(safeExternalDonationUrl("https://www.pastorwood.org/donations/givewp-donation-form/")).toBeNull();
    expect(safeExternalDonationUrl("https://www.pastorwood.org/not-donations/phish")).toBeNull();
    expect(safeExternalDonationUrl("https://evil.example/donations/give")).toBeNull();
    expect(safeExternalDonationUrl("//evil.example/donations/give")).toBeNull();
  });
});

describe("private-route, RBAC, and security policy", () => {
  it("classifies protected route families without consulting CMS content", () => {
    expect(isKnownPrivatePath("/content/site-pages")).toBe(true);
    expect(isKnownPrivatePath("/admin")).toBe(true);
    expect(isKnownPrivatePath("/preview/site-settings")).toBe(true);
    expect(isKnownPrivatePath("/a-public-cms-page")).toBe(false);
    expect(singleSegmentSlug("/a-public-cms-page/")).toBe("a-public-cms-page");
  });

  it("enforces the intended content-manager role boundary", () => {
    expect(isContentManagerRole("Admin")).toBe(true);
    expect(isContentManagerRole("Content Manager")).toBe(true);
    expect(isContentManagerRole("User")).toBe(false);
    expect(isContentManagerRole("Read Only")).toBe(false);
    expect(isResearchUserRole("Research User")).toBe(true);
    expect(normalizeAicRole("content_manager")).toBe("Content Manager");
  });

  it("ships CSP and browser hardening headers", () => {
    const policy = contentSecurityPolicy("production");
    const headers = new Map(applicationSecurityHeaders("production").map((header) => [header.key, header.value]));
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("invalidates public caches for every public content mutation", () => {
    expect(isPublicStrapiChange({ event: "entry.update" })).toBe(true);
    expect(isPublicStrapiChange({ event: "entry.create" })).toBe(true);
    expect(isPublicStrapiChange({ event: "entry.publish" })).toBe(true);
    expect(isPublicStrapiChange({ event: "entry.unpublish" })).toBe(true);
    expect(isPublicStrapiChange({ event: "entry.delete" })).toBe(true);
  });
});
