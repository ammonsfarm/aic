import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DataFreshnessNotice, SuccessfulCheckFreshnessNotice } from "@/components/data-freshness";

describe("freshness labels", () => {
  it("keeps source-data currency distinct from successful-check recency", () => {
    const dataMarkup = renderToStaticMarkup(createElement(DataFreshnessNotice, {
      label: "Podtrac",
      freshness: {
        asOfDate: "2026-07-23",
        dataCurrentThrough: "2026-07-20",
        lagDays: 3,
        slaDays: 2,
        state: "stale",
      },
    }));
    const checkMarkup = renderToStaticMarkup(createElement(SuccessfulCheckFreshnessNotice, {
      label: "Daily ingest",
      freshness: {
        asOfDate: "2026-07-23",
        lastSuccessfulCheckDate: "2026-07-22",
        lagDays: 1,
        slaDays: 1,
        state: "current",
      },
    }));

    expect(dataMarkup).toContain("Data current through Jul 20, 2026");
    expect(dataMarkup).not.toContain("Last successful check");
    expect(checkMarkup).toContain("Last successful check Jul 22, 2026");
    expect(checkMarkup).toContain("1 day since the last successful check");
    expect(checkMarkup).not.toContain("Data current through");
    expect(dataMarkup).toContain('<article class="status-card status-item status-item--warn"');
    expect(dataMarkup).toContain('<h3 class="status-card__title">Podtrac: Stale</h3>');
    expect(checkMarkup).toContain('<p class="status-card__detail">Last successful check Jul 22, 2026.</p>');
  });
});
