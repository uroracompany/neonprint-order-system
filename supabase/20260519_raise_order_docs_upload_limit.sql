-- Raise design document uploads above the previous 50 MB bucket limit.
-- Supabase hosted projects still require the global Storage file size limit
-- to be at least this value.

update storage.buckets
set file_size_limit = 209715200
where id = 'order-docs';
