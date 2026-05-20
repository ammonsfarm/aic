begin;

create table if not exists transcript_segments (
    segment_id text primary key,
    track_id text not null references episodes(track_id) on delete cascade,
    segment_index integer not null,
    start_time text not null default '',
    end_time text not null default '',
    start_seconds double precision,
    end_seconds double precision,
    speaker_id text not null default '',
    speaker_name text not null default '',
    segment_type text not null default 'speech',
    text text not null default '',
    bible_references jsonb not null default '[]'::jsonb,
    other_references jsonb not null default '[]'::jsonb,
    source_file text not null default '',
    raw_segment jsonb not null default '{}'::jsonb,
    search_tsv tsvector generated always as (
        to_tsvector(
            'english',
            coalesce(speaker_name, '') || ' ' ||
            coalesce(segment_type, '') || ' ' ||
            coalesce(text, '')
        )
    ) stored,
    updated_at timestamptz not null default now(),
    unique(track_id, segment_index)
);

create table if not exists transcript_references (
    reference_id text primary key,
    track_id text not null references episodes(track_id) on delete cascade,
    segment_index integer,
    reference_type text not null,
    source_scope text not null,
    reference text not null default '',
    start_time text not null default '',
    end_time text not null default '',
    start_seconds double precision,
    end_seconds double precision,
    context text not null default '',
    text text not null default '',
    raw_reference jsonb not null default '{}'::jsonb,
    search_tsv tsvector generated always as (
        to_tsvector(
            'english',
            coalesce(reference, '') || ' ' ||
            coalesce(context, '') || ' ' ||
            coalesce(text, '')
        )
    ) stored,
    updated_at timestamptz not null default now()
);

create index if not exists idx_transcript_segments_track on transcript_segments(track_id);
create index if not exists idx_transcript_segments_timing on transcript_segments(track_id, start_seconds, end_seconds);
create index if not exists idx_transcript_segments_speaker on transcript_segments(track_id, speaker_name);
create index if not exists idx_transcript_segments_type on transcript_segments(segment_type);
create index if not exists idx_transcript_segments_tsv on transcript_segments using gin(search_tsv);

create index if not exists idx_transcript_references_track on transcript_references(track_id);
create index if not exists idx_transcript_references_segment on transcript_references(track_id, segment_index);
create index if not exists idx_transcript_references_type on transcript_references(reference_type);
create index if not exists idx_transcript_references_reference_trgm on transcript_references using gin(reference gin_trgm_ops);
create index if not exists idx_transcript_references_tsv on transcript_references using gin(search_tsv);

commit;
