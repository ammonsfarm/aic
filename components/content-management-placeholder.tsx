import Link from "next/link";
import { RoutePanel } from "@/components/route-panel";

type Action = {
  href: string;
  label: string;
};

type ContentManagementPlaceholderProps = {
  eyebrow: string;
  title: string;
  description: string;
  primaryAction?: Action;
  checklist: string[];
  notes?: string[];
};

export function ContentManagementPlaceholder({
  eyebrow,
  title,
  description,
  primaryAction,
  checklist,
  notes = [],
}: ContentManagementPlaceholderProps) {
  return (
    <RoutePanel
      eyebrow={eyebrow}
      title={title}
      actions={
        primaryAction ? (
          <Link className="button button--primary" href={primaryAction.href}>
            {primaryAction.label}
          </Link>
        ) : null
      }
      aside={
        <div className="research-aside">
          <p>This Phase 1 screen establishes the protected route and future CMS scope.</p>
          <div className="research-aside__list" aria-label={`${title} notes`}>
            {notes.map((note) => (
              <span key={note}>{note}</span>
            ))}
          </div>
        </div>
      }
    >
      <p>{description}</p>
      <div className="coverage-list">
        {checklist.map((item) => (
          <span key={item}>
            <strong>Planned</strong>
            {item}
          </span>
        ))}
      </div>
    </RoutePanel>
  );
}
