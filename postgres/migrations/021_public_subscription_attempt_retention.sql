begin;

create index if not exists idx_public_subscription_attempts_created
    on public_subscription_attempts(created_at asc, id asc);

commit;
