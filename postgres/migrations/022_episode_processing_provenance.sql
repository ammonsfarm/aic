begin;

create table if not exists episode_processing_provenance (
    track_id text primary key references episodes(track_id) on delete cascade,
    episode_document_id text not null,
    revision_number integer not null,
    request_key text not null,
    audio_source text not null,
    audio_fingerprint text not null,
    completed_at timestamptz not null,
    updated_at timestamptz not null default now(),
    check (revision_number > 0),
    check (length(episode_document_id) > 0),
    check (length(request_key) > 0),
    check (length(audio_source) > 0),
    check (audio_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

create index if not exists idx_episode_processing_provenance_document
    on episode_processing_provenance(episode_document_id, revision_number desc);

commit;
