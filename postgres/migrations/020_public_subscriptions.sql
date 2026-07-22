begin;

create table if not exists public_subscriptions (
    id bigserial primary key,
    email text not null unique,
    status text not null default 'active',
    consent_version text not null,
    consent_text text not null,
    consent_at timestamptz not null default now(),
    source_path text not null default '/',
    ip_hash text not null,
    user_agent_hash text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unsubscribed_at timestamptz,
    check (email = lower(email)),
    check (status in ('active', 'unsubscribed', 'suppressed')),
    check (length(ip_hash) = 64),
    check (length(user_agent_hash) = 64)
);

create table if not exists public_subscription_attempts (
    id bigserial primary key,
    ip_hash text not null,
    email_hash text not null,
    accepted boolean not null default false,
    created_at timestamptz not null default now(),
    check (length(ip_hash) = 64),
    check (length(email_hash) = 64)
);

create index if not exists idx_public_subscriptions_status_created
    on public_subscriptions(status, created_at desc);

create index if not exists idx_public_subscription_attempts_ip_created
    on public_subscription_attempts(ip_hash, created_at desc);

create index if not exists idx_public_subscription_attempts_email_created
    on public_subscription_attempts(email_hash, created_at desc);

commit;
