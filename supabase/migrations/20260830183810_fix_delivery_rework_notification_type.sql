-- The notification event kind remains delivery_rework for deduplication and
-- routing. Only its persisted notification type is changed to the existing
-- allowed order-returned type.
do $$
declare
  v_definition text;
  v_patched_definition text;
  v_match_count integer;
  v_pattern text := E'(perform\\s+public\\.notify_many\\s*\\(\\s*array\\[v_recipient\\]\\s*,\\s*)''delivery_rework''';
begin
  select pg_get_functiondef('public.delivery_return_completed_files_to_production(uuid,jsonb,timestamptz)'::regprocedure)
  into v_definition;
  select count(*) into v_match_count from regexp_matches(v_definition, v_pattern, 'i');
  if v_match_count <> 1 then
    raise exception 'Cannot safely patch delivery rework notification type';
  end if;
  v_patched_definition := regexp_replace(v_definition, v_pattern, E'\\1''order_returned''', 'i');
  if v_patched_definition = v_definition then
    raise exception 'Cannot safely patch delivery rework notification type';
  end if;
  execute v_patched_definition;
end;
$$;
