-- P3: P0/P2 delivery workflows reference this nullable operational note.
-- The original orders schema did not declare it, causing any orders UPDATE to
-- fail when the P2 row trigger first evaluated NEW.delivery_note.
alter table public.orders
  add column if not exists delivery_note text;
