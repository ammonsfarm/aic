import { createElement } from "react";
import { renderToString } from "react-dom/server";
import sanitizeHtml from "sanitize-html";
import { describe, expect, it } from "vitest";

import { AdminConsole } from "@/components/admin-console";

const settingsEmail = "settings-owner@example.test";
const userEmail = "admin-user@example.test";

function textContent(markup: string) {
  return sanitizeHtml(markup, {
    allowedTags: [],
    allowedAttributes: {},
  });
}

function visibleTextNodeContaining(value: string) {
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`>[^<]*${escapedValue}[^<]*<`);
}

describe("admin email hydration", () => {
  it("keeps displayed emails out of raw SSR while preserving exact text and labels", () => {
    const markup = renderToString(createElement(AdminConsole, {
      initialSettings: {
        provider: "silo",
        model: "test-model",
        effectiveModel: "test-model",
        reasoningEffort: "medium",
        retrieval: {
          archiveTopK: 8,
          archiveMaxSources: 8,
          researchSourceBudget: 20,
          researchCandidateEpisodes: 8,
          researchSummaryEpisodes: 4,
          researchDetailExcerpts: 12,
          researchMaxSources: 20,
          researchInterviewInventoryLimit: 40,
          researchInterviewMaxSources: 20,
        },
        hasSystemApiKey: false,
        systemApiKeyUpdatedAt: null,
        updatedBy: settingsEmail,
        updatedAt: "2026-06-24T19:17:34.000Z",
      },
      initialUsers: [
        {
          clerkUserId: "user_fixture",
          email: userEmail,
          name: "Admin Fixture",
          role: "Admin",
          lastSeenAt: "2026-07-30T05:57:37.000Z",
          updatedAt: "2026-07-30T05:57:37.000Z",
        },
      ],
      initialModelCatalog: {
        models: [
          {
            id: "test-model",
            displayName: "Test model",
            provider: "silo",
            ownedBy: "fixture",
            availability: "available",
            reasoningEffortLevels: ["medium"],
          },
        ],
        source: "fixture",
        error: "",
      },
    }));

    expect(markup).not.toMatch(visibleTextNodeContaining(settingsEmail));
    expect(markup).not.toMatch(visibleTextNodeContaining(userEmail));
    expect(markup).toContain("<span><span>settings-owner</span><span>@</span><span>example.test</span></span>");
    expect(markup).toContain("<span><span>admin-user</span><span>@</span><span>example.test</span></span>");

    const renderedText = textContent(markup);
    expect(renderedText).toContain(`by ${settingsEmail}`);
    expect(renderedText).toContain(userEmail);

    expect(markup).toContain(`aria-label="Role for ${userEmail}"`);
    expect(markup).not.toContain("aria-hidden");
    expect(markup).not.toContain("suppressHydrationWarning");
  });
});
