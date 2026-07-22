begin;

create table if not exists pipeline_retry_requests (
    id bigserial primary key,
    stage text not null,
    source_run_id text,
    reason text not null default '',
    status text not null default 'queued',
    requested_by text not null,
    requested_at timestamptz not null default now(),
    started_at timestamptz,
    completed_at timestamptz,
    worker_id text not null default '',
    output_summary text not null default '',
    error text not null default '',
    updated_at timestamptz not null default now(),
    check (stage in ('daily-ingest', 'podtrac-import', 'transcript-edits')),
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
    check (length(requested_by) > 0),
    check (length(reason) <= 1000)
);

create unique index if not exists idx_pipeline_retry_one_active_stage
    on pipeline_retry_requests(stage)
    where status in ('queued', 'running');
create index if not exists idx_pipeline_retry_status_requested
    on pipeline_retry_requests(status, requested_at);

create table if not exists podtrac_reconciliation_audit (
    id bigserial primary key,
    podtrac_episode_id text not null references podtrac_episodes(podtrac_episode_id) on delete cascade,
    previous_track_id text references episodes(track_id) on delete set null,
    assigned_track_id text references episodes(track_id) on delete set null,
    previous_match_status text not null default '',
    action text not null,
    note text not null default '',
    actor_email text not null,
    created_at timestamptz not null default now(),
    check (action in ('match', 'unmatch')),
    check (length(actor_email) > 0),
    check (length(note) <= 1000)
);

create index if not exists idx_podtrac_reconciliation_episode_created
    on podtrac_reconciliation_audit(podtrac_episode_id, created_at desc);

create table if not exists admin_operation_audit (
    id bigserial primary key,
    action text not null,
    entity_type text not null,
    entity_id text not null,
    actor_email text not null,
    detail_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    check (length(action) > 0),
    check (length(entity_type) > 0),
    check (length(entity_id) > 0),
    check (length(actor_email) > 0)
);

create index if not exists idx_admin_operation_audit_created
    on admin_operation_audit(created_at desc);
create index if not exists idx_admin_operation_audit_entity
    on admin_operation_audit(entity_type, entity_id, created_at desc);

commit;
