begin;

create index if not exists idx_public_contact_messages_archived_updated
    on public_contact_messages(updated_at asc, id asc)
    where status = 'archived';

commit;
