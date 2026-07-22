const DEFAULT_STRAPI_FETCH_TIMEOUT_MS = 4_000;
const MAX_STRAPI_FETCH_TIMEOUT_MS = 30_000;

function configuredTimeoutMs(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, MAX_STRAPI_FETCH_TIMEOUT_MS);
}

export function strapiFetchTimeoutMs() {
  return configuredTimeoutMs(process.env.STRAPI_FETCH_TIMEOUT_MS, DEFAULT_STRAPI_FETCH_TIMEOUT_MS);
}

export function strapiUploadTimeoutMs() {
  return configuredTimeoutMs(process.env.STRAPI_UPLOAD_TIMEOUT_MS, MAX_STRAPI_FETCH_TIMEOUT_MS);
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = strapiFetchTimeoutMs(),
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  const originalSignal = init.signal;
  const abortFromOriginal = () => controller.abort(originalSignal?.reason);

  if (originalSignal) {
    if (originalSignal.aborted) {
      abortFromOriginal();
    } else {
      originalSignal.addEventListener("abort", abortFromOriginal, { once: true });
    }
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    originalSignal?.removeEventListener("abort", abortFromOriginal);
  }
}

type StrapiFallbackOptions = {
  label: string;
  timeoutMs?: number;
};

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export async function fetchStrapiJsonOrNull<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  { label, timeoutMs }: StrapiFallbackOptions,
): Promise<T | null> {
  try {
    const response = await fetchWithTimeout(input, init, timeoutMs);
    if (!response.ok) {
      const details = await response.text().catch(() => "");
      console.warn(
        `${label} failed with ${response.status}; using the non-Strapi fallback.`,
        details.slice(0, 500),
      );
      return null;
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      console.warn(`${label} returned invalid JSON; using the non-Strapi fallback.`, error);
      return null;
    }
  } catch (error) {
    const description = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.warn(`${label} was unavailable at ${requestUrl(input)}; using the non-Strapi fallback.`, description);
    return null;
  }
}
