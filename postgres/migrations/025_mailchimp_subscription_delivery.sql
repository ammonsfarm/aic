begin;

alter table public_subscriptions
    drop constraint if exists public_subscriptions_status_check;

alter table public_subscriptions
    add constraint public_subscriptions_status_check
    check (status in ('pending', 'active', 'unsubscribed', 'suppressed'));

alter table public_subscriptions
    add column if not exists provider_status text not null default 'unknown',
    add column if not exists provider_member_id text,
    add column if not exists provider_synced_at timestamptz,
    add column if not exists provider_last_error text;

alter table public_subscriptions
    drop constraint if exists public_subscriptions_provider_status_check;

alter table public_subscriptions
    add constraint public_subscriptions_provider_status_check
    check (provider_status in ('unknown', 'pending', 'subscribed', 'unsubscribed', 'cleaned', 'error'));

create table if not exists public_subscription_provider_outbox (
    subscription_id bigint primary key references public_subscriptions(id) on delete cascade,
    desired_action text not null,
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
    check (desired_action in ('subscribe', 'unsubscribe')),
    check (status in ('queued', 'running', 'completed', 'failed')),
    check (generation > 0),
    check (attempt_count >= 0),
    check (length(last_error) <= 2000)
);

create index if not exists idx_public_subscription_provider_outbox_claim
    on public_subscription_provider_outbox(status, available_at, updated_at)
    where status in ('queued', 'failed');

create table if not exists public_subscription_provider_webhook_events (
    event_key text primary key,
    event_type text not null,
    provider_member_id text not null,
    received_at timestamptz not null default now(),
    check (length(event_key) = 64),
    check (event_type in ('subscribe', 'unsubscribe', 'cleaned'))
);

alter table public_subscription_events
    drop constraint if exists public_subscription_events_event_type_check;

alter table public_subscription_events
    add constraint public_subscription_events_event_type_check
    check (event_type in (
        'consent-captured',
        'resubscribe-blocked-suppressed',
        'unsubscribed',
        'unsubscribe-confirmed-suppressed',
        'admin-suppressed',
        'provider-confirmed',
        'provider-unsubscribed',
        'provider-cleaned',
        'provider-sync-failed',
        'provider-sync-retried'
    ));

alter table public_subscription_events
    drop constraint if exists public_subscription_events_actor_type_check;

alter table public_subscription_events
    add constraint public_subscription_events_actor_type_check
    check (actor_type in ('public-form', 'signed-link', 'content-manager', 'provider-webhook', 'system-worker'));

commit;
