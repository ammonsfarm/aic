-- Durable last-known-published Pastor Wood content.
--
-- Strapi owns editorial records in the aic_strapi schema. The public web app
-- reads this deliberately small projection from the existing database's
-- public schema only when Strapi is unavailable. Tombstones are retained so
-- an unpublish, archive, deactivation, or delete can never reveal an older
-- version through an outage fallback.

create table if not exists public.pastorwood_public_projection (
    entity_type text not null,
    document_id text not null,
    canonical_slug text,
    canonical_track_id text,
    page_key text,
    payload jsonb,
    is_published boolean not null default false,
    published_at timestamptz,
    projected_at timestamptz not null default now(),
    tombstoned_at timestamptz,
    primary key (entity_type, document_id),
    check (entity_type in ('page', 'site-setting', 'post', 'episode', 'person', 'endorsement', 'media-asset', 'redirect')),
    check (length(document_id) between 1 and 128),
    check (canonical_slug is null or length(canonical_slug) between 1 and 512),
    check (canonical_track_id is null or length(canonical_track_id) between 1 and 100),
    check (page_key is null or length(page_key) between 1 and 512),
    check (
        (is_published and payload is not null and jsonb_typeof(payload) = 'object' and tombstoned_at is null)
        or
        (not is_published and payload is null and tombstoned_at is not null)
    )
);

create table if not exists public.pastorwood_public_projection_identities (
    entity_type text not null,
    identity_type text not null,
    identity_value text not null,
    document_id text not null,
    is_current boolean not null default false,
    updated_at timestamptz not null default now(),
    primary key (entity_type, identity_type, identity_value),
    foreign key (entity_type, document_id)
        references public.pastorwood_public_projection(entity_type, document_id)
        on delete cascade,
    check (identity_type in ('slug', 'track-id', 'page-key', 'singleton', 'path')),
    check (length(identity_value) between 1 and 512)
);

create table if not exists public.pastorwood_public_projection_media (
    media_document_id text not null,
    entity_type text not null,
    document_id text not null,
    media_url text not null,
    mime_type text not null default 'application/octet-stream',
    size_bytes bigint,
    projected_at timestamptz not null default now(),
    primary key (media_document_id, entity_type, document_id),
    foreign key (entity_type, document_id)
        references public.pastorwood_public_projection(entity_type, document_id)
        on delete cascade,
    check (length(media_document_id) between 1 and 128),
    check (size_bytes is null or size_bytes >= 0)
);

create index if not exists idx_pastorwood_public_projection_type_published
    on public.pastorwood_public_projection(entity_type, is_published, projected_at desc);

create unique index if not exists idx_pastorwood_public_projection_active_slug
    on public.pastorwood_public_projection(entity_type, canonical_slug)
    where is_published and canonical_slug is not null;

create unique index if not exists idx_pastorwood_public_projection_active_track
    on public.pastorwood_public_projection(entity_type, canonical_track_id)
    where is_published and canonical_track_id is not null;

create unique index if not exists idx_pastorwood_public_projection_active_page_key
    on public.pastorwood_public_projection(entity_type, page_key)
    where is_published and page_key is not null;

create index if not exists idx_pastorwood_public_projection_identity_document
    on public.pastorwood_public_projection_identities(entity_type, document_id, is_current);

create index if not exists idx_pastorwood_public_projection_media_lookup
    on public.pastorwood_public_projection_media(media_document_id);
