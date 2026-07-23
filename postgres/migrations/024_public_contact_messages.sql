begin;

create table if not exists public_contact_messages (
    id bigserial primary key,
    public_id uuid not null unique,
    category text not null,
    name text not null,
    email text not null,
    phone text,
    organization text,
    subject text not null,
    message text not null,
    status text not null default 'new',
    status_updated_by text,
    consent_version text not null,
    consent_text text not null,
    consent_at timestamptz not null default now(),
    source_path text not null default '/contact/',
    ip_hash text not null,
    user_agent_hash text not null,
    notification_status text not null default 'not_configured',
    notification_detail text,
    notified_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    resolved_at timestamptz,
    check (category in ('general', 'feedback', 'prayer', 'speaking')),
    check (status in ('new', 'in_review', 'resolved', 'archived')),
    check (notification_status in ('not_configured', 'pending', 'sent', 'failed')),
    check (email = lower(email)),
    check (length(name) between 2 and 120),
    check (length(email) <= 254),
    check (phone is null or length(phone) <= 40),
    check (organization is null or length(organization) <= 160),
    check (length(subject) between 3 and 160),
    check (length(message) between 10 and 5000),
    check (length(ip_hash) = 64),
    check (length(user_agent_hash) = 64)
);

create table if not exists public_contact_attempts (
    id bigserial primary key,
    ip_hash text not null,
    sender_hash text not null,
    accepted boolean not null default false,
    created_at timestamptz not null default now(),
    check (length(ip_hash) = 64),
    check (length(sender_hash) = 64)
);

create table if not exists public_contact_message_events (
    id bigserial primary key,
    contact_message_id bigint not null references public_contact_messages(id) on delete cascade,
    event_type text not null,
    actor_type text not null,
    actor_email text,
    note text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    check (event_type in ('received', 'status_changed')),
    check (actor_type in ('public_form', 'content_manager')),
    check (note is null or length(note) <= 500)
);

create index if not exists idx_public_contact_messages_status_created
    on public_contact_messages(status, created_at desc, id desc);

create index if not exists idx_public_contact_messages_category_created
    on public_contact_messages(category, created_at desc, id desc);

create index if not exists idx_public_contact_attempts_ip_created
    on public_contact_attempts(ip_hash, created_at desc);

create index if not exists idx_public_contact_attempts_sender_created
    on public_contact_attempts(sender_hash, created_at desc);

create index if not exists idx_public_contact_attempts_created
    on public_contact_attempts(created_at asc, id asc);

create index if not exists idx_public_contact_message_events_message_created
    on public_contact_message_events(contact_message_id, created_at desc, id desc);

commit;
