# Automatic Short cleanup

Home Shorts expire 24 hours after `posts.created_at`. Supabase Cron invokes the cleanup function every five minutes; the Cloudinary asset is removed before its post row. A failed asset deletion leaves the post in place so the next run can retry it. Each run processes up to 100 expired Shorts.

## Deploy the function

Install the Supabase CLI, then run these commands from the project root:

```powershell
supabase login
supabase link --project-ref atlykkkmeupjdoicqfda
supabase functions deploy cleanup-expired-shorts
```

## Set Edge Function secrets

In Supabase Dashboard, open **Edge Functions → Secrets** and add:

- `CLOUDINARY_CLOUD_NAME`: `doavq83pj`
- `CLOUDINARY_API_KEY`: the API key from the Cloudinary dashboard
- `CLOUDINARY_API_SECRET`: the API secret from the Cloudinary dashboard
- `SHORTS_CLEANUP_SECRET`: a newly generated, long random secret

Do not put the API secret or cleanup secret in frontend files or send them in chat. Supabase provides its project URL and server-side secret key to the Edge Function automatically.

## Schedule cleanup

In Supabase **Vault**, create a secret named `shorts_cleanup_secret` with the same random value used for `SHORTS_CLEANUP_SECRET`. Then, in Supabase **SQL Editor**, run `schedule-short-cleanup.sql`. The SQL reads the secret from Vault and schedules the five-minute job without putting the secret in SQL history.

Confirm the job appears under **Integrations → Cron** and inspect the Edge Function logs after a run. Deletion occurs on the first scheduled run after the 24-hour expiry, so it can be delayed by up to five minutes. Cloudinary files that have already accumulated are not retroactively deleted by this job unless their post rows are still present as `media_type = 'short'`.