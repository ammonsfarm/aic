-- Expand AIC app roles for the protected content portal.
-- The first CMS release allows Content Manager users to publish directly.

do $$
declare
    existing_constraint_name text;
begin
    select c.conname
      into existing_constraint_name
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = current_schema()
       and t.relname = 'aic_user_roles'
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%role%'
     limit 1;

    if existing_constraint_name is not null then
        execute format('alter table aic_user_roles drop constraint %I', existing_constraint_name);
    end if;
end $$;

alter table aic_user_roles
    add constraint aic_user_roles_role_check
    check (role in ('User', 'Admin', 'Content Manager', 'Research User', 'Read Only'));
