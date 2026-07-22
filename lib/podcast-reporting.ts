export type PodcastRangeKey = "30d" | "60d" | "quarter" | "ytd" | "max" | "custom";

export type ReportDateRange = {
  key: PodcastRangeKey;
  label: string;
  startDate: string | null;
  endDate: string | null;
  minDate: string | null;
  maxDate: string | null;
};

export type DataFreshness = {
  asOfDate: string;
  dataCurrentThrough: string | null;
  lagDays: number | null;
  slaDays: number;
  state: "current" | "stale" | "missing";
};

export const podcastRangeOptions: Array<{ key: PodcastRangeKey; label: string }> = [
  { key: "30d", label: "30 days" },
  { key: "60d", label: "60 days" },
  { key: "quarter", label: "90 days" },
  { key: "ytd", label: "Year to date" },
  { key: "max", label: "Max" },
  { key: "custom", label: "Custom dates" },
];

export function normalizeReportDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return null;
  }

  return value;
}

export function utcToday(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addReportDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function reportDaysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function parsePodcastRange(value: string | null | undefined): PodcastRangeKey {
  if (value === "60d" || value === "quarter" || value === "ytd" || value === "max" || value === "custom") {
    return value;
  }

  return "30d";
}

function rangeLabel(key: PodcastRangeKey, startDate: string | null, endDate: string | null): string {
  if (key === "custom" && startDate && endDate) {
    return `${startDate} through ${endDate}`;
  }

  return podcastRangeOptions.find((option) => option.key === key)?.label ?? "30 days";
}

export function resolveReportDateRange({
  key,
  minDate,
  maxDate,
  startDate,
  endDate,
  today = utcToday(),
}: {
  key: PodcastRangeKey;
  minDate: string | null;
  maxDate: string | null;
  startDate?: string | null;
  endDate?: string | null;
  today?: string;
}): ReportDateRange {
  const normalizedToday = normalizeReportDate(today) ?? utcToday();
  const normalizedMin = normalizeReportDate(minDate);
  const normalizedMax = normalizeReportDate(maxDate);
  const requestedStart = normalizeReportDate(startDate);
  const requestedEnd = normalizeReportDate(endDate);

  if (!normalizedMin || !normalizedMax) {
    return {
      key,
      label: rangeLabel(key, requestedStart, requestedEnd),
      startDate: null,
      endDate: null,
      minDate: normalizedMin,
      maxDate: normalizedMax,
    };
  }

  let resolvedEnd = normalizedToday;
  let resolvedStart = normalizedMin;

  if (key === "custom" && requestedStart && requestedEnd && requestedStart <= requestedEnd) {
    resolvedStart = requestedStart;
    resolvedEnd = requestedEnd > normalizedToday ? normalizedToday : requestedEnd;
  } else if (key === "30d") {
    resolvedStart = addReportDays(normalizedToday, -29);
  } else if (key === "60d") {
    resolvedStart = addReportDays(normalizedToday, -59);
  } else if (key === "quarter") {
    resolvedStart = addReportDays(normalizedToday, -89);
  } else if (key === "ytd") {
    resolvedStart = `${normalizedToday.slice(0, 4)}-01-01`;
  }

  if (resolvedStart < normalizedMin) {
    resolvedStart = normalizedMin;
  }

  return {
    key,
    label: rangeLabel(key, resolvedStart, resolvedEnd),
    startDate: resolvedStart,
    endDate: resolvedEnd,
    minDate: normalizedMin,
    maxDate: normalizedMax,
  };
}

export function previousReportRange(range: ReportDateRange): { startDate: string; endDate: string } | null {
  if (!range.startDate || !range.endDate) {
    return null;
  }

  const dayCount = reportDaysBetween(range.startDate, range.endDate) + 1;
  const endDate = addReportDays(range.startDate, -1);
  return { startDate: addReportDays(endDate, -(dayCount - 1)), endDate };
}

export function calculateFreshness({
  dataCurrentThrough,
  today = utcToday(),
  slaDays = 2,
}: {
  dataCurrentThrough: string | null;
  today?: string;
  slaDays?: number;
}): DataFreshness {
  const currentThrough = normalizeReportDate(dataCurrentThrough);
  const asOfDate = normalizeReportDate(today) ?? utcToday();
  const normalizedSla = Math.max(0, Math.trunc(slaDays));

  if (!currentThrough) {
    return { asOfDate, dataCurrentThrough: null, lagDays: null, slaDays: normalizedSla, state: "missing" };
  }

  const lagDays = reportDaysBetween(currentThrough, asOfDate);
  return {
    asOfDate,
    dataCurrentThrough: currentThrough,
    lagDays,
    slaDays: normalizedSla,
    state: lagDays <= normalizedSla ? "current" : "stale",
  };
}

export function percentageChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return null;
  }

  return ((current - previous) / previous) * 100;
}

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function rowsToCsv(headers: string[], rows: unknown[][]): string {
  return `${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
