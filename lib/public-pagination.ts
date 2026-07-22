export function publicArchivePage(value: string | undefined) {
  const requestedPage = Number(value || 1);
  return Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
}

export function publicArchiveCanonicalPath(basePath: string, page: number) {
  return page > 1 ? `${basePath}?page=${page}` : basePath;
}
