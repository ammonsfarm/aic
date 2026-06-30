begin;

alter table rag_interactions
    drop constraint if exists rag_interactions_scope_check;

alter table rag_interactions
    add constraint rag_interactions_scope_check
    check (scope in ('research', 'archive', 'episode', 'writing'));

alter table rag_interactions
    drop constraint if exists rag_interactions_track_id_fkey;

commit;
