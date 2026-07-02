import Link from "next/link";

export default async function ContentPageDetail({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;

  return (
    <div className="stack">
      <section className="signal-board">
        <div>
          <p className="eyebrow">Content / Pages</p>
          <h1>Page editor: {pageId}</h1>
          <p>Edit page metadata and hero fields. Database-backed loading is being wired in the next pass.</p>
        </div>
      </section>

      <section className="data-card">
        <div className="data-card__header">
          <div>
            <p className="eyebrow">Editor</p>
            <h2>Editable fields</h2>
          </div>
          <Link className="button button--ghost" href="/content/pages">Back to pages</Link>
        </div>
      </section>
    </div>
  );
}
