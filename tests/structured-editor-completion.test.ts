import { describe, expect, it } from "vitest";

import { STRUCTURED_COLLECTIONS } from "@/lib/structured-content-config";
import { structuredSeoPayload } from "@/lib/structured-seo";
import { isSiblingEditorForm } from "@/lib/unsaved-editor-guard";

describe("structured editor completion contracts", () => {
  it("configures the person relation on endorsements rather than people", () => {
    expect(STRUCTURED_COLLECTIONS.people.fields.some((field) => field.name === "person")).toBe(false);
    expect(STRUCTURED_COLLECTIONS.endorsements.fields.find((field) => field.name === "person")).toMatchObject({
      type: "relation",
      relationTarget: "people",
    });
  });

  it("preserves the SEO component and social image unless a replacement is uploaded", () => {
    const existing = {
      id: 17,
      title: "Old title",
      socialImage: { data: { id: 23, name: "share.jpg" } },
    };

    expect(structuredSeoPayload(existing, {
      title: "New title",
      description: "New description",
      canonicalUrl: "/canonical/",
      noIndex: true,
    })).toEqual({
      id: 17,
      title: "New title",
      description: "New description",
      canonicalUrl: "/canonical/",
      noIndex: true,
      socialImage: 23,
    });

    expect(structuredSeoPayload(existing, {
      title: "New title",
      description: "",
      canonicalUrl: null,
      noIndex: false,
      replacementSocialImageId: 41,
    })).toMatchObject({ id: 17, socialImage: 41 });
  });

  it("distinguishes the active editor form from a sibling lifecycle form", () => {
    const editor = { nodeName: "FORM" } as unknown as EventTarget;
    const lifecycle = { nodeName: "form" } as unknown as EventTarget;
    expect(isSiblingEditorForm(editor, editor)).toBe(false);
    expect(isSiblingEditorForm(lifecycle, editor)).toBe(true);
    expect(isSiblingEditorForm({ nodeName: "BUTTON" } as unknown as EventTarget, editor)).toBe(false);
  });
});
