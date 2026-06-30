begin;

alter table pastorwood_posts
    add column if not exists summary text not null default '',
    add column if not exists summary_model text not null default '',
    add column if not exists summary_input_hash text not null default '',
    add column if not exists summary_updated_at timestamptz;

create index if not exists idx_pastorwood_posts_summary_pending
    on pastorwood_posts(source_type, publish_date, post_id)
    where summary = '' or summary_input_hash = '';

commit;
