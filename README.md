# Cheats — link-in-bio on Next.js + Supabase

## Setup
1. Create a project at https://supabase.com.
2. SQL Editor → paste and run `schema.sql` (tables, RLS, trigger, storage buckets and policies).
3. Authentication → Providers → Email is enabled by default. For quick local testing, turn off
   "Confirm email" (Authentication → Sign In / Providers → Email).
4. Authentication → URL Configuration → Site URL: `http://localhost:3000`
   (add your production URL and `https://your-domain/**` as a redirect URL when you deploy).
5. `cp .env.local.example .env.local` and fill in the Project URL and anon key
   (Project Settings → API).
6. `npm install && npm run dev` → http://localhost:3000

## Deploy
Push to GitHub, import into Vercel, add the three env vars from `.env.local.example`.

## Upgrading an existing database (profile views)
Run `migrations/002_profile_views.sql` in the SQL Editor. It adds `profiles.views`, the
`increment_profile_views` function, a guard so owners can't edit their own count, and enables
Realtime on `profiles`. Fresh installs get all of this from `schema.sql`.

## Storage limits (free-tier protection)
Run `migrations/003_storage_limits.sql` in the SQL Editor. It caps each bucket's file size and
allowed types on the server (avatars 100 KB WebP, backgrounds 300 KB WebP/PNG/CUR, audio 3 MB MP3),
so the limits hold even if someone bypasses the dashboard. Fresh installs get this from `schema.sql`.
