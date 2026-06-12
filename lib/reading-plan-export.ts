import "server-only";

import { fetchFullScripture, type ReadingPlanResult, type ScripturePreview } from "@/lib/reading-plan";

type ExportDay = ReadingPlanResult["outline"][number] & {
  generated?: ReadingPlanResult["generatedDays"][number];
  scripture?: ScripturePreview;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function textBlocks(value: string) {
  return value
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "aic-reading-plan";
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function timeLabel(source: ReadingPlanResult["sources"][number]) {
  if (!source.startTime && !source.endTime) {
    return "source context";
  }

  if (!source.endTime) {
    return source.startTime;
  }

  return `${source.startTime}-${source.endTime}`;
}

function renderScripture(scripture: ScripturePreview | undefined) {
  if (!scripture) {
    return `<section class="scripture"><p>Scripture text unavailable.</p></section>`;
  }

  const body = scripture.text || scripture.error || "Scripture text unavailable.";

  return `<section class="scripture">
    <h4>${escapeHtml(scripture.reference)}</h4>
    ${textBlocks(body)}
    ${scripture.note ? `<p class="small">${escapeHtml(scripture.note)}</p>` : ""}
    <p class="small">${escapeHtml(scripture.copyright)}</p>
  </section>`;
}

function renderGeneratedStudy(day: ExportDay) {
  if (!day.generated) {
    return "";
  }

  const prompts = day.generated.reflectionPrompts.length > 0
    ? `<section class="prompts"><h4>Reflection</h4><ul>${day.generated.reflectionPrompts
        .map((prompt) => `<li>${escapeHtml(prompt)}</li>`)
        .join("")}</ul></section>`
    : "";
  const citations = day.generated.citations.length > 0
    ? `<p class="citations">Citations: ${day.generated.citations.map((citation) => `[${escapeHtml(citation)}]`).join(" ")}</p>`
    : "";

  return `<p class="anchor">${escapeHtml(day.generated.scriptureAnchor)}</p>
  <section class="reading">${textBlocks(day.generated.expositoryReading)}</section>
  ${prompts}
  ${citations}`;
}

function renderDay(day: ExportDay) {
  const title = day.generated?.title || day.titleSeed;

  return `<article class="day">
    <header>
      <span>Day ${day.day}</span>
      <div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(day.reference)}</p>
      </div>
    </header>
    ${renderScripture(day.scripture)}
    ${renderGeneratedStudy(day)}
  </article>`;
}

export function readingPlanExportFilename(plan: ReadingPlanResult) {
  return `${slugify(plan.title)}.html`;
}

export async function buildReadingPlanExportHtml(plan: ReadingPlanResult) {
  const generatedByDay = new Map(plan.generatedDays.map((day) => [day.day, day]));
  const scriptures = await mapWithConcurrency(plan.outline, 2, async (item) => ({
    day: item.day,
    scripture: await fetchFullScripture(item.reference, plan.translationId),
  }));
  const scriptureByDay = new Map(scriptures.map((entry) => [entry.day, entry.scripture]));
  const days: ExportDay[] = plan.outline.map((item) => ({
    ...item,
    generated: generatedByDay.get(item.day),
    scripture: scriptureByDay.get(item.day),
  }));
  const generatedDate = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const selectedBooks = plan.selectedBooks.length > 0 ? plan.selectedBooks.join(", ") : "not limited";
  const topic = plan.topic.trim() || "none";
  const sources = plan.sources.length > 0
    ? `<section class="sources">
        <h2>Archive Sources</h2>
        ${plan.sources
          .map((source) => `<article>
            <h3>[${escapeHtml(source.citationId)}] ${escapeHtml(source.title)}</h3>
            <p class="small">Track ${escapeHtml(source.trackId)} · ${escapeHtml(source.publishDate)} · ${escapeHtml(source.sourceType)} · ${escapeHtml(timeLabel(source))}</p>
            ${textBlocks(source.snippet)}
          </article>`)
          .join("")}
      </section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(plan.title)}</title>
  <style>
    :root { color-scheme: light; --ink: #202b33; --muted: #5f6b70; --line: #d6cdbb; --paper: #fbf3e7; --soft: #f4ead9; --accent: #245d43; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #eaf1ef; color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; line-height: 1.65; }
    main { width: min(920px, calc(100vw - 32px)); margin: 0 auto; padding: 36px 0 56px; }
    h1, h2, h3, h4, p { margin-top: 0; }
    h1 { margin-bottom: 8px; font-size: 2rem; line-height: 1.15; }
    h2 { margin: 32px 0 14px; font-size: 1.2rem; }
    h3 { margin-bottom: 4px; font-size: 1.05rem; }
    h4 { margin-bottom: 8px; font-size: 0.92rem; }
    .meta, .notice, .day, .sources article { border: 1px solid var(--line); border-radius: 8px; background: var(--paper); }
    .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 20px; margin: 20px 0; padding: 14px; }
    .meta span, .small { color: var(--muted); font-size: 0.82rem; }
    .notice { margin-bottom: 18px; padding: 12px 14px; background: #edf5eb; color: var(--accent); font-weight: 650; }
    .day { margin: 16px 0; padding: 18px; }
    .day header { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 14px; align-items: start; margin-bottom: 14px; }
    .day header > span { display: inline-flex; min-height: 34px; align-items: center; justify-content: center; border: 1px solid var(--line); border-radius: 7px; background: var(--soft); color: var(--accent); font-weight: 800; }
    .day header p, .anchor { color: var(--accent); font-weight: 650; }
    .scripture { margin-bottom: 14px; border: 1px solid var(--line); border-radius: 8px; padding: 14px; background: var(--soft); }
    .scripture p, .reading p { white-space: pre-wrap; }
    .prompts { margin-top: 16px; }
    .prompts ul { margin: 0; padding-left: 20px; }
    .citations { color: var(--accent); font-weight: 700; }
    .sources article { margin: 10px 0; padding: 14px; }
    @media print { body { background: white; } main { width: auto; padding: 0; } .day, .sources article { break-inside: avoid; } }
    @media (max-width: 680px) { .meta, .day header { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <p class="small">Abiding in Christ reading plan · Exported ${escapeHtml(generatedDate)}</p>
    <h1>${escapeHtml(plan.title)}</h1>
    <section class="meta">
      <div><span>Length</span><br><strong>${plan.durationDays} days</strong></div>
      <div><span>Translation</span><br><strong>${escapeHtml(plan.translationId)}</strong></div>
      <div><span>Coverage</span><br><strong>${escapeHtml(plan.coverageLabel)}</strong></div>
      <div><span>Selected books</span><br><strong>${escapeHtml(selectedBooks)}</strong></div>
      <div><span>Focus</span><br><strong>${escapeHtml(topic)}</strong></div>
      <div><span>Model</span><br><strong>${escapeHtml(plan.provider)} / ${escapeHtml(plan.model)}</strong></div>
    </section>
    <p class="notice">Generated AIC study material. Archive sources inform the note; the prose is not a verbatim sermon transcript. This file includes full Scripture text for every scheduled reading that the Bible API returned.</p>
    <section>
      <h2>Daily Readings</h2>
      ${days.map(renderDay).join("")}
    </section>
    <section>
      <h2>Coverage</h2>
      ${textBlocks(plan.sourceSummary)}
    </section>
    ${sources}
  </main>
</body>
</html>`;
}
