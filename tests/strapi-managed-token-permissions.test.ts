import { describe, expect, it } from "vitest";

import { managedPermissions } from "@/services/jimwood-cms/src/index";

describe("managed AIC Strapi token permissions", () => {
  it("can read redirects and use editorial actions but cannot call redirect core mutations", () => {
    const actions = [
      "api::editorial-event.editorial-event.find",
      "api::editorial-revision.editorial-revision.find",
      "api::editorial-workflow.editorial-workflow.create",
      "api::editorial-workflow.editorial-workflow.update",
      "api::editorial-workflow.editorial-workflow.transition",
      "api::editorial-workflow.editorial-workflow.revisions",
      "api::endorsement.endorsement.find",
      "api::episode.episode.find",
      "api::episode-processing-request.episode-processing-request.find",
      "api::media-asset.media-asset.find",
      "api::page.page.find",
      "api::person.person.find",
      "api::post.post.find",
      "api::redirect.redirect.find",
      "api::redirect.redirect.findOne",
      "api::redirect.redirect.create",
      "api::redirect.redirect.update",
      "api::redirect.redirect.delete",
      "api::site-setting.site-setting.find",
      "plugin::upload.content-api.find",
    ];
    const permissions = managedPermissions({
      contentAPI: {
        permissions: {
          providers: {
            action: new Map(actions.map((action) => [action, {}])),
          },
        },
      },
    } as never);

    expect(permissions).toContain("api::redirect.redirect.find");
    expect(permissions).toContain("api::redirect.redirect.findOne");
    expect(permissions).toContain("api::editorial-workflow.editorial-workflow.update");
    expect(permissions).toContain("api::editorial-workflow.editorial-workflow.transition");
    expect(permissions).not.toContain("api::redirect.redirect.create");
    expect(permissions).not.toContain("api::redirect.redirect.update");
    expect(permissions).not.toContain("api::redirect.redirect.delete");
  });
});
