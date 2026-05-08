begin;

create table if not exists podtrac_import_runs (
    run_id integer primary key,
    imported_at text not null,
    source_har_files jsonb not null default '[]'::jsonb,
    summary jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

create table if not exists podtrac_import_metadata (
    key text primary key,
    value jsonb not null,
    updated_at timestamptz not null default now()
);

create table if not exists podtrac_episodes (
    podtrac_episode_id text primary key,
    title text not null,
    publish_date date,
    import_run_id integer references podtrac_import_runs(run_id) on delete set null,
    imported_at text not null default '',
    track_id text references episodes(track_id) on delete set null,
    matched_episode_title text not null default '',
    matched_episode_publish_date text not null default '',
    match_status text not null default 'unmatched',
    match_method text not null default '',
    match_score numeric(6,5),
    match_notes text not null default '',
    title_normalized text not null default '',
    updated_at timestamptz not null default now()
);

create table if not exists podtrac_countries (
    podtrac_country_id text primary key,
    name text not null,
    import_run_id integer references podtrac_import_runs(run_id) on delete set null,
    imported_at text not null default '',
    updated_at timestamptz not null default now()
);

create table if not exists podtrac_clients (
    podtrac_client_id text primary key,
    name text not null,
    import_run_id integer references podtrac_import_runs(run_id) on delete set null,
    imported_at text not null default '',
    updated_at timestamptz not null default now()
);

create table if not exists podtrac_daily_activity (
    activity_date date not null,
    podtrac_episode_id text not null references podtrac_episodes(podtrac_episode_id) on delete cascade,
    download_count integer not null check (download_count >= 0),
    import_run_id integer references podtrac_import_runs(run_id) on delete set null,
    imported_at text not null default '',
    updated_at timestamptz not null default now(),
    primary key (activity_date, podtrac_episode_id)
);

create table if not exists podtrac_activity_by_country (
    activity_date date not null,
    podtrac_country_id text not null references podtrac_countries(podtrac_country_id) on delete cascade,
    download_count integer not null check (download_count >= 0),
    import_run_id integer references podtrac_import_runs(run_id) on delete set null,
    imported_at text not null default '',
    updated_at timestamptz not null default now(),
    primary key (activity_date, podtrac_country_id)
);

create table if not exists podtrac_activity_by_client (
    activity_date date not null,
    podtrac_client_id text not null references podtrac_clients(podtrac_client_id) on delete cascade,
    download_count integer not null check (download_count >= 0),
    import_run_id integer references podtrac_import_runs(run_id) on delete set null,
    imported_at text not null default '',
    updated_at timestamptz not null default now(),
    primary key (activity_date, podtrac_client_id)
);

create table if not exists podtrac_sync_runs (
    id bigserial primary key,
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    source_sqlite_path text not null,
    import_runs_count integer not null default 0,
    metadata_count integer not null default 0,
    episodes_count integer not null default 0,
    countries_count integer not null default 0,
    clients_count integer not null default 0,
    daily_activity_count integer not null default 0,
    country_activity_count integer not null default 0,
    client_activity_count integer not null default 0,
    matched_episodes_count integer not null default 0,
    unmatched_episodes_count integer not null default 0,
    status text not null default 'running',
    error text not null default ''
);

create index if not exists idx_podtrac_episodes_track on podtrac_episodes(track_id);
create index if not exists idx_podtrac_episodes_publish_date on podtrac_episodes(publish_date);
create index if not exists idx_podtrac_episodes_match_status on podtrac_episodes(match_status);
create index if not exists idx_podtrac_episodes_title_trgm on podtrac_episodes using gin(title gin_trgm_ops);
create index if not exists idx_podtrac_daily_activity_track_date on podtrac_daily_activity(podtrac_episode_id, activity_date);
create index if not exists idx_podtrac_daily_activity_date on podtrac_daily_activity(activity_date);
create index if not exists idx_podtrac_country_activity_date on podtrac_activity_by_country(activity_date);
create index if not exists idx_podtrac_client_activity_date on podtrac_activity_by_client(activity_date);

commit;
