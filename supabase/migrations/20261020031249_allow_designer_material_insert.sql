-- Designers may add shared production materials, limited to active areas.
-- Recreate the existing INSERT policy so this does not broaden access via OR.
drop policy if exists materials_insert_admin on public.materials;
create policy materials_insert_admin
  on public.materials for insert to authenticated
  with check (
    public.current_profile_role() in ('admin', 'semi_admin', 'designer')
    and production_area_code is not null
    and exists (
      select 1 from public.production_areas area
      where area.code = production_area_code and area.is_active
    )
  );

notify pgrst, 'reload schema';
