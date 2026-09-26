-- Permite que las llamadas RPC de KPIs proxyadas por el servidor API pasen la
-- validación de administrador.
--
-- El servidor (api/kpi-data.js y el handler de Vite) valida primero al usuario
-- con requireAdmin (perfil con role = 'admin') y después invoca los RPC de KPIs
-- con la service role key como apikey y el JWT del usuario administrador en el
-- header Authorization. Cuando el header Authorization es el JWT del usuario,
-- auth.uid() resuelve al administrador y la validación de perfil funciona como
-- siempre. Cuando la llamada llega con la service role key como único JWT
-- (auth.uid() = null), la validación de perfil falla y todo el contrato
-- verificado de KPIs cae al fallback transitorio (materiales sin desglose de
-- diseño, totales inflados por referencias).
--
-- La service role key solo la posee el servidor, que ya exige un administrador
-- autenticado antes de invocar estos RPC, y dicha clave ya tiene acceso total
-- (bypass de RLS). Aceptarla aquí no eleva privilegios de ningún usuario.

create or replace function public.current_profile_is_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(public.current_profile_role() = 'admin', false)
      or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
$$;

NOTIFY pgrst, 'reload schema';
