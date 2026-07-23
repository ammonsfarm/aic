import { calculateFreshness, type DataFreshness } from "@/lib/podcast-reporting";

export type SuccessfulCheckFreshness = Omit<DataFreshness, "dataCurrentThrough"> & {
  lastSuccessfulCheckDate: string | null;
};

export function calculateSuccessfulCheckFreshness({
  lastSuccessfulCheckDate,
  today,
  slaDays,
}: {
  lastSuccessfulCheckDate: string | null;
  today?: string;
  slaDays?: number;
}): SuccessfulCheckFreshness {
  const { dataCurrentThrough, ...freshness } = calculateFreshness({
    dataCurrentThrough: lastSuccessfulCheckDate,
    today,
    slaDays,
  });
  return { ...freshness, lastSuccessfulCheckDate: dataCurrentThrough };
}
