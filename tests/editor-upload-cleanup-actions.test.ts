import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertManagedPageSlugAvailable: vi.fn(),
  assertReusableMediaSelection: vi.fn(),
  createManagedPage: vi.fn(),
  createStructuredEntry: vi.fn(),
  deleteStructuredFile: vi.fn(),
  fetchWithTimeout: vi.fn(),
  getManagedPage: vi.fn(),
  getStructuredEntry: vi.fn(),
  redirect: vi.fn(),
  requireUser: vi.fn(),
  transitionManagedPage: vi.fn(),
  updateManagedPage: vi.fn(),
  updateStructuredEntry: vi.fn(),
  uploadStructuredFile: vi.fn(),
  definition: {
    editorPath: "/content/posts",
    fields: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

vi.mock("@/lib/rbac", () => ({
  requireContentManagerApiUser: mocks.requireUser,
}));

vi.mock("@/lib/cms-page-validation", () => ({
  assertAllowedPageSlug: ({ slug }: { slug: string }) => slug,
  immutablePageKey: ({ requestedPageKey, slug }: { requestedPageKey: string; slug: string }) => requestedPageKey || slug,
}));

vi.mock("@/lib/cms-html", () => ({
  safeCmsHref: (value: string) => value && !value.toLowerCase().startsWith("javascript:") ? value : null,
}));

vi.mock("@/lib/strapi", () => ({
  STRAPI_PAGES_CACHE_TAG: "strapi-pages",
  strapiPageCacheTag: (value: string) => `strapi-page:${value}`,
}));

vi.mock("@/lib/strapi-cache-tags", () => ({
  STRAPI_PUBLIC_MEDIA_CACHE_TAG: "strapi-public-media",
  STRAPI_STRUCTURED_CACHE_TAG: "strapi-structured",
  strapiPublicMediaCacheTag: (value: string) => `strapi-public-media:${value}`,
  strapiStructuredCacheTag: (value: string) => `strapi-structured:${value}`,
}));

vi.mock("@/lib/strapi-request", () => ({
  fetchWithTimeout: mocks.fetchWithTimeout,
  strapiUploadTimeoutMs: () => 1_000,
}));

vi.mock("@/lib/strapi-management", () => ({
  assertManagedStrapiPageSlugAvailable: mocks.assertManagedPageSlugAvailable,
  createManagedStrapiPageWithWorkflow: mocks.createManagedPage,
  getManagedStrapiPage: mocks.getManagedPage,
  rollbackManagedStrapiPage: vi.fn(),
  transitionManagedStrapiPage: mocks.transitionManagedPage,
  updateManagedStrapiPageWithWorkflow: mocks.updateManagedPage,
}));

vi.mock("@/lib/strapi-structured-management", () => ({
  assertReusableMediaSelection: mocks.assertReusableMediaSelection,
  createStructuredEntry: mocks.createStructuredEntry,
  deleteStructuredFile: mocks.deleteStructuredFile,
  getStructuredEntry: mocks.getStructuredEntry,
  retryEpisodeProcessing: vi.fn(),
  rollbackStructuredEntry: vi.fn(),
  transitionStructuredEntry: vi.fn(),
  updateStructuredEntry: mocks.updateStructuredEntry,
  uploadStructuredFile: mocks.uploadStructuredFile,
}));

vi.mock("@/lib/structured-content-config", () => ({
  getStructuredCollection: () => mocks.definition,
  slugifyStructuredContent: (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
}));

vi.mock("@/lib/legacy-redirects", () => ({
  isOwnedLegacyRedirectSource: () => false,
  isReservedLegacyRedirectSource: () => false,
  isSafeLegacyRedirectTarget: () => true,
  normalizeLegacyRequestPath: (value: string) => value,
}));

vi.mock("@/lib/structured-seo", () => ({
  structuredSeoPayload: (
    existing: unknown,
    replacement: { replacementSocialImageId?: number | null },
  ) => ({ existing, socialImage: replacement.replacementSocialImageId }),
}));

import {
  createStrapiPageAction,
  saveStrapiPageAction,
} from "@/app/(private)/content/strapi-pages/actions";
import {
  createStructuredEntryAction,
  saveStructuredEntryAction,
} from "@/app/(private)/content/structured/actions";

const user = {
  clerkUserId: "user-1",
  email: "editor@example.test",
  name: "Editor",
  role: "Content Manager",
};

function imageFile(name: string) {
  return new File(["image-bytes"], name, { type: "image/png" });
}

function basePageForm() {
  const formData = new FormData();
  formData.set("title", "Test page");
  formData.set("slug", "test-page");
  formData.set("pageKey", "test-page");
  formData.set("sectionCount", "0");
  formData.set("newSectionCount", "0");
  formData.set("publicationAction", "draft");
  return formData;
}

function structuredDefinition() {
  mocks.definition.editorPath = "/content/posts";
  mocks.definition.fields = [
    {
      type: "file",
      name: "featuredImageFile",
      label: "Featured image",
      accept: "image/*",
      mediaTarget: "featuredImage",
    },
    { type: "text", name: "title", label: "Title", required: true },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  structuredDefinition();
  process.env.STRAPI_URL = "https://strapi.example.test";
  process.env.STRAPI_API_TOKEN_TEMP_WRITE = "write-token";
  mocks.requireUser.mockResolvedValue(user);
  mocks.assertManagedPageSlugAvailable.mockResolvedValue(undefined);
  mocks.assertReusableMediaSelection.mockResolvedValue(undefined);
  mocks.deleteStructuredFile.mockResolvedValue(undefined);
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
});

describe("page editor upload cleanup", () => {
  it("removes multiple new uploads when later page validation fails", async () => {
    mocks.fetchWithTimeout
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 10 }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 11 }]), { status: 200 }));
    const formData = basePageForm();
    formData.set("socialImageFile", imageFile("social.png"));
    formData.set("sectionCount", "1");
    formData.set("section0Component", "page-sections.image-text-section");
    formData.set("section0Heading", "Section");
    formData.set("section0ImageFile", imageFile("section.png"));
    formData.set("section0ButtonUrl", "javascript:alert(1)");

    await expect(createStrapiPageAction(formData)).rejects.toThrow("Section button URL");
    expect(mocks.deleteStructuredFile.mock.calls.map(([fileId]) => fileId)).toEqual([10, 11]);
    expect(mocks.createManagedPage).not.toHaveBeenCalled();
  });

  it("removes a new upload when an update loses its version race", async () => {
    const versionError = new Error("This content item changed after this editor was loaded.");
    mocks.getManagedPage.mockResolvedValue({
      documentId: "page-1",
      pageKey: "test-page",
      slug: "test-page",
      sections: [],
      socialImage: null,
    });
    mocks.fetchWithTimeout.mockResolvedValue(
      new Response(JSON.stringify([{ id: 20 }]), { status: 200 }),
    );
    mocks.updateManagedPage.mockRejectedValue(versionError);
    const formData = basePageForm();
    formData.set("expectedUpdatedAt", "2026-07-23T12:00:00.000Z");
    formData.set("socialImageFile", imageFile("replacement.png"));

    await expect(saveStrapiPageAction("page-1", formData)).rejects.toBe(versionError);
    expect(mocks.deleteStructuredFile).toHaveBeenCalledWith(20);
  });

  it("retains attached media when a later publication transition fails", async () => {
    const transitionError = new Error("publication transition failed");
    mocks.fetchWithTimeout.mockResolvedValue(
      new Response(JSON.stringify([{ id: 30 }]), { status: 200 }),
    );
    mocks.createManagedPage.mockResolvedValue({
      documentId: "page-2",
      updatedAt: "2026-07-23T12:00:00.000Z",
    });
    mocks.transitionManagedPage.mockRejectedValue(transitionError);
    const formData = basePageForm();
    formData.set("publicationAction", "publish");
    formData.set("socialImageFile", imageFile("published.png"));

    await expect(createStrapiPageAction(formData)).rejects.toBe(transitionError);
    expect(mocks.createManagedPage).toHaveBeenCalledOnce();
    expect(mocks.deleteStructuredFile).not.toHaveBeenCalled();
  });
});

describe("structured editor upload cleanup", () => {
  it("never deletes a pre-existing selected media item", async () => {
    const formData = new FormData();
    formData.set("featuredImageFileLibraryId", "900");

    await expect(createStructuredEntryAction("posts", formData)).rejects.toThrow("Title is required");
    expect(mocks.assertReusableMediaSelection).toHaveBeenCalledWith(900, "image/*");
    expect(mocks.uploadStructuredFile).not.toHaveBeenCalled();
    expect(mocks.deleteStructuredFile).not.toHaveBeenCalled();
  });

  it("removes a new upload when the initial create fails", async () => {
    const createError = new Error("entry create failed");
    mocks.uploadStructuredFile.mockResolvedValue({ id: 40 });
    mocks.createStructuredEntry.mockRejectedValue(createError);
    const formData = new FormData();
    formData.set("featuredImageFile", imageFile("new.png"));
    formData.set("title", "New post");

    await expect(createStructuredEntryAction("posts", formData)).rejects.toBe(createError);
    expect(mocks.deleteStructuredFile).toHaveBeenCalledWith(40);
  });

  it("removes a new upload when an update loses its version race", async () => {
    const versionError = new Error("This content item changed after this editor was loaded.");
    mocks.getStructuredEntry.mockResolvedValue({ title: "Existing post" });
    mocks.uploadStructuredFile.mockResolvedValue({ id: 50 });
    mocks.updateStructuredEntry.mockRejectedValue(versionError);
    const formData = new FormData();
    formData.set("featuredImageFile", imageFile("updated.png"));
    formData.set("title", "Updated post");
    formData.set("expectedUpdatedAt", "2026-07-23T12:00:00.000Z");

    await expect(saveStructuredEntryAction("posts", "post-1", formData)).rejects.toBe(versionError);
    expect(mocks.deleteStructuredFile).toHaveBeenCalledWith(50);
  });

  it("does not let a cleanup failure mask the original create error", async () => {
    const createError = new Error("entry create failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.uploadStructuredFile.mockResolvedValue({ id: 60 });
    mocks.createStructuredEntry.mockRejectedValue(createError);
    mocks.deleteStructuredFile.mockRejectedValue(new Error("cleanup failed"));
    const formData = new FormData();
    formData.set("featuredImageFile", imageFile("new.png"));
    formData.set("title", "New post");

    await expect(createStructuredEntryAction("posts", formData)).rejects.toBe(createError);
    expect(mocks.deleteStructuredFile).toHaveBeenCalledWith(60);
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to remove rejected Strapi upload 60.",
      expect.any(Error),
    );
  });

  it("retains newly attached media after a successful initial save", async () => {
    mocks.uploadStructuredFile.mockResolvedValue({ id: 70 });
    mocks.createStructuredEntry.mockResolvedValue({ documentId: "post-2" });
    const formData = new FormData();
    formData.set("featuredImageFile", imageFile("saved.png"));
    formData.set("title", "Saved post");

    await expect(createStructuredEntryAction("posts", formData)).rejects.toThrow(
      "REDIRECT:/content/posts/post-2?created=1",
    );
    expect(mocks.createStructuredEntry).toHaveBeenCalledOnce();
    expect(mocks.deleteStructuredFile).not.toHaveBeenCalled();
  });
});
