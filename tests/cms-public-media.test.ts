import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cms-public-media", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cms-public-media")>("@/lib/cms-public-media");
  return { ...actual, authorizedPublishedCmsMedia: vi.fn() };
});

import { cmsMediaPublicUrl } from "@/lib/cms-media-url";
import { authorizedPublishedCmsMedia, resolveCmsMediaPath } from "@/lib/cms-public-media";
import { GET } from "@/app/media/cms/[documentId]/[filename]/route";

const originalRoot = process.env.STRAPI_MEDIA_ROOT;

afterEach(() => {
  process.env.STRAPI_MEDIA_ROOT = originalRoot;
  vi.mocked(authorizedPublishedCmsMedia).mockReset();
});

describe("same-origin CMS media boundary", () => {
  it("never emits the loopback Strapi URL into public HTML", () => {
    const url = cmsMediaPublicUrl({ documentId: "mediaDoc123", url: "http://127.0.0.1:1337/uploads/photo_hash.jpg" });
    expect(url).toBe("/media/cms/mediaDoc123/photo_hash.jpg");
    expect(url).not.toContain("127.0.0.1");
  });

  it("requires a Strapi media document identity and safe flat filename", () => {
    expect(cmsMediaPublicUrl({ url: "/uploads/guess.jpg" })).toBe("");
    expect(resolveCmsMediaPath("../secret", "/tmp/uploads")).toBeNull();
    expect(resolveCmsMediaPath("public.jpg", "/tmp/uploads")?.filePath).toBe("/tmp/uploads/public.jpg");
  });

  it("serves an authorized published file and hides guessed private files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pastorwood-cms-media-"));
    process.env.STRAPI_MEDIA_ROOT = root;
    await writeFile(path.join(root, "public.jpg"), "public-bytes");
    await writeFile(path.join(root, "private.jpg"), "private-bytes");
    vi.mocked(authorizedPublishedCmsMedia).mockResolvedValueOnce({ documentId: "publicDoc", url: "/uploads/public.jpg", mime: "image/jpeg", size: 12 });
    const publicResponse = await GET(new Request("https://www.pastorwood.org/media/cms/publicDoc/public.jpg"), { params: Promise.resolve({ documentId: "publicDoc", filename: "public.jpg" }) });
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(await publicResponse.text()).toBe("public-bytes");

    vi.mocked(authorizedPublishedCmsMedia).mockResolvedValueOnce(null);
    const privateResponse = await GET(new Request("https://www.pastorwood.org/media/cms/privateDoc/private.jpg"), { params: Promise.resolve({ documentId: "privateDoc", filename: "private.jpg" }) });
    expect(privateResponse.status).toBe(404);
  });
});
