export const PAGE_FONT_SIZES = ["small", "standard", "large"] as const;

export type PageFontSize = (typeof PAGE_FONT_SIZES)[number];

export const PAGE_FONT_SIZE_OPTIONS: ReadonlyArray<{
  value: PageFontSize;
  label: string;
  description: string;
}> = [
  { value: "small", label: "Small", description: "A compact size for text-heavy pages." },
  { value: "standard", label: "Standard", description: "The recommended size for most pages." },
  { value: "large", label: "Large", description: "A dramatic size for short, high-impact pages." },
];

export function isPageFontSize(value: unknown): value is PageFontSize {
  return typeof value === "string" && PAGE_FONT_SIZES.includes(value as PageFontSize);
}

export function normalizePageFontSize(
  value: unknown,
  fallback: PageFontSize = "standard",
): PageFontSize {
  return isPageFontSize(value) ? value : fallback;
}
