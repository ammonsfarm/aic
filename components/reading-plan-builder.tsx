"use client";

import { type FormEvent, type MouseEvent, useMemo, useState } from "react";

type ReadingPlanDay = {
  day: number;
  title: string;
  reference: string;
  scriptureAnchor: string;
  expositoryReading: string;
  reflectionPrompts: string[];
  citations: string[];
  cycleNote?: string;
  scripture?: {
    reference: string;
    displayReference: string;
    bibleId: string;
    text: string;
    copyright: string;
    note?: string;
    error?: string;
  };
};

type ReadingPlanSource = {
  citationId: string;
  sourceType: string;
  trackId: string;
  title: string;
  publishDate: string;
  segmentId: string;
  snippet: string;
  startTime: string;
  endTime: string;
  score: number;
  vectorModel: string;
};

type ReadingPlanResult = {
  title: string;
  scope: string;
  durationDays: number;
  translationId: string;
  topic: string;
  selectedBooks: string[];
  coverageLabel: "direct" | "thematic" | "style-guided";
  sourceSummary: string;
  generatedDays: ReadingPlanDay[];
  outline: Array<{
    day: number;
    reference: string;
    titleSeed: string;
    cycleNote?: string;
  }>;
  sources: ReadingPlanSource[];
  provider: string;
  model: string;
};

const durationOptions = [
  { value: 30, label: "1 month" },
  { value: 60, label: "2 months" },
  { value: 90, label: "3 months" },
  { value: 180, label: "6 months" },
  { value: 365, label: "1 year" },
];

const scopeOptions = [
  { value: "whole-bible", label: "Whole Bible" },
  { value: "old-new", label: "Old + New Testament" },
  { value: "new-testament", label: "New Testament" },
  { value: "gospels", label: "Gospels" },
  { value: "epistles", label: "Epistles" },
  { value: "wisdom", label: "Psalms + Wisdom" },
  { value: "specific-books", label: "Specific book(s)" },
  { value: "topic", label: "Topic path" },
  { value: "custom", label: "Custom topic" },
];

const oldTestamentBooks = [
  "Genesis",
  "Exodus",
  "Leviticus",
  "Numbers",
  "Deuteronomy",
  "Joshua",
  "Judges",
  "Ruth",
  "1 Samuel",
  "2 Samuel",
  "1 Kings",
  "2 Kings",
  "1 Chronicles",
  "2 Chronicles",
  "Ezra",
  "Nehemiah",
  "Esther",
  "Job",
  "Psalms",
  "Proverbs",
  "Ecclesiastes",
  "Song of Solomon",
  "Isaiah",
  "Jeremiah",
  "Lamentations",
  "Ezekiel",
  "Daniel",
  "Hosea",
  "Joel",
  "Amos",
  "Obadiah",
  "Jonah",
  "Micah",
  "Nahum",
  "Habakkuk",
  "Zephaniah",
  "Haggai",
  "Zechariah",
  "Malachi",
];

const newTestamentBooks = [
  "Matthew",
  "Mark",
  "Luke",
  "John",
  "Acts",
  "Romans",
  "1 Corinthians",
  "2 Corinthians",
  "Galatians",
  "Ephesians",
  "Philippians",
  "Colossians",
  "1 Thessalonians",
  "2 Thessalonians",
  "1 Timothy",
  "2 Timothy",
  "Titus",
  "Philemon",
  "Hebrews",
  "James",
  "1 Peter",
  "2 Peter",
  "1 John",
  "2 John",
  "3 John",
  "Jude",
  "Revelation",
];

function timeLabel(source: ReadingPlanSource) {
  if (!source.startTime && !source.endTime) {
    return "source context";
  }

  if (!source.endTime) {
    return source.startTime;
  }

  return `${source.startTime}-${source.endTime}`;
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "aic-reading-plan";
}

function planToText(result: ReadingPlanResult) {
  const days = result.generatedDays
    .map((day) => {
      const prompts = day.reflectionPrompts.map((prompt) => `- ${prompt}`).join("\n");
      return [
        `Day ${day.day}: ${day.title}`,
        day.reference,
        day.scriptureAnchor,
        "",
        day.expositoryReading,
        prompts ? `\nReflection:\n${prompts}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
  const outline = result.outline.map((item) => `Day ${item.day}: ${item.reference}`).join("\n");

  return `${result.title}\n${result.durationDays} days\n\n${days}\n\nOutline\n${outline}`;
}

function downloadFilename(result: ReadingPlanResult, disposition: string | null) {
  const match = disposition?.match(/filename="([^"]+)"/i);
  return match?.[1] || `${slugify(result.title)}.html`;
}

export function ReadingPlanBuilder() {
  const [durationDays, setDurationDays] = useState(30);
  const [scope, setScope] = useState("whole-bible");
  const [translationId, setTranslationId] = useState("");
  const [topic, setTopic] = useState("");
  const [selectedBooks, setSelectedBooks] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [downloadStatus, setDownloadStatus] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [result, setResult] = useState<ReadingPlanResult | null>(null);

  const showBookPicker = scope === "specific-books";
  const selectedBookLabel = useMemo(() => {
    if (selectedBooks.length === 0) {
      return "Choose book(s)";
    }

    if (selectedBooks.length <= 3) {
      return selectedBooks.join(", ");
    }

    return `${selectedBooks.slice(0, 3).join(", ")} +${selectedBooks.length - 3}`;
  }, [selectedBooks]);
  const remainingOutline = useMemo(() => result?.outline.slice(result.generatedDays.length) ?? [], [result]);
  const createDisabled = isLoading || (showBookPicker && selectedBooks.length === 0);

  const toggleBook = (book: string) => {
    setSelectedBooks((current) => {
      if (current.includes(book)) {
        return current.filter((entry) => entry !== book);
      }

      return [...current, book];
    });
  };

  const closeBookSelect = (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.closest("details")?.removeAttribute("open");
  };

  const renderBookGroup = (label: string, books: string[]) => (
    <div className="book-select__group">
      <strong>{label}</strong>
      <div className="book-select__options">
        {books.map((book) => (
          <label key={book}>
            <input
              type="checkbox"
              checked={selectedBooks.includes(book)}
              onChange={() => toggleBook(book)}
            />
            <span>{book}</span>
          </label>
        ))}
      </div>
    </div>
  );

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading) {
      return;
    }

    setIsLoading(true);
    setErrorMessage("");
    setCopyStatus("");
    setDownloadStatus("");

    try {
      const response = await fetch("/api/reading-plan/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          durationDays,
          scope,
          topic: topic.trim(),
          translationId: translationId.trim() || undefined,
          selectedBooks: showBookPicker ? selectedBooks : undefined,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as ReadingPlanResult & { error?: string };

      if (!response.ok) {
        setErrorMessage(body.error ?? `Request failed (${response.status})`);
        return;
      }

      setResult(body);
    } catch {
      setErrorMessage("Unable to reach the reading-plan endpoint.");
    } finally {
      setIsLoading(false);
    }
  };

  const onCopy = async () => {
    if (!result) {
      return;
    }

    try {
      await navigator.clipboard.writeText(planToText(result));
      setCopyStatus("Copied");
      window.setTimeout(() => setCopyStatus(""), 1800);
    } catch {
      setCopyStatus("Copy failed");
    }
  };

  const onDownloadHtml = async () => {
    if (!result || isDownloading) {
      return;
    }

    setIsDownloading(true);
    setDownloadStatus("");
    setErrorMessage("");

    try {
      const response = await fetch("/api/reading-plan/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ plan: result }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(body.error ?? `Export failed (${response.status})`);
        setDownloadStatus("Export failed");
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadFilename(result, response.headers.get("content-disposition"));
      link.target = "_blank";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
      setDownloadStatus("Downloaded");
      window.setTimeout(() => setDownloadStatus(""), 1800);
    } catch {
      setErrorMessage("Unable to export the reading plan.");
      setDownloadStatus("Export failed");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="reading-plan-builder">
      <form className="reading-plan-form" onSubmit={onSubmit}>
        <label>
          <span>Length</span>
          <select value={durationDays} onChange={(event) => setDurationDays(Number(event.target.value))}>
            {durationOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Scope</span>
          <select value={scope} onChange={(event) => setScope(event.target.value)}>
            {scopeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {showBookPicker ? (
          <fieldset className="reading-plan-form__books">
            <legend>Books</legend>
            <details className="book-select">
              <summary>{selectedBookLabel}</summary>
              <div className="book-select__panel">
                <div className="book-select__actions">
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={(event) => {
                      setSelectedBooks(newTestamentBooks);
                      closeBookSelect(event);
                    }}
                  >
                    New Testament
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={(event) => {
                      setSelectedBooks(["Mark"]);
                      closeBookSelect(event);
                    }}
                  >
                    Mark
                  </button>
                  <button type="button" className="button button--ghost" onClick={() => setSelectedBooks([])}>
                    Clear
                  </button>
                </div>
                {renderBookGroup("Old Testament", oldTestamentBooks)}
                {renderBookGroup("New Testament", newTestamentBooks)}
                <div className="book-select__done">
                  <button type="button" className="button button--primary" onClick={closeBookSelect}>
                    Done
                  </button>
                </div>
              </div>
            </details>
          </fieldset>
        ) : null}

        <label>
          <span>Translation</span>
          <select value={translationId} onChange={(event) => setTranslationId(event.target.value)}>
            <option value="">Server default</option>
            <option value="111">YouVersion Bible 111</option>
          </select>
        </label>

        <label className="reading-plan-form__focus">
          <span>Focus</span>
          <input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            maxLength={180}
            placeholder={showBookPicker ? "Optional focus within the selected book(s)" : "Abiding in Christ, covenant, prayer, suffering, Romans..."}
          />
        </label>

        <button className="button button--primary" type="submit" disabled={createDisabled}>
          {isLoading ? "Generating..." : "Create Plan"}
        </button>
      </form>

      {errorMessage ? <p className="empty-state empty-state--error">{errorMessage}</p> : null}

      {result ? (
        <section className="reading-plan-result" aria-live="polite">
          <div className="reading-plan-result__head">
            <div>
              <p className="eyebrow">Generated plan</p>
              <h2>{result.title}</h2>
              <p>
                {result.durationDays} days · {result.translationId} · {result.coverageLabel}
                {result.selectedBooks.length > 0 ? ` · ${result.selectedBooks.join(", ")}` : ""}
              </p>
            </div>
            <div className="reading-plan-result__actions">
              <span>{result.provider} / {result.model}</span>
              <button className="button button--ghost" type="button" onClick={onDownloadHtml} disabled={isDownloading}>
                {isDownloading ? "Preparing HTML..." : downloadStatus || "Download HTML"}
              </button>
              <button className="button button--ghost" type="button" onClick={onCopy}>
                {copyStatus || "Copy"}
              </button>
            </div>
          </div>

          <p className="reading-plan-disclosure">
            Generated AIC study material. Archive sources inform the note; the prose is not a verbatim sermon transcript.
            HTML export fetches full Scripture text for every scheduled reading and includes generated study notes where available.
          </p>

          <div className="reading-plan-grid">
            <div className="reading-plan-days">
              {result.generatedDays.map((day) => (
                <article key={day.day} className="reading-plan-day">
                  <div className="reading-plan-day__head">
                    <span>Day {day.day}</span>
                    <div>
                      <h3>{day.title}</h3>
                      <p>{day.reference}</p>
                    </div>
                  </div>

                  {day.scripture ? (
                    <div className="reading-plan-scripture">
                      <strong>{day.scripture.displayReference}</strong>
                      {day.scripture.text ? <p>{day.scripture.text}</p> : <p>{day.scripture.error ?? "Scripture text unavailable."}</p>}
                      {day.scripture.note ? <small>{day.scripture.note}</small> : null}
                      <small>{day.scripture.copyright}</small>
                    </div>
                  ) : null}

                  <p className="reading-plan-anchor">{day.scriptureAnchor}</p>
                  <div className="reading-plan-reading">{day.expositoryReading}</div>

                  {day.reflectionPrompts.length > 0 ? (
                    <div className="reading-plan-prompts">
                      {day.reflectionPrompts.map((prompt) => (
                        <span key={prompt}>{prompt}</span>
                      ))}
                    </div>
                  ) : null}

                  {day.citations.length > 0 ? (
                    <div className="reading-plan-citations" aria-label={`Day ${day.day} citations`}>
                      {day.citations.map((citation) => (
                        <span key={citation}>[{citation}]</span>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>

            <aside className="reading-plan-evidence">
              <div className="reading-plan-evidence__block">
                <p className="eyebrow">Coverage</p>
                <p>{result.sourceSummary}</p>
              </div>

              <div className="reading-plan-evidence__block">
                <p className="eyebrow">Remaining outline</p>
                <div className="reading-plan-outline">
                  {remainingOutline.map((item) => (
                    <div key={item.day} className="reading-plan-outline__row">
                      <span>Day {item.day}</span>
                      <strong>{item.reference}</strong>
                      <small>{item.titleSeed}</small>
                    </div>
                  ))}
                </div>
              </div>

              {result.sources.length > 0 ? (
                <div className="reading-plan-evidence__block">
                  <p className="eyebrow">Archive sources</p>
                  <div className="reading-plan-sources">
                    {result.sources.map((source) => (
                      <details key={`${source.citationId}-${source.trackId}-${source.segmentId}`}>
                        <summary>
                          [{source.citationId}] {source.title}
                        </summary>
                        <p>
                          Track {source.trackId} · {source.publishDate} · {source.sourceType} · {timeLabel(source)}
                        </p>
                        <p>{source.snippet}</p>
                      </details>
                    ))}
                  </div>
                </div>
              ) : null}
            </aside>
          </div>
        </section>
      ) : (
        <div className="reading-plan-empty">
          <strong>Plan output will appear here.</strong>
          <span>Generated notes use Scripture, retrieved archive sources, and explicit source coverage labels.</span>
        </div>
      )}
    </div>
  );
}
