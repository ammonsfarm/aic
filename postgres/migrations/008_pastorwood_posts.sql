begin;

create table if not exists pastorwood_scrape_runs (
    id bigserial primary key,
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    source_base_url text not null default 'https://www.pastorwood.org',
    source_type text not null default 'pastorwood_devotional',
    category_id integer,
    after_date date,
    pages_seen integer not null default 0,
    posts_seen integer not null default 0,
    posts_upserted integer not null default 0,
    chunks_upserted integer not null default 0,
    status text not null default 'running',
    error text not null default '',
    metadata jsonb not null default '{}'::jsonb
);

create table if not exists pastorwood_posts (
    post_id bigint primary key,
    source_type text not null default 'pastorwood_devotional',
    wp_category_id integer,
    title text not null,
    slug text not null,
    source_url text not null unique,
    publish_date date,
    published_at timestamptz,
    modified_at timestamptz,
    excerpt_html text not null default '',
    content_html text not null default '',
    text text not null,
    content_hash text not null,
    raw_json jsonb not null default '{}'::jsonb,
    last_scrape_run_id bigint references pastorwood_scrape_runs(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    search_tsv tsvector generated always as (
        to_tsvector('english', coalesce(title, '') || ' ' || coalesce(text, ''))
    ) stored,
    check (source_type in ('pastorwood_devotional', 'pastorwood_resource'))
);

create table if not exists pastorwood_post_chunks (
    custom_id text primary key,
    post_id bigint not null references pastorwood_posts(post_id) on delete cascade,
    source_type text not null default 'pastorwood_devotional',
    title text not null,
    publish_date text not null default '',
    source_url text not null default '',
    chunk_index integer not null,
    text text not null,
    content_hash text not null,
    embedding vector(1536),
    embedding_model text not null default '',
    embedding_dimensions integer not null default 0,
    prompt_tokens integer not null default 0,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    search_tsv tsvector generated always as (
        to_tsvector('english', coalesce(title, '') || ' ' || coalesce(text, ''))
    ) stored,
    unique(post_id, chunk_index),
    check (source_type in ('pastorwood_devotional', 'pastorwood_resource'))
);

create index if not exists idx_pastorwood_posts_source_type on pastorwood_posts(source_type);
create index if not exists idx_pastorwood_posts_publish_date on pastorwood_posts(publish_date);
create index if not exists idx_pastorwood_posts_search_tsv on pastorwood_posts using gin(search_tsv);

create index if not exists idx_pastorwood_post_chunks_post_id on pastorwood_post_chunks(post_id);
create index if not exists idx_pastorwood_post_chunks_source_type on pastorwood_post_chunks(source_type);
create index if not exists idx_pastorwood_post_chunks_publish_date on pastorwood_post_chunks(publish_date);
create index if not exists idx_pastorwood_post_chunks_search_tsv on pastorwood_post_chunks using gin(search_tsv);
create index if not exists idx_pastorwood_post_chunks_embedding_hnsw on pastorwood_post_chunks using hnsw (embedding vector_cosine_ops);

commit;
