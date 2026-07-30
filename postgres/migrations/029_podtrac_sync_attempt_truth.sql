begin;

alter table podtrac_sync_runs
    add column if not exists import_run_id integer;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'podtrac_sync_runs_import_run_id_fkey'
          and conrelid = 'podtrac_sync_runs'::regclass
    ) then
        alter table podtrac_sync_runs
            add constraint podtrac_sync_runs_import_run_id_fkey
            foreign key (import_run_id)
            references podtrac_import_runs(run_id)
            on delete set null;
    end if;
end
$$;

create unique index if not exists idx_podtrac_sync_runs_import_run
    on podtrac_sync_runs(import_run_id)
    where import_run_id is not null;

commit;
