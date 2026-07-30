export type ConsoleRedirectSearchParams = Record<string, string | string[] | undefined>;

export function consolePathWithSearchParams(
  pathname: string,
  searchParams: ConsoleRedirectSearchParams,
) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(key, item));
    } else if (value !== undefined) {
      query.set(key, value);
    }
  }

  const serialized = query.toString();
  return serialized ? `${pathname}?${serialized}` : pathname;
}
