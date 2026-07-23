import type { DataFreshness } from "@/lib/podcast-reporting";
import type { SuccessfulCheckFreshness } from "@/lib/operational-freshness";

function formatDate(value: string | null) {
  if (!value) {
    return "No data";
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

export function DataFreshnessNotice({ label, freshness }: { label: string; freshness: DataFreshness }) {
  const warning = freshness.state !== "current";
  return (
    <div className={warning ? "status-item status-item--warn" : "status-item"} role={warning ? "alert" : "status"}>
      <strong>{label}: {freshness.state === "current" ? "Current" : freshness.state === "stale" ? "Stale" : "Missing"}</strong>
      <span>Data current through {formatDate(freshness.dataCurrentThrough)}.</span>
      <small>
        {freshness.lagDays === null ? "No freshness date is available." : `${freshness.lagDays} day${freshness.lagDays === 1 ? "" : "s"} behind today.`}
        {` SLA: ${freshness.slaDays} day${freshness.slaDays === 1 ? "" : "s"}.`}
      </small>
    </div>
  );
}

export function SuccessfulCheckFreshnessNotice({
  label,
  freshness,
}: {
  label: string;
  freshness: SuccessfulCheckFreshness;
}) {
  const warning = freshness.state !== "current";
  return (
    <div className={warning ? "status-item status-item--warn" : "status-item"} role={warning ? "alert" : "status"}>
      <strong>{label}: {freshness.state === "current" ? "Current" : freshness.state === "stale" ? "Stale" : "Missing"}</strong>
      <span>Last successful check {formatDate(freshness.lastSuccessfulCheckDate)}.</span>
      <small>
        {freshness.lagDays === null
          ? "No successful check date is available."
          : `${freshness.lagDays} day${freshness.lagDays === 1 ? "" : "s"} since the last successful check.`}
        {` SLA: ${freshness.slaDays} day${freshness.slaDays === 1 ? "" : "s"}.`}
      </small>
    </div>
  );
}
