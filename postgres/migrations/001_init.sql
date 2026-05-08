begin;

create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

create table if not exists episodes (
    track_id text primary key,
    title text not null,
    publish_date text not null default '',
    album text not null default '',
    category text not null default '',
    detail text not null default '',
    source_file text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists transcript_chunks (
    custom_id text primary key,
    track_id text not null references episodes(track_id) on delete cascade,
    title text not null,
    publish_date text not null default '',
    category text not null default '',
    detail text not null default '',
    start_time text not null default '',
    end_time text not null default '',
    speakers jsonb not null default '[]'::jsonb,
    segment_type text not null default 'speech',
    source_file text not null default '',
    text text not null,
    embedding vector(1536),
    embedding_model text not null default '',
    embedding_dimensions integer not null default 0,
    prompt_tokens integer not null default 0,
    metadata jsonb not null default '{}'::jsonb,
    sqlite_created_at text not null default '',
    search_tsv tsvector generated always as (
        to_tsvector('english', coalesce(title, '') || ' ' || coalesce(text, ''))
    ) stored,
    updated_at timestamptz not null default now()
);

create table if not exists episode_intelligence (
    track_id text primary key references episodes(track_id) on delete cascade,
    title text not null,
    publish_date text not null default '',
    episode_type text not null default 'unknown',
    executive_summary text not null default '',
    long_summary text not null default '',
    main_topics jsonb not null default '[]'::jsonb,
    search_keywords jsonb not null default '[]'::jsonb,
    raw_json jsonb not null default '{}'::jsonb,
    source_file text not null default '',
    source_model text not null default '',
    input_chars integer not null default 0,
    transcript_truncated boolean not null default false,
    status text not null default '',
    error text not null default '',
    sqlite_created_at text not null default '',
    source_updated_at text not null default '',
    search_tsv tsvector generated always as (
        to_tsvector('english', coalesce(title, '') || ' ' || coalesce(executive_summary, '') || ' ' || coalesce(long_summary, ''))
    ) stored,
    updated_at timestamptz not null default now()
);

create table if not exists episode_intelligence_items (
    id bigint primary key,
    track_id text not null references episodes(track_id) on delete cascade,
    item_type text not null,
    label text not null default '',
    summary text not null default '',
    source_times jsonb not null default '[]'::jsonb,
    speakers jsonb not null default '[]'::jsonb,
    confidence text not null default '',
    value_json jsonb not null default '{}'::jsonb,
    sqlite_created_at text not null default '',
    search_tsv tsvector generated always as (
        to_tsvector('english', coalesce(label, '') || ' ' || coalesce(summary, ''))
    ) stored,
    updated_at timestamptz not null default now()
);

create table if not exists episode_intelligence_vectors (
    custom_id text primary key,
    vector_type text not null,
    track_id text not null references episodes(track_id) on delete cascade,
    title text not null,
    publish_date text not null default '',
    episode_type text not null default '',
    label text not null default '',
    text text not null,
    source_table text not null,
    source_id text not null,
    source_field text not null,
    source_model text not null default '',
    source_updated_at text not null default '',
    content_hash text not null,
    source_times jsonb not null default '[]'::jsonb,
    speakers jsonb not null default '[]'::jsonb,
    confidence text not null default '',
    metadata jsonb not null default '{}'::jsonb,
    embedding vector(1536),
    embedding_model text not null default '',
    embedding_dimensions integer not null default 0,
    prompt_tokens integer not null default 0,
    sqlite_created_at text not null default '',
    search_tsv tsvector generated always as (
        to_tsvector('english', coalesce(title, '') || ' ' || coalesce(label, '') || ' ' || coalesce(text, ''))
    ) stored,
    updated_at timestamptz not null default now()
);

create table if not exists sync_runs (
    id bigserial primary key,
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    source_sqlite_path text not null,
    episodes_count integer not null default 0,
    transcript_chunks_count integer not null default 0,
    episode_intelligence_count integer not null default 0,
    episode_intelligence_items_count integer not null default 0,
    episode_intelligence_vectors_count integer not null default 0,
    status text not null default 'running',
    error text not null default ''
);

create index if not exists idx_transcript_chunks_track on transcript_chunks(track_id);
create index if not exists idx_transcript_chunks_tsv on transcript_chunks using gin(search_tsv);
create index if not exists idx_transcript_chunks_speakers on transcript_chunks using gin(speakers);
create index if not exists idx_transcript_chunks_embedding_hnsw on transcript_chunks using hnsw (embedding vector_cosine_ops);

create index if not exists idx_episode_intelligence_type on episode_intelligence(episode_type);
create index if not exists idx_episode_intelligence_tsv on episode_intelligence using gin(search_tsv);
create index if not exists idx_episode_intelligence_topics on episode_intelligence using gin(main_topics);
create index if not exists idx_episode_intelligence_keywords on episode_intelligence using gin(search_keywords);

create index if not exists idx_episode_intelligence_items_track on episode_intelligence_items(track_id);
create index if not exists idx_episode_intelligence_items_type on episode_intelligence_items(item_type);
create index if not exists idx_episode_intelligence_items_tsv on episode_intelligence_items using gin(search_tsv);

create index if not exists idx_episode_intelligence_vectors_track on episode_intelligence_vectors(track_id);
create index if not exists idx_episode_intelligence_vectors_type on episode_intelligence_vectors(vector_type);
create index if not exists idx_episode_intelligence_vectors_tsv on episode_intelligence_vectors using gin(search_tsv);
create index if not exists idx_episode_intelligence_vectors_embedding_hnsw on episode_intelligence_vectors using hnsw (embedding vector_cosine_ops);

commit;
