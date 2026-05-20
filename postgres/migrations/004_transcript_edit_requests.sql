begin;

create table if not exists transcript_edit_requests (
    id bigserial primary key,
    track_id text not null references episodes(track_id) on delete cascade,
    segment_id text not null,
    segment_index integer,
    source_table text not null,
    source_field text not null default 'text',
    original_text text not null,
    edited_text text not null,
    edited_by text not null default '',
    status text not null default 'pending',
    processing_error text not null default '',
    needs_revectorization boolean not null default true,
    applied_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (source_table in ('transcript_segments', 'transcript_chunks')),
    check (status in ('pending', 'applying', 'applied', 'rejected', 'failed')),
    check (length(trim(edited_text)) > 0),
    check (edited_text <> original_text)
);

create index if not exists idx_transcript_edit_requests_status on transcript_edit_requests(status, created_at);
create index if not exists idx_transcript_edit_requests_track on transcript_edit_requests(track_id, created_at desc);
create index if not exists idx_transcript_edit_requests_segment on transcript_edit_requests(track_id, segment_id);

commit;
