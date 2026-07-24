import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CmsPageSections,
  type PastorWoodCmsSection,
} from "@/components/pastor-wood-site";

function renderSections(sections: PastorWoodCmsSection[]) {
  return renderToStaticMarkup(React.createElement(CmsPageSections, { sections }));
}

describe("public page-builder sections", () => {
  it("renders gallery, safe video, existing form, and semantic columns accessibly", () => {
    const markup = renderSections([
      {
        id: 1,
        component: "page-sections.gallery-section",
        heading: "Ministry gallery",
        galleryColumns: "four",
        images: [
          { id: 11, url: "/media/cms/one.jpg", alternativeText: "Pastor Wood teaching" },
          { id: 12, url: "/media/cms/two.jpg", alternativeText: "" },
        ],
      },
      {
        id: 2,
        component: "page-sections.embed-section",
        heading: "Watch",
        embedUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        embedTitle: "Pastor Wood teaching on grace",
        embedAspectRatio: "landscape",
      },
      {
        id: 3,
        component: "page-sections.form-section",
        heading: "Contact the ministry",
        body: "<p>We welcome your message.</p>",
        formType: "contact",
      },
      {
        id: 4,
        component: "page-sections.columns-section",
        heading: "Ways to listen",
        columnCount: "three",
        columnOneHeading: "Radio",
        columnOneBody: "<p>Listen weekdays.</p>",
        columnTwoHeading: "Podcast",
        columnTwoBody: "<p>Listen on demand.</p>",
        columnThreeHeading: "Archive",
        columnThreeBody: "<p>Browse past episodes.</p>",
      },
    ]);

    expect(markup).toContain("pw-cms-gallery__grid--four");
    expect(markup).toContain('alt="Pastor Wood teaching"');
    expect(markup).toContain('alt=""');
    expect(markup).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(markup).toContain('title="Pastor Wood teaching on grace"');
    expect(markup).toContain('sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"');
    expect(markup).toContain("pw-contact-form");
    expect(markup).toContain('aria-labelledby="cms-section-3-title"');
    expect(markup).toContain("pw-cms-columns__grid--3");
    expect(markup.indexOf("Radio")).toBeLessThan(markup.indexOf("Podcast"));
    expect(markup.indexOf("Podcast")).toBeLessThan(markup.indexOf("Archive"));
  });

  it("fails closed for an unsupported embed URL or an incomplete section", () => {
    const markup = renderSections([
      {
        component: "page-sections.embed-section",
        embedUrl: "https://evil.example/embed/video",
        embedTitle: "Untrusted video",
      },
      {
        component: "page-sections.columns-section",
        columnCount: "two",
        columnOneBody: "<p>Only one column</p>",
      },
      {
        component: "page-sections.form-section",
        heading: "Unknown form",
        formType: "",
      },
    ]);

    expect(markup).toBe("");
    expect(markup).not.toContain("iframe");
  });
});
