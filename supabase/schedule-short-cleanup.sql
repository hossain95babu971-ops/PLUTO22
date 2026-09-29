create schema if not exists extensions;
create schema if not exists vault;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

do $check_secret$
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'shorts_cleanup_secret'
  ) then
    raise exception 'Create the shorts_cleanup_secret in Supabase Vault before scheduling this job.';
  end if;
end;
$check_secret$;

select cron.unschedule(jobid)
from cron.job
where jobname = 'delete-home-shorts-after-24-hours';

select cron.schedule(
  'delete-home-shorts-after-24-hours',
  '*/5 * * * *',
  $cleanup$
    select net.http_post(
      url := 'https://atlykkkmeupjdoicqfda.supabase.co/functions/v1/cleanup-expired-shorts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cleanup-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'shorts_cleanup_secret'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cleanup$
);