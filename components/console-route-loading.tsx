type ConsoleRouteLoadingProps = {
  eyebrow: string;
  message: string;
  title: string;
};

export function ConsoleRouteLoading({ eyebrow, message, title }: ConsoleRouteLoadingProps) {
  const headingId = `${eyebrow.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-loading-heading`;

  return (
    <section className="route-panel route-panel--full" aria-labelledby={headingId} aria-busy="true">
      <div className="route-panel__main">
        <div className="route-panel__header">
          <div className="route-panel__title">
            <p className="eyebrow">{eyebrow}</p>
            <h1 id={headingId}>{title}</h1>
          </div>
        </div>
        <div className="route-panel__body" role="status" aria-live="polite">
          <p>{message}</p>
        </div>
      </div>
    </section>
  );
}
