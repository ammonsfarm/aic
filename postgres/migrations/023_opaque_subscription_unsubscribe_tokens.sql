begin;

alter table public_subscriptions
    add column if not exists unsubscribe_token_hash text;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'public_subscriptions_unsubscribe_token_hash_check'
          and conrelid = 'public_subscriptions'::regclass
    ) then
        alter table public_subscriptions
            add constraint public_subscriptions_unsubscribe_token_hash_check
            check (unsubscribe_token_hash is null or length(unsubscribe_token_hash) = 64);
    end if;
end
$$;

create unique index if not exists idx_public_subscriptions_unsubscribe_token_hash
    on public_subscriptions(unsubscribe_token_hash)
    where unsubscribe_token_hash is not null;

commit;
