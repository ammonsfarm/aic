import type { ReactNode } from "react";

type RoutePanelProps = {
  title: string;
  eyebrow: string;
  children: ReactNode;
  aside?: ReactNode;
};

export function RoutePanel({ title, eyebrow, children, aside }: RoutePanelProps) {
  return (
    <section className="route-panel">
      <div className="route-panel__main">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <div className="route-panel__body">{children}</div>
      </div>
      {aside ? <aside className="route-panel__aside">{aside}</aside> : null}
    </section>
  );
}
