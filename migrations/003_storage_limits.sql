-- Server-side storage guardrails. Client checks can be bypassed; these can't.
-- Safe to run more than once. Existing files are not touched.

update storage.buckets
   set file_size_limit    = 102400,                         -- 100 KB (avatars are ~10–20 KB)
       allowed_mime_types = array['image/webp']
 where id = 'avatars';

update storage.buckets
   set file_size_limit    = 307200,                         -- 300 KB (backgrounds ~40–80 KB, cursors ≤100 KB)
       allowed_mime_types = array['image/webp', 'image/png', 'image/x-icon']
 where id = 'backgrounds';

update storage.buckets
   set file_size_limit    = 3145728,                        -- 3 MB
       allowed_mime_types = array['audio/mpeg']
 where id = 'audio';
