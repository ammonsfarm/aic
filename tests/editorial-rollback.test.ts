import { describe, expect, it } from "vitest";

import {
  snapshotForRevision,
  writableSnapshot,
  type SnapshotSchemaResolver,
} from "@/services/jimwood-cms/src/api/editorial-workflow/controllers/editorial-snapshot";

const contentTypes = {
  "api::episode.episode": {
    attributes: {
      title: { type: "string" },
      audio: { type: "media" },
      featuredImage: { type: "media" },
      seo: { type: "component", component: "seo.metadata", repeatable: false },
    },
  },
  "api::page.page": {
    attributes: {
      title: { type: "string" },
      sections: { type: "dynamiczone" },
    },
  },
  "api::site-setting.site-setting": {
    attributes: {
      siteName: { type: "string" },
      headerLogo: { type: "media" },
      topNavigation: { type: "component", component: "navigation.navigation-item", repeatable: true },
      subscriptionEnabled: { type: "boolean" },
    },
  },
};

const components = {
  "seo.metadata": {
    attributes: {
      metaTitle: { type: "string" },
      socialImage: { type: "media" },
    },
  },
  "page-sections.image-text-section": {
    attributes: {
      heading: { type: "string" },
      image: { type: "media" },
      imageSide: { type: "enumeration" },
    },
  },
  "navigation.navigation-item": {
    attributes: {
      label: { type: "string" },
      url: { type: "string" },
      page: { type: "relation" },
      active: { type: "boolean" },
    },
  },
};

const resolver: SnapshotSchemaResolver = {
  contentTypeAttributes: (uid) => contentTypes[uid as keyof typeof contentTypes]?.attributes || {},
  componentTypeAttributes: (uid) => components[uid as keyof typeof components]?.attributes || {},
};

describe("editorial rollback snapshots", () => {
  it("preserves and restores top-level and component media references", () => {
    const snapshot = snapshotForRevision({
      id: 10,
      documentId: "episode-1",
      createdAt: "2026-07-22T10:00:00Z",
      title: "Grace",
      audio: { id: 21, url: "/uploads/grace.mp3" },
      featuredImage: { id: 22, url: "/uploads/grace.jpg" },
      seo: {
        id: 7,
        metaTitle: "Grace episode",
        socialImage: { id: 23, url: "/uploads/grace-social.jpg" },
      },
    });

    expect(snapshot).not.toHaveProperty("id");
    expect(snapshot).not.toHaveProperty("documentId");
    expect(snapshot.audio).toMatchObject({ id: 21 });
    expect((snapshot.seo as { id: number }).id).toBe(7);
    expect(writableSnapshot("api::episode.episode", snapshot, resolver)).toEqual({
      title: "Grace",
      audio: 21,
      featuredImage: 22,
      seo: {
        metaTitle: "Grace episode",
        socialImage: 23,
      },
    });
  });

  it("restores page dynamic-zone identity and nested image media", () => {
    const snapshot = snapshotForRevision({
      id: 11,
      documentId: "page-1",
      title: "About",
      sections: [{
        id: 31,
        __component: "page-sections.image-text-section",
        heading: "Pastor Wood",
        image: { id: 41, url: "/uploads/pastor-wood.jpg" },
        imageSide: "right",
      }],
    });

    expect((snapshot.sections as Array<{ id: number }>)[0].id).toBe(31);
    expect(writableSnapshot("api::page.page", snapshot, resolver)).toEqual({
      title: "About",
      sections: [{
        __component: "page-sections.image-text-section",
        heading: "Pastor Wood",
        image: 41,
        imageSide: "right",
      }],
    });
  });

  it("restores site-settings media, flags, and linked navigation pages", () => {
    const snapshot = snapshotForRevision({
      id: 12,
      documentId: "site-setting-1",
      siteName: "Abiding in Christ",
      headerLogo: { id: 61, documentId: "upload-61", url: "/uploads/logo.png" },
      subscriptionEnabled: false,
      topNavigation: [{
        id: 71,
        label: "About",
        url: "/about-pastor-wood/",
        page: { id: 81, documentId: "page-about", title: "About" },
        active: true,
      }],
    });

    expect(writableSnapshot("api::site-setting.site-setting", snapshot, resolver)).toEqual({
      siteName: "Abiding in Christ",
      headerLogo: 61,
      subscriptionEnabled: false,
      topNavigation: [{
        label: "About",
        url: "/about-pastor-wood/",
        page: { documentId: "page-about" },
        active: true,
      }],
    });
  });
});
