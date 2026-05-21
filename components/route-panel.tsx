import type { ReactNode } from "react";

type RoutePanelProps = {
  title: string;
  eyebrow: string;
  children: ReactNode;
  aside?: ReactNode;
  actions?: ReactNode;
};

export function RoutePanel({ title, eyebrow, children, aside, actions }: RoutePanelProps) {
  return (
    <section className={aside ? "route-panel" : "route-panel route-panel--full"}>
      <div className="route-panel__main">
        <div className="route-panel__header">
          <div className="route-panel__title">
            <p className="eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
          </div>
          {actions ? <div className="route-panel__actions">{actions}</div> : null}
        </div>
        <div className="route-panel__body">{children}</div>
      </div>
      {aside ? <aside className="route-panel__aside">{aside}</aside> : null}
    </section>
  );
}
