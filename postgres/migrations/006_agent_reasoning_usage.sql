begin;

alter table agent_settings
    add column if not exists reasoning_effort text not null default '';

alter table rag_interactions
    add column if not exists total_tokens integer not null default 0,
    add column if not exists input_tokens integer not null default 0,
    add column if not exists output_tokens integer not null default 0,
    add column if not exists usage_json jsonb not null default '{}'::jsonb;

commit;
