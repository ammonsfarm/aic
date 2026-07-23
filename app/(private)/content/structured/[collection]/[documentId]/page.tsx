import Link from "next/link";
import { notFound } from "next/navigation";

import { StructuredContentForm } from "@/components/structured-content-form";
import {
  getStructuredEntry,
  getLatestEpisodeProcessingRequest,
  listStructuredRevisions,
  type EpisodeProcessingRequest,
  type StructuredEntry,
  type StructuredRevision,
} from "@/lib/strapi-structured-management";
import { getStructuredCollection, type StructuredCollectionKey } from "@/lib/structured-content-config";
import {
  deleteStructuredEntryAction,
  retryEpisodeProcessingAction,
  rollbackStructuredEntryAction,
  saveStructuredEntryAction,
  transitionStructuredEntryAction,
} from "../../actions";

export const dynamic = "force-dynamic";

function formatDate(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function notice(query: Record<string, string | undefined>) {
  if (query.created) return "Draft created. It is not public until you publish it.";
  if (query.saved) return "Draft revision saved. The live version was not changed.";
  if (query.publish) return "Published version updated.";
  if (query.unpublish) return "Content unpublished. The draft remains available.";
  if (query.archive) return "Content archived and removed from public listings.";
  if (query.restore) return "Content restored as a private draft.";
  if (query.rolledBack) return "The selected revision was restored as a new draft.";
  if (query.processingRetry) return "Episode processing was queued for another bounded attempt.";
  return "";
}

export async function StructuredEntryEditorView({
  collection,
  documentId,
  query,
}: {
  collection: StructuredCollectionKey;
  documentId: string;
  query: Record<string, string | undefined>;
}) {
  const definition = getStructuredCollection(collection);
  if (!definition) {
    notFound();
  }

  let entry: StructuredEntry | null = null;
  let revisions: StructuredRevision[] = [];
  let revisionsError = "";
  let processing: EpisodeProcessingRequest | null = null;
  let processingError = "";
  try {
    entry = await getStructuredEntry(definition.key, documentId);
    if (entry) {
      try {
        revisions = await listStructuredRevisions(definition.key, documentId);
      } catch (cause) {
        console.error("Structured revisions lookup failed", cause);
        revisionsError = cause instanceof Error ? cause.message : "Revision history could not be loaded.";
      }
      if (definition.entityType === "episode") {
        try {
          processing = await getLatestEpisodeProcessingRequest(documentId);
        } catch (cause) {
          console.error("Episode processing lookup failed", cause);
          processingError = cause instanceof Error ? cause.message : "Episode processing status could not be loaded.";
        }
      }
    }
  } catch (cause) {
    console.error("Structured content lookup failed", cause);
    throw cause;
  }

  if (!entry) {
    notFound();
  }

  const title = String(entry[definition.titleField] || "Untitled");
  const archived = Boolean(entry.archivedAt);
  const saveAction = saveStructuredEntryAction.bind(null, definition.key, documentId);
  const success = notice(query);

  return (
    <div className="stack">
      <section className="signal-board">
        <div>
          <p className="eyebrow">Content / {definition.pluralLabel}</p>
          <h1>{title}</h1>
          <p>
            {archived
              ? "Archived content is private. Restore it before editing or publishing again."
              : entry.isPublished
                ? "A published version is live. Saving changes creates a draft until Publish is selected."
                : "This item is currently a private draft."}
          </p>
        </div>
        <div className="status-list" aria-label="Editorial state">
          <span><strong>{archived ? "Archived" : entry.isPublished ? "Published" : "Draft"}</strong>Visibility</span>
          <span><strong>{revisions.length}</strong>Revisions</span>
          <span><strong>{formatDate(entry.updatedAt as string | undefined)}</strong>Updated</span>
        </div>
      </section>

      {success ? (
        <section className="notice-card notice-card--success" role="status">
          <strong>Editorial action completed</strong>
          <p>{success}</p>
        </section>
      ) : null}

      <section className="data-card">
        <div className="data-card__header">
          <div><p className="eyebrow">Draft editor</p><h2>Content details</h2></div>
          <div className="button-row">
            <Link className="button button--ghost" href={definition.editorPath}>Back to inventory</Link>
            <Link className="button button--ghost" href={`${definition.editorPath}/${documentId}/preview`}>Preview draft</Link>
          </div>
        </div>
        <StructuredContentForm definition={definition} entry={entry} action={saveAction} />
      </section>

      {definition.entityType === "episode" ? (
        <section className="data-card">
          <div className="data-card__header">
            <div><p className="eyebrow">Podcast pipeline</p><h2>Publication processing</h2></div>
          </div>
          {processingError ? <div className="editor-form"><p role="alert">{processingError}</p></div> : null}
          {!processing && !processingError ? (
            <div className="editor-form">
              <p className="muted-copy">No processing request exists yet. Publishing creates one in the same durable editorial transaction.</p>
            </div>
          ) : null}
          {processing ? (
            <div className="editor-form">
              <div className="status-list" aria-label="Episode processing state">
                <span><strong>{processing.status}</strong>Pipeline state</span>
                <span><strong>{processing.attemptCount}</strong>Attempts</span>
                <span><strong>{processing.trackId}</strong>Track ID</span>
                <span><strong>Revision {processing.revisionNumber}</strong>Publication source</span>
              </div>
              {processing.status === "queued" ? <p role="status">Queued for the background podcast worker.</p> : null}
              {processing.status === "running" ? <p role="status">The transcript, intelligence, and vector pipeline is running.</p> : null}
              {processing.status === "completed" ? <p role="status">Operational episode metadata and processing coverage were verified.</p> : null}
              {processing.status === "failed" ? <p role="alert">Processing reached its bounded retry limit and needs review.</p> : null}
              {processing.status === "superseded" ? <p role="status">A newer publication revision replaced this request.</p> : null}
              {processing.lastError ? <p role="alert"><strong>Latest error:</strong> {processing.lastError}</p> : null}
              {processing.status === "failed" || processing.status === "completed" ? (
                <form className="editor-grid editor-grid--two" action={retryEpisodeProcessingAction.bind(null, documentId)}>
                  <label>
                    <span>Retry note</span>
                    <input name="processingRetryNote" required placeholder="Why should this episode be processed again?" />
                  </label>
                  <div className="editor-form__actions">
                    <button className="button button--ghost" type="submit">Queue processing retry</button>
                  </div>
                </form>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="data-card">
        <div className="data-card__header">
          <div><p className="eyebrow">Publishing</p><h2>Visibility and lifecycle</h2></div>
        </div>
        <div className="editor-form">
          <p className="muted-copy">
            Publishing, unpublishing, archiving, and restoration are explicit actions. Each action records the signed-in editor.
          </p>
          {!archived && definition.publishable ? (
            <form
              className="editor-grid editor-grid--two"
              action={transitionStructuredEntryAction.bind(
                null,
                definition.key,
                documentId,
                entry.isPublished ? "unpublish" : "publish",
              )}
            >
              <label>
                <span>Action note</span>
                <input name="transitionNote" placeholder="Reason for this publishing action" />
              </label>
              <div className="editor-form__actions">
                <button className="button" type="submit">{entry.isPublished ? "Unpublish" : "Publish draft"}</button>
              </div>
            </form>
          ) : null}

          {!archived ? (
            <form
              className="editor-grid editor-grid--two"
              action={transitionStructuredEntryAction.bind(null, definition.key, documentId, "archive")}
            >
              <label>
                <span>Archive reason</span>
                <input name="transitionNote" required placeholder="Why should this item leave normal use?" />
              </label>
              <div className="editor-form__actions">
                <button className="button button--ghost" type="submit">Archive</button>
              </div>
            </form>
          ) : (
            <form
              className="editor-grid editor-grid--two"
              action={transitionStructuredEntryAction.bind(null, definition.key, documentId, "restore")}
            >
              <label>
                <span>Restore note</span>
                <input name="transitionNote" required placeholder="Why is this item being restored?" />
              </label>
              <div className="editor-form__actions">
                <button className="button" type="submit">Restore as draft</button>
              </div>
            </form>
          )}
        </div>
      </section>

      <section className="data-card">
        <div className="data-card__header">
          <div><p className="eyebrow">Revision history</p><h2>Audit trail and rollback</h2></div>
        </div>
        {revisionsError ? (
          <div className="editor-form"><p role="alert">{revisionsError}</p></div>
        ) : (
          <div className="responsive-table" role="region" aria-label="Revision history">
            <table>
              <thead><tr><th>Revision</th><th>Action</th><th>Editor</th><th>Note</th><th>Created</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {revisions.map((revision) => (
                  <tr key={revision.documentId}>
                    <td>#{revision.revisionNumber}</td>
                    <td>{revision.action}</td>
                    <td>{revision.actorName || revision.actorEmail}</td>
                    <td>{revision.note || "—"}</td>
                    <td>{formatDate(revision.createdAt)}</td>
                    <td>
                      <form action={rollbackStructuredEntryAction.bind(null, definition.key, documentId, revision.documentId)}>
                        <input type="hidden" name="rollbackNote" value={`Restore revision ${revision.revisionNumber}`} />
                        <button className="button button--ghost" type="submit">Restore as draft</button>
                      </form>
                    </td>
                  </tr>
                ))}
                {!revisions.length ? <tr><td colSpan={6}><span className="muted-copy">No revision records yet.</span></td></tr> : null}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="notice-card">
        <details>
          <summary><strong>Permanent deletion</strong></summary>
          <form className="editor-form" action={deleteStructuredEntryAction.bind(null, definition.key, documentId, title)}>
            <p>Deletion removes both draft and published versions. The final audit snapshot is retained.</p>
            <label>
              <span>Type “{title}” to confirm</span>
              <input name="deleteConfirmation" required autoComplete="off" />
            </label>
            <label>
              <span>Deletion reason</span>
              <input name="deleteNote" required />
            </label>
            <div className="editor-form__actions">
              <button className="button button--ghost" type="submit">Delete permanently</button>
            </div>
          </form>
        </details>
      </section>
    </div>
  );
}

export default async function StructuredEntryEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ collection: string; documentId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { collection, documentId } = await params;
  const definition = getStructuredCollection(collection);
  if (!definition) {
    notFound();
  }
  return StructuredEntryEditorView({
    collection: definition.key,
    documentId: decodeURIComponent(documentId),
    query: await searchParams,
  });
}
