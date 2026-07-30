import type { ProviderReadinessItem } from "@/lib/provider-readiness";

function stateClass(state: ProviderReadinessItem["state"]) {
  if (state === "configured") return "status-item status-item--active";
  if (state === "inactive") return "status-item";
  return "status-item status-item--warn";
}

function EnvironmentKeys({ label, keys }: { label: string; keys: string[] }) {
  if (keys.length === 0) return null;
  return (
    <div className="readiness-card__keys">
      <strong>{label}</strong>
      <div>
        {keys.map((key) => <code key={key}>{key}</code>)}
      </div>
    </div>
  );
}

export function ProviderReadiness({ items }: { items: ProviderReadinessItem[] }) {
  return (
    <section className="admin-section" id="provider-readiness" aria-labelledby="provider-readiness-title">
      <div className="admin-section__header">
        <div>
          <p className="eyebrow">Production readiness</p>
          <h2 id="provider-readiness-title">Public providers and launch gates</h2>
        </div>
        <span className="status-item">Administrator only</span>
      </div>
      <p className="note">
        This view reports safe configuration and durable application evidence. It never displays provider destinations,
        account identifiers, credentials, tokens, or environment values.
      </p>
      <div className="readiness-grid">
        {items.map((entry) => (
          <article className={`readiness-card readiness-card--${entry.state}`} key={entry.id}>
            <div className="readiness-card__header">
              <h3>{entry.label}</h3>
              <span className={stateClass(entry.state)}>{entry.stateLabel}</span>
            </div>
            <p>{entry.summary}</p>
            <small>{entry.evidence}</small>
            <EnvironmentKeys
              label={entry.state === "inactive" ? "Required before activation" : "Missing environment keys"}
              keys={entry.missingEnvironmentKeys}
            />
            <EnvironmentKeys label="Environment keys to review" keys={entry.invalidEnvironmentKeys} />
          </article>
        ))}
      </div>
    </section>
  );
}
