import "server-only";

import { queryRows } from "@/lib/db";

type EpisodePassageRow = {
  track_id: string;
  title: string;
  publish_date: string;
  category: string;
  detail: string;
};

export type BibleBookCatalog = {
  name: string;
  testament: "Old Testament" | "New Testament";
  chapterCount: number;
  sermonCount: number;
  chaptersWithSermons: number;
  chapters: Array<{
    number: number;
    sermons: SermonCatalogEpisode[];
  }>;
};

export type SermonCatalogEpisode = {
  trackId: string;
  title: string;
  publishDate: string;
  category: string;
  detail: string;
  passageLabel: string;
};

export type SermonCatalog = {
  books: BibleBookCatalog[];
  matchedEpisodeCount: number;
  chapterPlacementCount: number;
  unmatchedEpisodeCount: number;
};

type BibleBookDefinition = {
  name: string;
  testament: "Old Testament" | "New Testament";
  chapterCount: number;
  aliases: string[];
};

type ParsedPassage = {
  bookName: string;
  chapters: number[];
  passageLabel: string;
};

const OLD_TESTAMENT: Array<[string, number, string[]]> = [
  ["Genesis", 50, ["Gen"]],
  ["Exodus", 40, ["Exod", "Ex"]],
  ["Leviticus", 27, ["Lev"]],
  ["Numbers", 36, ["Num"]],
  ["Deuteronomy", 34, ["Deut", "Dt"]],
  ["Joshua", 24, ["Josh"]],
  ["Judges", 21, ["Judg"]],
  ["Ruth", 4, []],
  ["1 Samuel", 31, ["I Samuel", "First Samuel", "1 Sam"]],
  ["2 Samuel", 24, ["II Samuel", "Second Samuel", "2 Sam"]],
  ["1 Kings", 22, ["I Kings", "First Kings"]],
  ["2 Kings", 25, ["II Kings", "Second Kings"]],
  ["1 Chronicles", 29, ["I Chronicles", "First Chronicles", "1 Chron"]],
  ["2 Chronicles", 36, ["II Chronicles", "Second Chronicles", "2 Chron"]],
  ["Ezra", 10, []],
  ["Nehemiah", 13, ["Neh"]],
  ["Esther", 10, ["Esth"]],
  ["Job", 42, []],
  ["Psalms", 150, ["Psalm", "Ps"]],
  ["Proverbs", 31, ["Prov"]],
  ["Ecclesiastes", 12, ["Eccl"]],
  ["Song of Solomon", 8, ["Song of Songs", "Song"]],
  ["Isaiah", 66, ["Isa"]],
  ["Jeremiah", 52, ["Jer"]],
  ["Lamentations", 5, ["Lam"]],
  ["Ezekiel", 48, ["Ezek"]],
  ["Daniel", 12, ["Dan"]],
  ["Hosea", 14, ["Hos"]],
  ["Joel", 3, []],
  ["Amos", 9, []],
  ["Obadiah", 1, ["Obad"]],
  ["Jonah", 4, []],
  ["Micah", 7, []],
  ["Nahum", 3, []],
  ["Habakkuk", 3, ["Hab"]],
  ["Zephaniah", 3, ["Zeph"]],
  ["Haggai", 2, ["Hag"]],
  ["Zechariah", 14, ["Zech"]],
  ["Malachi", 4, ["Mal"]],
];

const NEW_TESTAMENT: Array<[string, number, string[]]> = [
  ["Matthew", 28, ["Matt", "Mt"]],
  ["Mark", 16, ["Mk"]],
  ["Luke", 24, ["Lk"]],
  ["John", 21, ["Jn"]],
  ["Acts", 28, []],
  ["Romans", 16, ["Rom"]],
  ["1 Corinthians", 16, ["I Corinthians", "First Corinthians", "1 Cor"]],
  ["2 Corinthians", 13, ["II Corinthians", "Second Corinthians", "2 Cor"]],
  ["Galatians", 6, ["Gal"]],
  ["Ephesians", 6, ["Eph"]],
  ["Philippians", 4, ["Phil"]],
  ["Colossians", 4, ["Col"]],
  ["1 Thessalonians", 5, ["I Thessalonians", "First Thessalonians", "1 Thess"]],
  ["2 Thessalonians", 3, ["II Thessalonians", "Second Thessalonians", "2 Thess"]],
  ["1 Timothy", 6, ["I Timothy", "First Timothy", "1 Tim"]],
  ["2 Timothy", 4, ["II Timothy", "Second Timothy", "2 Tim"]],
  ["Titus", 3, []],
  ["Philemon", 1, ["Philem"]],
  ["Hebrews", 13, ["Heb"]],
  ["James", 5, []],
  ["1 Peter", 5, ["I Peter", "First Peter", "1 Pet"]],
  ["2 Peter", 3, ["II Peter", "Second Peter", "2 Pet"]],
  ["1 John", 5, ["I John", "First John"]],
  ["2 John", 1, ["II John", "Second John"]],
  ["3 John", 1, ["III John", "Third John"]],
  ["Jude", 1, []],
  ["Revelation", 22, ["Rev"]],
];

const BIBLE_BOOKS: BibleBookDefinition[] = [
  ...OLD_TESTAMENT.map(([name, chapterCount, aliases]) => ({
    name,
    chapterCount,
    aliases: [name, ...aliases],
    testament: "Old Testament" as const,
  })),
  ...NEW_TESTAMENT.map(([name, chapterCount, aliases]) => ({
    name,
    chapterCount,
    aliases: [name, ...aliases],
    testament: "New Testament" as const,
  })),
];

const ALIASES = BIBLE_BOOKS.flatMap((book) =>
  book.aliases.map((alias) => ({
    alias,
    book,
    regex: new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(alias).replace(/\\s+/g, "\\s*")}(?=\\s*\\d|[^A-Za-z0-9]|$)`, "i"),
  })),
).sort((left, right) => right.alias.length - left.alias.length);

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePassageText(value: string) {
  return value
    .replace(/[_\.]/g, ":")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function chapterRange(start: number, end: number, chapterCount: number) {
  const low = Math.max(1, Math.min(start, end));
  const high = Math.min(chapterCount, Math.max(start, end));
  const chapters: number[] = [];
  for (let chapter = low; chapter <= high; chapter += 1) {
    chapters.push(chapter);
  }
  return chapters;
}

function parseChapters(afterBook: string, chapterCount: number): number[] {
  const chapterMatch = afterBook.trim().match(/^(\d{1,3})(.*)$/);
  if (!chapterMatch) {
    return [];
  }

  const startChapter = Number(chapterMatch[1]);
  if (!Number.isInteger(startChapter) || startChapter < 1 || startChapter > chapterCount) {
    return [];
  }

  const suffix = chapterMatch[2] ?? "";
  const chapterToChapter = suffix.match(/^\s*-\s*(\d{1,3})(?=$|[^:0-9])/);
  if (chapterToChapter) {
    const endChapter = Number(chapterToChapter[1]);
    if (Number.isInteger(endChapter) && endChapter >= 1 && endChapter <= chapterCount) {
      return chapterRange(startChapter, endChapter, chapterCount);
    }
  }

  const verseToOtherChapter = suffix.match(/^\s*:\s*\d+\s*-\s*(\d{1,3})\s*:/);
  if (verseToOtherChapter) {
    const endChapter = Number(verseToOtherChapter[1]);
    if (Number.isInteger(endChapter) && endChapter >= 1 && endChapter <= chapterCount) {
      return chapterRange(startChapter, endChapter, chapterCount);
    }
  }

  return [startChapter];
}

function parseMainPassage(detail: string, title: string): ParsedPassage | null {
  const sourceCandidates = [detail, title.includes(":") ? title.split(":").slice(1).join(":") : title]
    .map(normalizePassageText)
    .filter(Boolean);

  for (const source of sourceCandidates) {
    for (const candidate of ALIASES) {
      const match = candidate.regex.exec(source);
      if (!match || match.index === undefined) {
        continue;
      }

      const aliasStart = match.index + (match[1]?.length ?? 0);
      const afterBook = source.slice(aliasStart + candidate.alias.length);
      const chapters = parseChapters(afterBook, candidate.book.chapterCount);
      if (chapters.length === 0) {
        continue;
      }

      return {
        bookName: candidate.book.name,
        chapters,
        passageLabel: detail.trim() || title.trim(),
      };
    }
  }

  return null;
}

function buildEmptyCatalog(): BibleBookCatalog[] {
  return BIBLE_BOOKS.map((book) => ({
    name: book.name,
    testament: book.testament,
    chapterCount: book.chapterCount,
    sermonCount: 0,
    chaptersWithSermons: 0,
    chapters: Array.from({ length: book.chapterCount }, (_, index) => ({
      number: index + 1,
      sermons: [],
    })),
  }));
}

export async function getSermonCatalog(): Promise<SermonCatalog> {
  const rows = await queryRows<EpisodePassageRow>(`
    select track_id, title, publish_date, category, detail
    from episodes
    order by nullif(publish_date, '')::date desc nulls last, title asc
  `);

  const books = buildEmptyCatalog();
  const byBook = new Map(books.map((book) => [book.name, book]));
  const matchedTrackIds = new Set<string>();
  let chapterPlacementCount = 0;

  for (const row of rows) {
    const parsed = parseMainPassage(row.detail ?? "", row.title ?? "");
    if (!parsed) {
      continue;
    }

    const book = byBook.get(parsed.bookName);
    if (!book) {
      continue;
    }

    const episode: SermonCatalogEpisode = {
      trackId: row.track_id,
      title: row.title,
      publishDate: row.publish_date,
      category: row.category,
      detail: row.detail,
      passageLabel: parsed.passageLabel,
    };

    matchedTrackIds.add(row.track_id);
    const uniqueChapters = [...new Set(parsed.chapters)];
    for (const chapterNumber of uniqueChapters) {
      const chapter = book.chapters[chapterNumber - 1];
      if (!chapter) {
        continue;
      }
      chapter.sermons.push(episode);
      chapterPlacementCount += 1;
    }
  }

  for (const book of books) {
    const uniqueBookTracks = new Set<string>();
    let chaptersWithSermons = 0;
    for (const chapter of book.chapters) {
      if (chapter.sermons.length > 0) {
        chaptersWithSermons += 1;
      }
      for (const sermon of chapter.sermons) {
        uniqueBookTracks.add(sermon.trackId);
      }
    }
    book.sermonCount = uniqueBookTracks.size;
    book.chaptersWithSermons = chaptersWithSermons;
  }

  return {
    books,
    matchedEpisodeCount: matchedTrackIds.size,
    chapterPlacementCount,
    unmatchedEpisodeCount: rows.length - matchedTrackIds.size,
  };
}
