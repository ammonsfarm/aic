begin;

alter table public_contact_message_events
    drop constraint if exists public_contact_message_events_event_type_check;

alter table public_contact_message_events
    add constraint public_contact_message_events_event_type_check
    check (event_type in (
        'received',
        'status_changed',
        'notification_sent',
        'notification_failed',
        'notification_recovered'
    ));

alter table public_contact_message_events
    drop constraint if exists public_contact_message_events_actor_type_check;

alter table public_contact_message_events
    add constraint public_contact_message_events_actor_type_check
    check (actor_type in ('public_form', 'content_manager', 'system_worker'));

create table if not exists public_contact_notification_outbox (
    contact_message_id bigint primary key references public_contact_messages(id) on delete cascade,
    status text not null default 'queued',
    generation bigint not null default 1,
    attempt_count integer not null default 0,
    available_at timestamptz not null default now(),
    started_at timestamptz,
    completed_at timestamptz,
    worker_id text not null default '',
    last_error text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (status in ('queued', 'running', 'completed', 'failed')),
    check (generation > 0),
    check (attempt_count >= 0),
    check (length(worker_id) <= 200),
    check (length(last_error) <= 1000),
    check ((status = 'running') = (worker_id <> '')),
    check (status <> 'running' or started_at is not null),
    check (status <> 'completed' or completed_at is not null)
);

create index if not exists idx_public_contact_notification_outbox_claim
    on public_contact_notification_outbox(available_at, updated_at, contact_message_id)
    where status = 'queued';

create index if not exists idx_public_contact_notification_outbox_stale
    on public_contact_notification_outbox(started_at, contact_message_id)
    where status = 'running';

commit;
