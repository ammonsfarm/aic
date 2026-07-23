begin;

create table if not exists episode_processing_ownership (
    track_id text primary key,
    episode_document_id text not null unique,
    source_fingerprint text not null default '',
    claimed_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (track_id, episode_document_id),
    check (length(track_id) between 1 and 100),
    check (length(episode_document_id) > 0),
    check (source_fingerprint = '' or source_fingerprint ~ '^[0-9a-f]{64}$')
);

create table if not exists episode_processing_provenance (
    track_id text primary key,
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
    check (audio_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
    foreign key (track_id, episode_document_id)
        references episode_processing_ownership(track_id, episode_document_id)
        on delete restrict
);

create index if not exists idx_episode_processing_provenance_document
    on episode_processing_provenance(episode_document_id, revision_number desc);

commit;
