"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

type ConsoleRouteErrorProps = {
  area: string;
  backHref: string;
  backLabel: string;
  error: Error & { digest?: string };
  message: string;
  reset: () => void;
  title: string;
};

export function ConsoleRouteError({ area, backHref, backLabel, error, message, reset, title }: ConsoleRouteErrorProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const descriptionId = `${area}-recovery-description`;
  const headingId = `${area}-recovery-heading`;

  useEffect(() => {
    headingRef.current?.focus();

    if (process.env.NODE_ENV !== "production") {
      console.error(`${area} route failed`, error);
    }
  }, [area, error]);

  return (
    <section
      className="route-panel route-panel--full"
      aria-describedby={descriptionId}
      aria-labelledby={headingId}
      role="alert"
    >
      <div className="route-panel__main">
        <div className="route-panel__header">
          <div className="route-panel__title">
            <p className="eyebrow">Temporary problem</p>
            <h1 id={headingId} ref={headingRef} tabIndex={-1}>{title}</h1>
          </div>
        </div>
        <div className="route-panel__body">
          <p id={descriptionId}>{message}</p>
          <div className="button-row">
            <button className="button button--primary" type="button" onClick={reset}>
              Try again
            </button>
            <Link className="button button--ghost" href={backHref}>
              {backLabel}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
