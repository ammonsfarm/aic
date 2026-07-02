-- Core CMS schema for Pastor Wood / AIC content management.

create table if not exists content_pages (
    id bigserial primary key,
    slug text not null unique,
    title text not null,
    page_type text not null default 'standard',
    status text not null default 'Draft',
    published_revision_id bigint,
    created_by text not null default 'system',
    updated_by text not null default 'system',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    published_at timestamptz,
    scheduled_for timestamptz,
    archived_at timestamptz,
    check (status in ('Draft', 'Scheduled', 'Published', 'Archived'))
);

create table if not exists content_page_revisions (
    id bigserial primary key,
    page_id bigint not null references content_pages(id) on delete cascade,
    revision_number integer not null,
    title text not null,
    seo_title text not null default '',
    seo_description text not null default '',
    hero_title text not null default '',
    hero_body text not null default '',
    body_json jsonb not null default '{}'::jsonb,
    body_html text not null default '',
    status text not null default 'Draft',
    created_by text not null default 'system',
    created_at timestamptz not null default now(),
    change_note text not null default '',
    unique (page_id, revision_number),
    check (status in ('Draft', 'Scheduled', 'Published', 'Archived'))
);

alter table content_pages
    drop constraint if exists content_pages_published_revision_id_fkey;

alter table content_pages
    add constraint content_pages_published_revision_id_fkey
    foreign key (published_revision_id) references content_page_revisions(id) on delete set null;

create table if not exists content_posts (
    id bigserial primary key,
    source_type text not null default 'cms_post',
    source_post_id text,
    slug text not null unique,
    title text not null,
    excerpt text not null default '',
    body_json jsonb not null default '{}'::jsonb,
    body_html text not null default '',
    plain_text text not null default '',
    author_name text not null default '',
    publish_date date,
    status text not null default 'Draft',
    visibility text not null default 'public',
    canonical_url text not null default '',
    seo_title text not null default '',
    seo_description text not null default '',
    published_revision_id bigint,
    created_by text not null default 'system',
    updated_by text not null default 'system',
    published_at timestamptz,
    scheduled_for timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    archived_at timestamptz,
    check (status in ('Draft', 'Scheduled', 'Published', 'Archived')),
    check (visibility in ('public', 'private', 'unlisted'))
);

create table if not exists content_post_revisions (
    id bigserial primary key,
    post_id bigint not null references content_posts(id) on delete cascade,
    revision_number integer not null,
    title text not null,
    excerpt text not null default '',
    body_json jsonb not null default '{}'::jsonb,
    body_html text not null default '',
    plain_text text not null default '',
    status text not null default 'Draft',
    created_by text not null default 'system',
    created_at timestamptz not null default now(),
    change_note text not null default '',
    unique (post_id, revision_number),
    check (status in ('Draft', 'Scheduled', 'Published', 'Archived'))
);

alter table content_posts
    drop constraint if exists content_posts_published_revision_id_fkey;

alter table content_posts
    add constraint content_posts_published_revision_id_fkey
    foreign key (published_revision_id) references content_post_revisions(id) on delete set null;

create table if not exists content_media_assets (
    id bigserial primary key,
    asset_type text not null default 'file',
    filename text not null default '',
    original_filename text not null default '',
    storage_provider text not null default 'minio',
    storage_bucket text not null default '',
    storage_key text not null default '',
    url text not null default '',
    mime_type text not null default '',
    file_size_bytes bigint,
    width integer,
    height integer,
    duration_seconds numeric,
    alt_text text not null default '',
    caption text not null default '',
    attribution text not null default '',
    status text not null default 'Draft',
    uploaded_by text not null default 'system',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (status in ('Draft', 'Published', 'Archived'))
);

create table if not exists content_podcast_uploads (
    id bigserial primary key,
    track_id text,
    title text not null,
    slug text not null unique,
    description text not null default '',
    summary text not null default '',
    scripture_references text[] not null default array[]::text[],
    category text not null default '',
    series text not null default '',
    speaker text not null default '',
    guest_names text[] not null default array[]::text[],
    publish_date date,
    status text not null default 'Draft',
    audio_asset_id bigint references content_media_assets(id) on delete set null,
    duration_seconds numeric,
    file_size_bytes bigint,
    source_url text not null default '',
    transcript_status text not null default 'Not Requested',
    intelligence_status text not null default 'Not Requested',
    vector_status text not null default 'Not Requested',
    public_episode_id text,
    created_by text not null default 'system',
    updated_by text not null default 'system',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    published_at timestamptz,
    scheduled_for timestamptz,
    archived_at timestamptz,
    check (status in ('Draft', 'Scheduled', 'Published', 'Archived')),
    check (transcript_status in ('Not Requested', 'Queued', 'Running', 'Completed', 'Failed', 'Skipped')),
    check (intelligence_status in ('Not Requested', 'Queued', 'Running', 'Completed', 'Failed', 'Skipped')),
    check (vector_status in ('Not Requested', 'Queued', 'Running', 'Completed', 'Failed', 'Skipped'))
);

create table if not exists content_newsletters (
    id bigserial primary key,
    slug text not null unique,
    title text not null,
    subject text not null,
    preview_text text not null default '',
    body_json jsonb not null default '{}'::jsonb,
    body_html text not null default '',
    plain_text text not null default '',
    status text not null default 'Draft',
    archive_visibility text not null default 'public',
    mailchimp_campaign_id text,
    mailchimp_status text not null default 'Not Synced',
    scheduled_for timestamptz,
    sent_at timestamptz,
    published_at timestamptz,
    created_by text not null default 'system',
    updated_by text not null default 'system',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    archived_at timestamptz,
    check (status in ('Draft', 'Scheduled', 'Published', 'Archived')),
    check (archive_visibility in ('public', 'private', 'unlisted')),
    check (mailchimp_status in ('Not Synced', 'Draft', 'Synced', 'Scheduled', 'Sent', 'Failed'))
);

create table if not exists content_workflow_events (
    id bigserial primary key,
    entity_type text not null,
    entity_id text not null,
    from_status text,
    to_status text not null,
    note text not null default '',
    actor_email text not null default 'system',
    created_at timestamptz not null default now()
);

create table if not exists content_audit_log (
    id bigserial primary key,
    entity_type text not null,
    entity_id text not null,
    action text not null,
    actor_email text not null default 'system',
    before_json jsonb,
    after_json jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_content_pages_status on content_pages(status);
create index if not exists idx_content_pages_page_type on content_pages(page_type);
create index if not exists idx_content_pages_published_at on content_pages(published_at);
create index if not exists idx_content_page_revisions_page_id on content_page_revisions(page_id);
create index if not exists idx_content_page_revisions_status on content_page_revisions(status);

create index if not exists idx_content_posts_source_type on content_posts(source_type);
create index if not exists idx_content_posts_status_publish_date on content_posts(status, publish_date desc nulls last);
create index if not exists idx_content_posts_published_at on content_posts(published_at);
create index if not exists idx_content_post_revisions_post_id on content_post_revisions(post_id);
create index if not exists idx_content_post_revisions_status on content_post_revisions(status);

create index if not exists idx_content_media_assets_type_status on content_media_assets(asset_type, status);
create index if not exists idx_content_media_assets_created_at on content_media_assets(created_at desc);

create index if not exists idx_content_podcast_uploads_status_publish_date on content_podcast_uploads(status, publish_date desc nulls last);
create index if not exists idx_content_podcast_uploads_track_id on content_podcast_uploads(track_id);
create index if not exists idx_content_podcast_uploads_processing on content_podcast_uploads(transcript_status, intelligence_status, vector_status);

create index if not exists idx_content_newsletters_status_created_at on content_newsletters(status, created_at desc);
create index if not exists idx_content_newsletters_mailchimp_status on content_newsletters(mailchimp_status);

create index if not exists idx_content_workflow_events_entity on content_workflow_events(entity_type, entity_id, created_at desc);
create index if not exists idx_content_audit_log_entity on content_audit_log(entity_type, entity_id, created_at desc);
create index if not exists idx_content_audit_log_actor on content_audit_log(actor_email, created_at desc);
