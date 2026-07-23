const DEFAULT_STRAPI_FETCH_TIMEOUT_MS = 4_000;
const MAX_STRAPI_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_PUBLIC_STRAPI_FETCH_TIMEOUT_MS = 1_500;
const MAX_PUBLIC_STRAPI_FETCH_TIMEOUT_MS = 4_000;
const DEFAULT_PUBLIC_STRAPI_CIRCUIT_COOLDOWN_MS = 30_000;
const MAX_PUBLIC_STRAPI_CIRCUIT_COOLDOWN_MS = 5 * 60_000;

type PublicStrapiCircuitState = {
  generation: number;
  openUntil: number;
  probeInFlight: boolean;
};

type PublicStrapiPermit = {
  generation: number;
  key: string;
};

const publicStrapiCircuits = new Map<string, PublicStrapiCircuitState>();

function configuredTimeoutMs(value: string | undefined, fallback: number, maximum = MAX_STRAPI_FETCH_TIMEOUT_MS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

export function strapiFetchTimeoutMs() {
  return configuredTimeoutMs(process.env.STRAPI_FETCH_TIMEOUT_MS, DEFAULT_STRAPI_FETCH_TIMEOUT_MS);
}

export function strapiUploadTimeoutMs() {
  return configuredTimeoutMs(process.env.STRAPI_UPLOAD_TIMEOUT_MS, MAX_STRAPI_FETCH_TIMEOUT_MS);
}

export function publicStrapiFetchTimeoutMs() {
  return configuredTimeoutMs(
    process.env.STRAPI_PUBLIC_FETCH_TIMEOUT_MS,
    DEFAULT_PUBLIC_STRAPI_FETCH_TIMEOUT_MS,
    MAX_PUBLIC_STRAPI_FETCH_TIMEOUT_MS,
  );
}

export function publicStrapiCircuitCooldownMs() {
  return configuredTimeoutMs(
    process.env.STRAPI_PUBLIC_CIRCUIT_COOLDOWN_MS,
    DEFAULT_PUBLIC_STRAPI_CIRCUIT_COOLDOWN_MS,
    MAX_PUBLIC_STRAPI_CIRCUIT_COOLDOWN_MS,
  );
}

async function runFetchWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>,
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
    const response = await fetch(input, { ...init, signal: controller.signal });
    return await consume(response);
  } finally {
    clearTimeout(timeout);
    originalSignal?.removeEventListener("abort", abortFromOriginal);
  }
}

export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = strapiFetchTimeoutMs(),
) {
  return runFetchWithTimeout(input, init, timeoutMs, async (response) => response);
}

function fetchTextWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
) {
  return runFetchWithTimeout(input, init, timeoutMs, async (response) => ({
    response,
    text: await response.text(),
  }));
}

type StrapiFallbackOptions = {
  label: string;
  timeoutMs?: number;
  publicRequest?: boolean;
};

export type StrapiJsonResult<T> =
  | { status: "ok"; data: T }
  | { status: "unavailable" };

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function publicStrapiCircuitKey(input: RequestInfo | URL) {
  const value = requestUrl(input);
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

function beginPublicStrapiRequest(input: RequestInfo | URL): PublicStrapiPermit | null {
  const key = publicStrapiCircuitKey(input);
  const now = Date.now();
  const state = publicStrapiCircuits.get(key);

  if (!state) {
    publicStrapiCircuits.set(key, { generation: 0, openUntil: 0, probeInFlight: false });
    return { key, generation: 0 };
  }
  if (state.openUntil === 0) return { key, generation: state.generation };
  if (now < state.openUntil || state.probeInFlight) return null;

  state.probeInFlight = true;
  return { key, generation: state.generation };
}

function recordPublicStrapiSuccess(permit: PublicStrapiPermit) {
  const state = publicStrapiCircuits.get(permit.key);
  if (state?.generation === permit.generation) {
    publicStrapiCircuits.delete(permit.key);
  }
}

function recordPublicStrapiFailure(permit: PublicStrapiPermit) {
  const state = publicStrapiCircuits.get(permit.key);
  if (!state) {
    publicStrapiCircuits.set(permit.key, {
      generation: permit.generation + 1,
      openUntil: Date.now() + publicStrapiCircuitCooldownMs(),
      probeInFlight: false,
    });
    return;
  }
  if (state.generation !== permit.generation) return;
  state.generation += 1;
  state.openUntil = Date.now() + publicStrapiCircuitCooldownMs();
  state.probeInFlight = false;
}

function publicStrapiResponseUnavailable(response: Response) {
  return response.status >= 500;
}

export function resetPublicStrapiCircuitForTests() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("The public Strapi circuit can only be reset in tests.");
  }
  publicStrapiCircuits.clear();
}

export async function fetchStrapiJsonResult<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  { label, timeoutMs, publicRequest = false }: StrapiFallbackOptions,
): Promise<StrapiJsonResult<T>> {
  const permit = publicRequest ? beginPublicStrapiRequest(input) : undefined;
  if (publicRequest && !permit) return { status: "unavailable" };

  try {
    const { response, text } = await fetchTextWithTimeout(
      input,
      init,
      timeoutMs ?? (publicRequest ? publicStrapiFetchTimeoutMs() : strapiFetchTimeoutMs()),
    );
    if (!response.ok) {
      if (permit) {
        if (publicStrapiResponseUnavailable(response)) recordPublicStrapiFailure(permit);
        else recordPublicStrapiSuccess(permit);
      }
      console.warn(
        `${label} failed with ${response.status}; using the non-Strapi fallback.`,
        text.slice(0, 500),
      );
      return { status: "unavailable" };
    }

    try {
      const data = JSON.parse(text) as T;
      if (permit) recordPublicStrapiSuccess(permit);
      return { status: "ok", data };
    } catch (error) {
      if (permit) recordPublicStrapiFailure(permit);
      console.warn(`${label} returned invalid JSON; using the non-Strapi fallback.`, error);
      return { status: "unavailable" };
    }
  } catch (error) {
    if (permit) recordPublicStrapiFailure(permit);
    const description = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.warn(`${label} was unavailable at ${requestUrl(input)}; using the non-Strapi fallback.`, description);
    return { status: "unavailable" };
  }
}

export async function fetchStrapiJsonOrNull<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  options: StrapiFallbackOptions,
): Promise<T | null> {
  const result = await fetchStrapiJsonResult<T>(input, init, options);
  return result.status === "ok" ? result.data : null;
}
