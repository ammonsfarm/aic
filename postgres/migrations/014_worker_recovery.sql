begin;

alter table transcript_edit_requests
    add column if not exists attempt_count integer not null default 0,
    add column if not exists next_attempt_at timestamptz not null default now(),
    add column if not exists claimed_at timestamptz,
    add column if not exists worker_id text not null default '',
    add column if not exists revectorization_attempt_count integer not null default 0,
    add column if not exists next_revectorization_at timestamptz not null default now(),
    add column if not exists revectorization_claimed_at timestamptz,
    add column if not exists revectorization_worker_id text not null default '';

alter table transcript_edit_requests
    drop constraint if exists transcript_edit_requests_attempt_count_check;
alter table transcript_edit_requests
    add constraint transcript_edit_requests_attempt_count_check
    check (attempt_count >= 0 and revectorization_attempt_count >= 0);

create index if not exists idx_transcript_edit_requests_claimable
    on transcript_edit_requests(status, next_attempt_at, created_at);
create index if not exists idx_transcript_edit_requests_revectorization
    on transcript_edit_requests(next_revectorization_at, updated_at)
    where status = 'applied' and needs_revectorization;

alter table pipeline_retry_requests
    add column if not exists recovery_count integer not null default 0;

alter table pipeline_retry_requests
    drop constraint if exists pipeline_retry_requests_recovery_count_check;
alter table pipeline_retry_requests
    add constraint pipeline_retry_requests_recovery_count_check
    check (recovery_count >= 0);

commit;
