begin;

create table if not exists aic_users (
    clerk_user_id text primary key,
    email text not null unique,
    name text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create table if not exists aic_user_roles (
    email text primary key,
    role text not null default 'User',
    assigned_by text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (email = lower(email)),
    check (role in ('User', 'Admin'))
);

insert into aic_user_roles(email, role, assigned_by)
values ('michael@ammonsfarm.org', 'Admin', 'bootstrap')
on conflict (email) do update
set role = 'Admin',
    assigned_by = 'bootstrap',
    updated_at = now()
where aic_user_roles.role <> 'Admin';

create table if not exists agent_settings (
    settings_key text primary key default 'default',
    provider text not null default 'silo',
    model text not null default '',
    system_api_key text not null default '',
    system_api_key_updated_at timestamptz,
    updated_by text not null default '',
    updated_at timestamptz not null default now(),
    check (settings_key = 'default'),
    check (provider in ('silo', 'openai'))
);

insert into agent_settings(settings_key)
values ('default')
on conflict (settings_key) do nothing;

create table if not exists rag_interactions (
    id bigserial primary key,
    clerk_user_id text not null references aic_users(clerk_user_id) on delete cascade,
    user_email text not null default '',
    scope text not null,
    track_id text references episodes(track_id) on delete set null,
    question text not null,
    answer text not null default '',
    provider text not null default '',
    model text not null default '',
    top_k integer not null default 0,
    retrieval_lanes jsonb not null default '[]'::jsonb,
    sources jsonb not null default '[]'::jsonb,
    top_episode_ids jsonb not null default '[]'::jsonb,
    coverage_note text not null default '',
    status text not null default 'completed',
    error text not null default '',
    duration_ms integer not null default 0,
    created_at timestamptz not null default now(),
    check (scope in ('research', 'archive', 'episode')),
    check (status in ('completed', 'failed'))
);

create index if not exists idx_aic_users_email on aic_users(email);
create index if not exists idx_aic_user_roles_role on aic_user_roles(role);
create index if not exists idx_rag_interactions_user_created on rag_interactions(clerk_user_id, created_at desc);
create index if not exists idx_rag_interactions_scope_created on rag_interactions(scope, created_at desc);
create index if not exists idx_rag_interactions_track_created on rag_interactions(track_id, created_at desc);

commit;
