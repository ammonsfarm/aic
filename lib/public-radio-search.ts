import { publicArchivePage } from "@/lib/public-pagination";

export const PUBLIC_RADIO_QUERY_MAX_LENGTH = 80;
export const PUBLIC_RADIO_MAX_PAGE = 1_000;
export const PUBLIC_RADIO_MIN_YEAR = 1900;
export const PUBLIC_RADIO_MAX_YEAR = 2100;

type QueryValue = string | string[] | undefined;

export type PublicRadioArchiveState = {
  page: number;
  query: string;
  year: number | null;
  hasFilters: boolean;
};

function first(value: QueryValue) {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizePublicRadioQuery(value: QueryValue) {
  const normalized = (first(value) || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(normalized).slice(0, PUBLIC_RADIO_QUERY_MAX_LENGTH).join("").trim();
}

export function normalizePublicRadioYear(value: QueryValue) {
  const candidate = (first(value) || "").trim();
  if (!/^\d{4}$/.test(candidate)) return null;
  const year = Number(candidate);
  return year >= PUBLIC_RADIO_MIN_YEAR && year <= PUBLIC_RADIO_MAX_YEAR ? year : null;
}

export function parsePublicRadioArchiveState(params: { page?: QueryValue; q?: QueryValue; year?: QueryValue }) {
  const query = normalizePublicRadioQuery(params.q);
  const year = normalizePublicRadioYear(params.year);
  const page = Math.min(publicArchivePage(first(params.page)), PUBLIC_RADIO_MAX_PAGE);
  return { page, query, year, hasFilters: Boolean(query || year) } satisfies PublicRadioArchiveState;
}

export function publicRadioArchivePath(state: PublicRadioArchiveState, page = state.page) {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.year) params.set("year", String(state.year));
  if (page > 1) params.set("page", String(Math.min(Math.max(1, Math.floor(page)), PUBLIC_RADIO_MAX_PAGE)));
  const query = params.toString();
  return query ? `/radio/?${query}` : "/radio/";
}
