import "server-only";

import { callArchiveChatModel, type RagProvider } from "@/lib/rag-chat";
import { getEpisodeRagSources, getEpisodeSummarySources, type EpisodeChatSource } from "@/lib/podcast-data";

export type ReadingPlanScope =
  | "whole-bible"
  | "old-new"
  | "new-testament"
  | "gospels"
  | "epistles"
  | "wisdom"
  | "specific-books"
  | "topic"
  | "custom";

type Testament = "old" | "new";

type BibleBook = {
  name: string;
  usfm: string;
  chapters: number;
  testament: Testament;
  groups: Array<"gospels" | "epistles" | "wisdom">;
};

type ChapterRef = {
  book: string;
  chapter: number;
};

type PlannerReading = {
  day: number;
  reference: string;
  titleSeed: string;
  retrievalQuery: string;
  cycleNote?: string;
};

export type ScripturePreview = {
  reference: string;
  displayReference: string;
  bibleId: string;
  text: string;
  copyright: string;
  note?: string;
  error?: string;
};

type PlannerModelDay = {
  day: number;
  title: string;
  reference: string;
  scriptureAnchor: string;
  expositoryReading: string;
  reflectionPrompts: string[];
  citations: string[];
};

type PlannerModelResult = {
  title: string;
  coverageLabel: "direct" | "thematic" | "style-guided";
  sourceSummary: string;
  days: PlannerModelDay[];
};

export type ReadingPlanDay = PlannerModelDay & {
  scripture?: ScripturePreview;
  cycleNote?: string;
};

export type ReadingPlanSource = EpisodeChatSource & {
  citationId: string;
  snippet: string;
};

export type ReadingPlanResult = {
  title: string;
  scope: ReadingPlanScope;
  durationDays: number;
  translationId: string;
  topic: string;
  selectedBooks: string[];
  coverageLabel: PlannerModelResult["coverageLabel"];
  sourceSummary: string;
  generatedDays: ReadingPlanDay[];
  outline: Array<Pick<PlannerReading, "day" | "reference" | "titleSeed" | "cycleNote">>;
  sources: ReadingPlanSource[];
  provider: string;
  model: string;
};

type GenerateReadingPlanInput = {
  durationDays: number;
  scope: ReadingPlanScope;
  topic?: string;
  translationId?: string;
  provider?: string;
  selectedBooks?: string[];
};

type YvpBook = {
  id?: unknown;
  usfm?: unknown;
  name?: unknown;
  title?: unknown;
  full_title?: unknown;
  abbreviation?: unknown;
};

type YvpPassage = {
  displayReference: string;
  text: string;
  copyright: string;
};

type YvpPassageResult =
  | { passage: YvpPassage; error?: never }
  | { passage?: never; error: string };

const DEFAULT_BIBLE_ID = "111";
const SUPPORTED_DURATIONS = new Set([30, 60, 90, 180, 365]);
const PREVIEW_DAY_COUNT = 7;
const FULL_ONSCREEN_CHAPTER_LIMIT = 32;

const BIBLE_BOOKS: BibleBook[] = [
  { name: "Genesis", usfm: "GEN", chapters: 50, testament: "old", groups: [] },
  { name: "Exodus", usfm: "EXO", chapters: 40, testament: "old", groups: [] },
  { name: "Leviticus", usfm: "LEV", chapters: 27, testament: "old", groups: [] },
  { name: "Numbers", usfm: "NUM", chapters: 36, testament: "old", groups: [] },
  { name: "Deuteronomy", usfm: "DEU", chapters: 34, testament: "old", groups: [] },
  { name: "Joshua", usfm: "JOS", chapters: 24, testament: "old", groups: [] },
  { name: "Judges", usfm: "JDG", chapters: 21, testament: "old", groups: [] },
  { name: "Ruth", usfm: "RUT", chapters: 4, testament: "old", groups: [] },
  { name: "1 Samuel", usfm: "1SA", chapters: 31, testament: "old", groups: [] },
  { name: "2 Samuel", usfm: "2SA", chapters: 24, testament: "old", groups: [] },
  { name: "1 Kings", usfm: "1KI", chapters: 22, testament: "old", groups: [] },
  { name: "2 Kings", usfm: "2KI", chapters: 25, testament: "old", groups: [] },
  { name: "1 Chronicles", usfm: "1CH", chapters: 29, testament: "old", groups: [] },
  { name: "2 Chronicles", usfm: "2CH", chapters: 36, testament: "old", groups: [] },
  { name: "Ezra", usfm: "EZR", chapters: 10, testament: "old", groups: [] },
  { name: "Nehemiah", usfm: "NEH", chapters: 13, testament: "old", groups: [] },
  { name: "Esther", usfm: "EST", chapters: 10, testament: "old", groups: [] },
  { name: "Job", usfm: "JOB", chapters: 42, testament: "old", groups: ["wisdom"] },
  { name: "Psalms", usfm: "PSA", chapters: 150, testament: "old", groups: ["wisdom"] },
  { name: "Proverbs", usfm: "PRO", chapters: 31, testament: "old", groups: ["wisdom"] },
  { name: "Ecclesiastes", usfm: "ECC", chapters: 12, testament: "old", groups: ["wisdom"] },
  { name: "Song of Solomon", usfm: "SNG", chapters: 8, testament: "old", groups: ["wisdom"] },
  { name: "Isaiah", usfm: "ISA", chapters: 66, testament: "old", groups: [] },
  { name: "Jeremiah", usfm: "JER", chapters: 52, testament: "old", groups: [] },
  { name: "Lamentations", usfm: "LAM", chapters: 5, testament: "old", groups: [] },
  { name: "Ezekiel", usfm: "EZK", chapters: 48, testament: "old", groups: [] },
  { name: "Daniel", usfm: "DAN", chapters: 12, testament: "old", groups: [] },
  { name: "Hosea", usfm: "HOS", chapters: 14, testament: "old", groups: [] },
  { name: "Joel", usfm: "JOL", chapters: 3, testament: "old", groups: [] },
  { name: "Amos", usfm: "AMO", chapters: 9, testament: "old", groups: [] },
  { name: "Obadiah", usfm: "OBA", chapters: 1, testament: "old", groups: [] },
  { name: "Jonah", usfm: "JON", chapters: 4, testament: "old", groups: [] },
  { name: "Micah", usfm: "MIC", chapters: 7, testament: "old", groups: [] },
  { name: "Nahum", usfm: "NAM", chapters: 3, testament: "old", groups: [] },
  { name: "Habakkuk", usfm: "HAB", chapters: 3, testament: "old", groups: [] },
  { name: "Zephaniah", usfm: "ZEP", chapters: 3, testament: "old", groups: [] },
  { name: "Haggai", usfm: "HAG", chapters: 2, testament: "old", groups: [] },
  { name: "Zechariah", usfm: "ZEC", chapters: 14, testament: "old", groups: [] },
  { name: "Malachi", usfm: "MAL", chapters: 4, testament: "old", groups: [] },
  { name: "Matthew", usfm: "MAT", chapters: 28, testament: "new", groups: ["gospels"] },
  { name: "Mark", usfm: "MRK", chapters: 16, testament: "new", groups: ["gospels"] },
  { name: "Luke", usfm: "LUK", chapters: 24, testament: "new", groups: ["gospels"] },
  { name: "John", usfm: "JHN", chapters: 21, testament: "new", groups: ["gospels"] },
  { name: "Acts", usfm: "ACT", chapters: 28, testament: "new", groups: [] },
  { name: "Romans", usfm: "ROM", chapters: 16, testament: "new", groups: ["epistles"] },
  { name: "1 Corinthians", usfm: "1CO", chapters: 16, testament: "new", groups: ["epistles"] },
  { name: "2 Corinthians", usfm: "2CO", chapters: 13, testament: "new", groups: ["epistles"] },
  { name: "Galatians", usfm: "GAL", chapters: 6, testament: "new", groups: ["epistles"] },
  { name: "Ephesians", usfm: "EPH", chapters: 6, testament: "new", groups: ["epistles"] },
  { name: "Philippians", usfm: "PHP", chapters: 4, testament: "new", groups: ["epistles"] },
  { name: "Colossians", usfm: "COL", chapters: 4, testament: "new", groups: ["epistles"] },
  { name: "1 Thessalonians", usfm: "1TH", chapters: 5, testament: "new", groups: ["epistles"] },
  { name: "2 Thessalonians", usfm: "2TH", chapters: 3, testament: "new", groups: ["epistles"] },
  { name: "1 Timothy", usfm: "1TI", chapters: 6, testament: "new", groups: ["epistles"] },
  { name: "2 Timothy", usfm: "2TI", chapters: 4, testament: "new", groups: ["epistles"] },
  { name: "Titus", usfm: "TIT", chapters: 3, testament: "new", groups: ["epistles"] },
  { name: "Philemon", usfm: "PHM", chapters: 1, testament: "new", groups: ["epistles"] },
  { name: "Hebrews", usfm: "HEB", chapters: 13, testament: "new", groups: ["epistles"] },
  { name: "James", usfm: "JAS", chapters: 5, testament: "new", groups: ["epistles"] },
  { name: "1 Peter", usfm: "1PE", chapters: 5, testament: "new", groups: ["epistles"] },
  { name: "2 Peter", usfm: "2PE", chapters: 3, testament: "new", groups: ["epistles"] },
  { name: "1 John", usfm: "1JN", chapters: 5, testament: "new", groups: ["epistles"] },
  { name: "2 John", usfm: "2JN", chapters: 1, testament: "new", groups: ["epistles"] },
  { name: "3 John", usfm: "3JN", chapters: 1, testament: "new", groups: ["epistles"] },
  { name: "Jude", usfm: "JUD", chapters: 1, testament: "new", groups: ["epistles"] },
  { name: "Revelation", usfm: "REV", chapters: 22, testament: "new", groups: [] },
];

const TOPICAL_BANK: Array<{ reference: string; titleSeed: string; query: string }> = [
  { reference: "Genesis 12", titleSeed: "Promise and pilgrimage", query: "covenant promise Abraham faith" },
  { reference: "Exodus 12", titleSeed: "Redemption and substitute", query: "passover redemption blood lamb" },
  { reference: "Deuteronomy 6", titleSeed: "Love and remembrance", query: "love the Lord teach children remembrance" },
  { reference: "Psalms 23", titleSeed: "The shepherd's care", query: "Psalm 23 shepherd trust" },
  { reference: "Psalms 51", titleSeed: "Repentance and mercy", query: "repentance mercy confession David" },
  { reference: "Isaiah 53", titleSeed: "The suffering servant", query: "Isaiah 53 suffering servant Christ" },
  { reference: "Matthew 5", titleSeed: "Kingdom righteousness", query: "Sermon on the Mount righteousness kingdom" },
  { reference: "Matthew 11:25-30", titleSeed: "Rest under Christ's yoke", query: "rest weary yoke Christ" },
  { reference: "Mark 8", titleSeed: "The way of the cross", query: "take up cross discipleship" },
  { reference: "Luke 15", titleSeed: "Lost and found", query: "prodigal son lost sheep grace repentance" },
  { reference: "John 1", titleSeed: "The Word made flesh", query: "Word became flesh Christ incarnation" },
  { reference: "John 15", titleSeed: "Abiding in Christ", query: "abide vine branches fruit" },
  { reference: "Acts 2", titleSeed: "Word, Spirit, and church", query: "Pentecost church apostles teaching" },
  { reference: "Romans 5", titleSeed: "Grace that reigns", query: "justification grace Adam Christ" },
  { reference: "Romans 8", titleSeed: "Life in the Spirit", query: "Romans 8 Spirit adoption suffering glory" },
  { reference: "Ephesians 2", titleSeed: "Grace and workmanship", query: "saved by grace workmanship church" },
  { reference: "Philippians 2", titleSeed: "The mind of Christ", query: "humility Christ servant" },
  { reference: "Hebrews 12", titleSeed: "Endurance and discipline", query: "endurance discipline race faith" },
  { reference: "James 1", titleSeed: "Trials and wisdom", query: "trials steadfastness wisdom" },
  { reference: "1 Peter 1", titleSeed: "Living hope", query: "living hope suffering holiness" },
];

let yvpBooksPromise: Promise<YvpBook[]> | null = null;

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function truncateText(value: string, maxLength: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expandBooks(books: BibleBook[]) {
  return books.flatMap((book) =>
    Array.from({ length: book.chapters }, (_, index) => ({
      book: book.name,
      chapter: index + 1,
    })),
  );
}

function booksForScope(scope: ReadingPlanScope) {
  switch (scope) {
    case "new-testament":
      return BIBLE_BOOKS.filter((book) => book.testament === "new");
    case "gospels":
      return BIBLE_BOOKS.filter((book) => book.groups.includes("gospels"));
    case "epistles":
      return BIBLE_BOOKS.filter((book) => book.groups.includes("epistles"));
    case "wisdom":
      return BIBLE_BOOKS.filter((book) => book.groups.includes("wisdom"));
    case "specific-books":
      return [];
    case "whole-bible":
    default:
      return BIBLE_BOOKS;
  }
}

function selectedBooksForInput(selectedBooks: string[] | undefined) {
  const requested = new Set((selectedBooks ?? []).map((book) => normalizeName(book)).filter(Boolean));

  if (requested.size === 0) {
    return [];
  }

  return BIBLE_BOOKS.filter((book) => requested.has(normalizeName(book.name)) || requested.has(normalizeName(book.usfm)));
}

export function resolveReadingPlanBookNames(selectedBooks: string[] | undefined) {
  return selectedBooksForInput(selectedBooks).map((book) => book.name);
}

function formatChapterGroup(group: ChapterRef[]) {
  const start = group[0];
  const end = group[group.length - 1];

  if (!start || !end) {
    return "";
  }

  if (start.chapter === end.chapter) {
    return `${start.book} ${start.chapter}`;
  }

  return `${start.book} ${start.chapter}-${end.chapter}`;
}

function formatChapterRange(chapters: ChapterRef[]) {
  const groups: ChapterRef[][] = [];

  chapters.forEach((chapter) => {
    const current = groups[groups.length - 1];
    if (current?.[0]?.book === chapter.book) {
      current.push(chapter);
      return;
    }

    groups.push([chapter]);
  });

  return groups.map(formatChapterGroup).filter(Boolean).join("; ");
}

function chunkChapters(chapters: ChapterRef[], durationDays: number) {
  if (chapters.length === 0) {
    return [];
  }

  return Array.from({ length: durationDays }, (_, index) => {
    if (durationDays > chapters.length) {
      return [chapters[index % chapters.length]];
    }

    const start = Math.floor((index * chapters.length) / durationDays);
    const end = Math.max(start + 1, Math.floor(((index + 1) * chapters.length) / durationDays));
    return chapters.slice(start, end);
  });
}

function buildSpecificBookReadings(books: BibleBook[], durationDays: number, topic: string): PlannerReading[] {
  const bookLabel = books.map((book) => book.name).join(", ");

  if (books.length > 1) {
    const bookChunks = books.map((book) => ({
      book,
      chunks: chunkChapters(expandBooks([book]), durationDays),
      repeats: durationDays > book.chapters,
    }));

    return Array.from({ length: durationDays }, (_, index) => {
      const reference = bookChunks
        .map(({ chunks }) => formatChapterRange(chunks[index] ?? []))
        .filter(Boolean)
        .join("; ");
      const repeats = bookChunks.some(({ repeats: bookRepeats }) => bookRepeats);

      return {
        day: index + 1,
        reference,
        titleSeed: bookLabel,
        retrievalQuery: `${reference} ${topic} ${bookLabel} parallel themes expository sermon`.trim(),
        cycleNote: repeats ? "At least one shorter selected book repeats after its full pass." : undefined,
      };
    });
  }

  const selectedChapters = expandBooks(books);
  const chunks = chunkChapters(selectedChapters, durationDays);
  const repeats = durationDays > selectedChapters.length;

  return chunks.map((chunk, index) => {
    const reference = formatChapterRange(chunk);

    return {
      day: index + 1,
      reference,
      titleSeed: bookLabel,
      retrievalQuery: `${reference} ${topic} ${bookLabel} expository sermon`.trim(),
      cycleNote: repeats ? "This shorter book selection repeats after the full pass." : undefined,
    };
  });
}

function buildChapterReadings(
  scope: ReadingPlanScope,
  durationDays: number,
  topic: string,
  selectedBooks: BibleBook[],
): PlannerReading[] {
  const scopeLabel = scopeLabelForPrompt(scope);

  if (scope === "specific-books") {
    return buildSpecificBookReadings(selectedBooks, durationDays, topic);
  }

  if (scope === "old-new") {
    const oldChapters = expandBooks(BIBLE_BOOKS.filter((book) => book.testament === "old"));
    const newChapters = expandBooks(BIBLE_BOOKS.filter((book) => book.testament === "new"));
    const oldChunks = chunkChapters(oldChapters, durationDays);
    const newChunks = chunkChapters(newChapters, durationDays);

    return Array.from({ length: durationDays }, (_, index) => {
      const reference = [formatChapterRange(oldChunks[index] ?? []), formatChapterRange(newChunks[index] ?? [])]
        .filter(Boolean)
        .join("; ");

      return {
        day: index + 1,
        reference,
        titleSeed: "Old and New Testament witness",
        retrievalQuery: `${reference} ${topic} Old Testament New Testament Christ expository sermon`.trim(),
      };
    });
  }

  const selectedChapters = expandBooks(booksForScope(scope));
  const chunks = chunkChapters(selectedChapters, durationDays);
  const repeats = durationDays > selectedChapters.length;

  return chunks.map((chunk, index) => {
    const reference = formatChapterRange(chunk);

    return {
      day: index + 1,
      reference,
      titleSeed: scopeLabel,
      retrievalQuery: `${reference} ${topic} ${scopeLabel} expository sermon`.trim(),
      cycleNote: repeats ? "This shorter section repeats after the full pass." : undefined,
    };
  });
}

function buildTopicReadings(scope: ReadingPlanScope, durationDays: number, topic: string): PlannerReading[] {
  const focus = topic || (scope === "custom" ? "custom study" : "Christ-centered discipleship");

  return Array.from({ length: durationDays }, (_, index) => {
    const seed = TOPICAL_BANK[index % TOPICAL_BANK.length];

    return {
      day: index + 1,
      reference: seed.reference,
      titleSeed: seed.titleSeed,
      retrievalQuery: `${focus} ${seed.query} ${seed.reference} Pastor Wood expository sermon`,
      cycleNote: durationDays > TOPICAL_BANK.length ? "The topical path revisits anchor passages with a fresh focus." : undefined,
    };
  });
}

function buildReadings(scope: ReadingPlanScope, durationDays: number, topic: string, selectedBooks: BibleBook[]) {
  if (scope === "topic" || scope === "custom") {
    return buildTopicReadings(scope, durationDays, topic);
  }

  return buildChapterReadings(scope, durationDays, topic, selectedBooks);
}

function scopeLabelForPrompt(scope: ReadingPlanScope) {
  switch (scope) {
    case "old-new":
      return "Old and New Testament";
    case "new-testament":
      return "New Testament";
    case "gospels":
      return "Gospels";
    case "epistles":
      return "Epistles";
    case "wisdom":
      return "Psalms and wisdom books";
    case "specific-books":
      return "Specific Bible books";
    case "topic":
      return "Topical study";
    case "custom":
      return "Custom study";
    case "whole-bible":
    default:
      return "Whole Bible";
  }
}

function yvpKey() {
  return (process.env["x-yvp-app-key"] || process.env.YVP_APP_KEY || "").trim();
}

async function yvpFetch(path: string) {
  const key = yvpKey();
  if (!key) {
    throw new Error("YVP_APP_KEY is not configured");
  }

  const response = await fetch(`https://api.youversion.com/v1/bibles/${path}`, {
    headers: {
      accept: "application/json",
      "X-YVP-App-Key": key,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`YouVersion request failed (${response.status}): ${detail}`);
  }

  return response.json() as Promise<unknown>;
}

async function getYvpBooks(bibleId: string) {
  if (!yvpBooksPromise) {
    yvpBooksPromise = yvpFetch(`${bibleId}/books`).then((payload) => {
      const data = payload as { data?: unknown };
      return Array.isArray(data.data) ? (data.data as YvpBook[]) : [];
    });
  }

  return yvpBooksPromise;
}

function extractPlainTextFromHtml(value: string) {
  return value
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function parseReference(reference: string) {
  const firstSection = reference.split(";")[0]?.trim() || reference.trim();
  const book = [...BIBLE_BOOKS]
    .sort((a, b) => b.name.length - a.name.length)
    .find((candidate) => new RegExp(`^${escapeRegex(candidate.name)}\\s+`, "i").test(firstSection));

  if (!book) {
    return null;
  }

  const rest = firstSection.replace(new RegExp(`^${escapeRegex(book.name)}\\s+`, "i"), "").trim();
  const match = rest.match(/^(\d+)(?:-(\d+))?(?::(\d+)(?:[-–](\d+))?)?$/);

  if (!match) {
    return null;
  }

  const [, startChapterRaw, endChapterRaw, startVerseRaw, endVerseRaw] = match;
  const startChapter = Number(startChapterRaw);
  const endChapter = endChapterRaw ? Number(endChapterRaw) : undefined;
  const startVerse = startVerseRaw ? Number(startVerseRaw) : undefined;
  const endVerse = endVerseRaw ? Number(endVerseRaw) : undefined;

  if (!Number.isFinite(startChapter)) {
    return null;
  }

  return { book, startChapter, endChapter, startVerse, endVerse, firstSection };
}

function findYvpBookId(books: YvpBook[], book: BibleBook) {
  const targetNames = new Set([normalizeName(book.name), normalizeName(book.usfm)]);
  const match = books.find((candidate) => {
    const values = [candidate.name, candidate.title, candidate.full_title, candidate.abbreviation, candidate.usfm, candidate.id]
      .map((value) => (typeof value === "string" ? normalizeName(value) : ""))
      .filter(Boolean);

    return values.some((value) => targetNames.has(value));
  });

  const id = match?.id || match?.usfm || book.usfm;
  return typeof id === "string" ? id : book.usfm;
}

function buildPassageId(bookId: string, parsed: NonNullable<ReturnType<typeof parseReference>>) {
  if (parsed.startVerse) {
    return `${bookId}.${parsed.startChapter}.${parsed.startVerse}${parsed.endVerse ? `-${parsed.endVerse}` : ""}`;
  }

  if (parsed.endChapter && parsed.endChapter !== parsed.startChapter) {
    return `${bookId}.${parsed.startChapter}-${bookId}.${parsed.endChapter}`;
  }

  return `${bookId}.${parsed.startChapter}`;
}

function countReferenceChapters(reference: string) {
  return reference
    .split(";")
    .map((section) => section.trim())
    .filter(Boolean)
    .reduce((total, section) => {
      const parsed = parseReference(section);
      if (!parsed || parsed.startVerse) {
        return total + 1;
      }

      const endChapter = parsed.endChapter ?? parsed.startChapter;
      return total + Math.max(1, endChapter - parsed.startChapter + 1);
    }, 0);
}

function shouldUseFullOnscreenScripture(readings: PlannerReading[]) {
  const totalChapters = readings.reduce((total, reading) => total + countReferenceChapters(reading.reference), 0);
  return totalChapters <= FULL_ONSCREEN_CHAPTER_LIMIT;
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

async function fetchYvpPassage(
  reference: string,
  bibleId: string,
  parsed: NonNullable<ReturnType<typeof parseReference>>,
): Promise<YvpPassage> {
  const books = await getYvpBooks(bibleId);
  const bookId = findYvpBookId(books, parsed.book);
  const passageId = buildPassageId(bookId, parsed);
  const payload = (await yvpFetch(
    `${bibleId}/passages/${passageId}?format=html&include_headings=true&include_notes=false`,
  )) as {
    data?: { content?: unknown; reference?: unknown; copyright?: unknown };
    content?: unknown;
    reference?: unknown;
    copyright?: unknown;
    html?: unknown;
  };
  const data = payload.data ?? {};
  const content = data.content ?? payload.content ?? payload.html ?? "";
  const text = typeof content === "string" ? extractPlainTextFromHtml(content) : "";
  const displayReference = data.reference ?? payload.reference ?? reference;
  const copyright = data.copyright ?? payload.copyright ?? "YouVersion";

  return {
    displayReference: typeof displayReference === "string" ? displayReference : reference,
    text,
    copyright: typeof copyright === "string" ? copyright : "YouVersion",
  };
}

async function fetchSingleScripturePreview(reference: string, bibleId: string): Promise<ScripturePreview> {
  const parsed = parseReference(reference);

  if (!parsed) {
    return {
      reference,
      displayReference: reference,
      bibleId,
      text: "",
      copyright: "YouVersion",
      error: "The reading reference could not be resolved.",
    };
  }

  const chapterRange = Boolean(parsed.endChapter && parsed.endChapter !== parsed.startChapter);
  const safeParsed = chapterRange ? { ...parsed, endChapter: undefined } : parsed;

  try {
    const passage = await fetchYvpPassage(parsed.firstSection, bibleId, safeParsed);

    return {
      reference,
      displayReference: passage.displayReference,
      bibleId,
      text: truncateText(passage.text, 2_800),
      copyright: passage.copyright,
      note: [
        chapterRange ? "Scripture preview shows the first chapter of a longer reading." : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  } catch (error) {
    return {
      reference,
      displayReference: parsed.firstSection,
      bibleId,
      text: "",
      copyright: "YouVersion",
      error: error instanceof Error ? error.message : "YouVersion passage fetch failed.",
    };
  }
}

async function fetchSingleFullScripture(reference: string, bibleId: string): Promise<ScripturePreview> {
  const parsed = parseReference(reference);

  if (!parsed) {
    return {
      reference,
      displayReference: reference,
      bibleId,
      text: "",
      copyright: "YouVersion",
      error: "The reading reference could not be resolved.",
    };
  }

  const endChapter = parsed.startVerse ? parsed.startChapter : (parsed.endChapter ?? parsed.startChapter);
  const chapterParses = Array.from({ length: endChapter - parsed.startChapter + 1 }, (_, index) => ({
    ...parsed,
    startChapter: parsed.startChapter + index,
    endChapter: undefined,
    endVerse: parsed.startVerse ? parsed.endVerse : undefined,
  }));
  const passages = await mapWithConcurrency<typeof chapterParses[number], YvpPassageResult>(chapterParses, 4, async (chapterParsed) => {
    try {
      return { passage: await fetchYvpPassage(`${chapterParsed.book.name} ${chapterParsed.startChapter}`, bibleId, chapterParsed) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "YouVersion passage fetch failed." };
    }
  });
  const text = passages
    .map((result, index) => {
      if (result.passage) {
        return `${result.passage.displayReference}\n${result.passage.text}`;
      }

      const chapter = chapterParses[index];
      return `${chapter.book.name} ${chapter.startChapter}\nScripture text unavailable: ${result.error}`;
    })
    .join("\n\n");
  const displayReference = passages
    .map((result, index) => (result.passage ? result.passage.displayReference : `${chapterParses[index].book.name} ${chapterParses[index].startChapter}`))
    .join("; ");
  const copyrights = passages
    .map((result) => (result.passage ? result.passage.copyright : "YouVersion"))
    .filter(Boolean);
  const errors = passages.map((result) => result.error || "").filter(Boolean);

  return {
    reference,
    displayReference,
    bibleId,
    text,
    copyright: [...new Set(copyrights)].join("; ") || "YouVersion",
    note: errors.length > 0 ? "Some Scripture sections could not be fetched." : "Full Scripture text fetched for this reading.",
    error: errors.length > 0 ? errors.join(" ") : undefined,
  };
}

async function fetchScripturePreview(reference: string, bibleId: string): Promise<ScripturePreview> {
  const sections = reference.split(";").map((section) => section.trim()).filter(Boolean);

  if (sections.length <= 1) {
    return fetchSingleScripturePreview(reference, bibleId);
  }

  const previews = await Promise.all(sections.map((section) => fetchSingleScripturePreview(section, bibleId)));
  const text = previews
    .map((preview) => {
      const body = preview.text || preview.error || "Scripture text unavailable.";
      return `${preview.displayReference}\n${truncateText(body, 900)}`;
    })
    .join("\n\n");
  const notes = [
    "Scripture preview includes each selected reading section.",
    ...previews.map((preview) => preview.note).filter((note): note is string => Boolean(note)),
  ];
  const errors = previews.map((preview) => preview.error).filter((error): error is string => Boolean(error));

  return {
    reference,
    displayReference: previews.map((preview) => preview.displayReference).join("; "),
    bibleId,
    text: truncateText(text, 2_200),
    copyright: [...new Set(previews.map((preview) => preview.copyright).filter(Boolean))].join("; ") || "YouVersion",
    note: [...new Set(notes)].join(" "),
    error: errors.length > 0 ? errors.join(" ") : undefined,
  };
}

export async function fetchFullScripture(reference: string, bibleId: string): Promise<ScripturePreview> {
  const sections = reference.split(";").map((section) => section.trim()).filter(Boolean);

  if (sections.length <= 1) {
    return fetchSingleFullScripture(reference, bibleId);
  }

  const fullSections = await mapWithConcurrency(sections, 3, (section) => fetchSingleFullScripture(section, bibleId));
  const text = fullSections
    .map((section) => {
      const body = section.text || section.error || "Scripture text unavailable.";
      return `${section.displayReference}\n${body}`;
    })
    .join("\n\n");
  const notes = ["Full Scripture text fetched for each selected reading section.", ...fullSections.map((section) => section.note).filter(Boolean)];
  const errors = fullSections.map((section) => section.error).filter((error): error is string => Boolean(error));

  return {
    reference,
    displayReference: fullSections.map((section) => section.displayReference).join("; "),
    bibleId,
    text,
    copyright: [...new Set(fullSections.map((section) => section.copyright).filter(Boolean))].join("; ") || "YouVersion",
    note: [...new Set(notes)].join(" "),
    error: errors.length > 0 ? errors.join(" ") : undefined,
  };
}

function sourceKey(source: EpisodeChatSource) {
  return `${source.sourceType}:${source.trackId}:${source.segmentId}`;
}

function withCitations(sources: EpisodeChatSource[]): ReadingPlanSource[] {
  const seen = new Set<string>();
  const uniqueSources: EpisodeChatSource[] = [];

  sources.forEach((source) => {
    const key = sourceKey(source);
    if (seen.has(key) || !source.text.trim()) {
      return;
    }

    seen.add(key);
    uniqueSources.push(source);
  });

  return uniqueSources.slice(0, 16).map((source, index) => ({
    ...source,
    citationId: `S${index + 1}`,
    snippet: truncateText(source.text, 420),
  }));
}

function formatSourceContext(sources: ReadingPlanSource[]) {
  if (sources.length === 0) {
    return "No AIC archive sources were retrieved.";
  }

  return sources
    .map((source) => {
      const when = source.startTime || source.endTime ? ` (${source.startTime || "?"}-${source.endTime || "?"})` : "";
      return `[${source.citationId}] ${source.title}${when}
Track ${source.trackId} (${source.publishDate || "unknown date"}) ${source.sourceType}
${truncateText(source.text, 900)}`;
    })
    .join("\n\n");
}

function formatScriptureContext(readings: PlannerReading[], scriptures: ScripturePreview[]) {
  return readings
    .map((reading, index) => {
      const scripture = scriptures[index];
      const scriptureText = scripture?.text
        ? truncateText(scripture.text, 2_200)
        : scripture?.error
          ? `Scripture text unavailable: ${scripture.error}`
          : "Scripture text unavailable.";

      return `Day ${reading.day}: ${reading.reference}
Title seed: ${reading.titleSeed}
Scripture preview: ${scriptureText}`;
    })
    .join("\n\n");
}

function buildPlannerPrompt({
  scope,
  durationDays,
  topic,
  previewReadings,
  scriptures,
  sources,
}: {
  scope: ReadingPlanScope;
  durationDays: number;
  topic: string;
  previewReadings: PlannerReading[];
  scriptures: ScripturePreview[];
  sources: ReadingPlanSource[];
}) {
  return [
    "Create a Bible reading-plan preview for the AIC website.",
    "",
    "PLAN SETTINGS:",
    `Scope: ${scopeLabelForPrompt(scope)}`,
    `Duration: ${durationDays} days`,
    `Topic or focus: ${topic || "none"}`,
    "",
    "REQUIRED DISCIPLINE:",
    "Do not write as Pastor Wood, impersonate him, or imply that generated text is a verbatim sermon.",
    "Write as an AIC study note informed by the archive sources.",
    "Use citations like [S1] only when the source excerpt directly supports the claim.",
    "If the supplied sources are thematic rather than directly about the day's passage, set coverageLabel to thematic or style-guided and say so plainly.",
    "Use Scripture as the primary text and the AIC archive as supporting context.",
    "When a day lists multiple Scripture sections, use every listed section in that day's expository reading and draw clear parallel themes between them.",
    "",
    "FIRST-WEEK READINGS AND SCRIPTURE PREVIEWS:",
    formatScriptureContext(previewReadings, scriptures),
    "",
    "AIC ARCHIVE SOURCES:",
    formatSourceContext(sources),
    "",
    "Return valid JSON only. Shape:",
    JSON.stringify(
      {
        title: "string",
        coverageLabel: "direct | thematic | style-guided",
        sourceSummary: "string",
        days: [
          {
            day: 1,
            title: "string",
            reference: "string",
            scriptureAnchor: "string",
            expositoryReading: "Day 1 should be a substantial 10-minute-style reading; days 2-7 may be concise previews.",
            reflectionPrompts: ["string", "string"],
            citations: ["S1"],
          },
        ],
      },
      null,
      2,
    ),
  ].join("\n");
}

function extractJsonPayload(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Partial<PlannerModelResult>;
  } catch {
    return null;
  }
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean).slice(0, 4);
}

function normalizeCoverageLabel(value: unknown): PlannerModelResult["coverageLabel"] {
  if (value === "direct" || value === "thematic" || value === "style-guided") {
    return value;
  }

  return "style-guided";
}

function fallbackPlan(readings: PlannerReading[], sources: ReadingPlanSource[]): PlannerModelResult {
  const sourceList = sources.slice(0, 3).map((source) => `[${source.citationId}]`).join(", ");

  return {
    title: "AIC Bible Reading Plan",
    coverageLabel: sources.length > 0 ? "thematic" : "style-guided",
    sourceSummary: sources.length > 0
      ? `Retrieved ${sources.length} archive excerpts for source-backed orientation.`
      : "No AIC archive sources were retrieved for this preview.",
    days: readings.map((reading, index) => ({
      day: reading.day,
      title: reading.titleSeed,
      reference: reading.reference,
      scriptureAnchor: `Read ${reading.reference} as the day's controlling text.`,
      expositoryReading: index === 0
        ? [
            `This generated study note begins with ${reading.reference} and treats the Scripture reading as primary.`,
            sources.length > 0
              ? `The AIC archive sources ${sourceList} should be used as supporting context, not as a replacement for the passage.`
              : "The archive did not return enough source context for direct claims, so this preview stays general.",
          ].join(" ")
        : "Generated preview unavailable. Use the reading reference as the day's assignment.",
      reflectionPrompts: ["What does the passage reveal about God?", "Where does the text call for repentance, faith, or obedience?"],
      citations: sources.length > 0 ? sources.slice(0, 2).map((source) => source.citationId) : [],
    })),
  };
}

function normalizeModelResult(rawText: string, readings: PlannerReading[], sources: ReadingPlanSource[]) {
  const parsed = extractJsonPayload(rawText);
  if (!parsed) {
    return fallbackPlan(readings, sources);
  }

  const fallback = fallbackPlan(readings, sources);
  const parsedDays = Array.isArray(parsed.days) ? (parsed.days as Array<Partial<PlannerModelDay>>) : [];
  const daysByNumber = new Map(
    parsedDays
      .filter((day) => typeof day === "object" && day !== null && Number.isFinite(Number(day.day)))
      .map((day) => [Number(day.day), day] as const),
  );

  return {
    title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : fallback.title,
    coverageLabel: normalizeCoverageLabel(parsed.coverageLabel),
    sourceSummary: typeof parsed.sourceSummary === "string" && parsed.sourceSummary.trim()
      ? parsed.sourceSummary.trim()
      : fallback.sourceSummary,
    days: readings.map((reading) => {
      const modelDay = daysByNumber.get(reading.day);
      const fallbackDay = fallback.days.find((day) => day.day === reading.day) ?? fallback.days[0];

      return {
        day: reading.day,
        title: typeof modelDay?.title === "string" && modelDay.title.trim() ? modelDay.title.trim() : reading.titleSeed,
        reference: reading.reference,
        scriptureAnchor: typeof modelDay?.scriptureAnchor === "string" && modelDay.scriptureAnchor.trim()
          ? modelDay.scriptureAnchor.trim()
          : fallbackDay.scriptureAnchor,
        expositoryReading: typeof modelDay?.expositoryReading === "string" && modelDay.expositoryReading.trim()
          ? modelDay.expositoryReading.trim()
          : fallbackDay.expositoryReading,
        reflectionPrompts: normalizeStringArray(modelDay?.reflectionPrompts).length > 0
          ? normalizeStringArray(modelDay?.reflectionPrompts)
          : fallbackDay.reflectionPrompts,
        citations: normalizeStringArray(modelDay?.citations),
      };
    }),
  };
}

function normalizeScope(value: ReadingPlanScope): ReadingPlanScope {
  const validScopes: ReadingPlanScope[] = [
    "whole-bible",
    "old-new",
    "new-testament",
    "gospels",
    "epistles",
    "wisdom",
    "specific-books",
    "topic",
    "custom",
  ];

  return validScopes.includes(value) ? value : "whole-bible";
}

function normalizeProvider(value: string | undefined): RagProvider {
  return value === "openai" ? "openai" : "silo";
}

export async function generateReadingPlan(input: GenerateReadingPlanInput): Promise<ReadingPlanResult> {
  const durationDays = SUPPORTED_DURATIONS.has(input.durationDays) ? input.durationDays : 30;
  const scope = normalizeScope(input.scope);
  const topic = truncateText(input.topic ?? "", 180);
  const translationId = truncateText(input.translationId || process.env.YVP_BIBLE_ID || DEFAULT_BIBLE_ID, 80);
  const provider = normalizeProvider(input.provider);
  const selectedBooks = selectedBooksForInput(input.selectedBooks);
  const readings = buildReadings(scope, durationDays, topic, selectedBooks);
  const previewReadings = readings.slice(0, PREVIEW_DAY_COUNT);
  const retrievalQuery = [
    topic,
    scopeLabelForPrompt(scope),
    ...previewReadings.slice(0, 3).map((reading) => reading.retrievalQuery),
  ]
    .filter(Boolean)
    .join(" ");
  const scriptureFetcher = shouldUseFullOnscreenScripture(previewReadings)
    ? fetchFullScripture
    : fetchScripturePreview;

  const [scriptures, ragSources] = await Promise.all([
    Promise.all(previewReadings.map((reading) => scriptureFetcher(reading.reference, translationId))),
    getEpisodeRagSources(retrievalQuery, { topK: 14 }),
  ]);
  const summarySources = await getEpisodeSummarySources([...new Set(ragSources.map((source) => source.trackId))].slice(0, 4));
  const sources = withCitations([...ragSources, ...summarySources]);
  const messages = [
    {
      role: "system",
      content: "You are a careful Bible reading-plan editor for the Abiding in Christ archive. Return only valid JSON.",
    },
    {
      role: "user",
      content: buildPlannerPrompt({
        scope,
        durationDays,
        topic,
        previewReadings,
        scriptures,
        sources,
      }),
    },
  ];
  const chatResult = await callArchiveChatModel(messages, provider);
  const modelPlan = normalizeModelResult(chatResult.text, previewReadings, sources);

  return {
    title: modelPlan.title,
    scope,
    durationDays,
    translationId,
    topic,
    selectedBooks: selectedBooks.map((book) => book.name),
    coverageLabel: modelPlan.coverageLabel,
    sourceSummary: modelPlan.sourceSummary,
    generatedDays: modelPlan.days.map((day, index) => ({
      ...day,
      scripture: scriptures[index],
      cycleNote: previewReadings[index]?.cycleNote,
    })),
    outline: readings.map((reading) => ({
      day: reading.day,
      reference: reading.reference,
      titleSeed: reading.titleSeed,
      cycleNote: reading.cycleNote,
    })),
    sources,
    provider,
    model: chatResult.model,
  };
}
