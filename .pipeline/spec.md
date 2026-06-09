# Pipeline Spec: Resolver Bloqueos de Supabase Auth por Concurrencia

## Planner

### Diagnóstico

El problema no venía de múltiples instancias frontend de Supabase. La instancia principal sigue centralizada en `supabaseClient.js`.

La causa raíz era la concurrencia de operaciones Auth:

- `ProtectedRoute` ejecutaba `supabase.auth.getUser()` al montar y también en `focus`.
- Cada página protegida volvía a ejecutar `supabase.auth.getUser()` en su propio `useEffect`.
- `Dashboard` disparaba `loadOrders()` y `loadProfiles()` en paralelo; ambas usaban `adminApiFetch`, que llamaba `getSession()` y a veces `refreshSession()`.
- `pages-seller` registraba un listener adicional `onAuthStateChange`.
- En desarrollo, React StrictMode duplicaba los efectos, aumentando la ráfaga.

Ese patrón podía saturar el lock interno de GoTrue para la key `sb-dnzouxbbmkgcpyvexmoy-auth-token`, generando:

- `Lock ... was not released within 5000ms`
- `DOMException: The lock request is aborted`
- estados falsos de sesión inválida o módulos vacíos.

### Archivos involucrados

- `supabaseClient.js`
- `src/utils/adminApi.js`
- `src/ProtectedRoute.jsx`
- `src/App.jsx`
- `src/pages/dashboard.jsx`
- `src/pages/page-quote.jsx`
- `src/pages/pages-seller.jsx`
- `src/pages/page-production.jsx`
- `src/pages/page-designer.jsx`
- `src/pages/page-delivery.jsx`
- `src/pages/lobby.jsx`

### Plan de corrección

1. Crear `authManager` para serializar y deduplicar `getSession`, `refreshSession`, `getUser` y `signOut`.
2. Crear `AuthProvider` con un solo `onAuthStateChange` global.
3. Crear `useAuth` para que `ProtectedRoute` y páginas protegidas consuman `user/profile/session`.
4. Refactorizar páginas para eliminar llamadas directas a `getUser`, `getSession`, `refreshSession`, `signOut` y listeners duplicados.
5. Mantener `signInWithPassword` solo en Login.
6. Mantener APIs admin existentes sin cambiar contratos ni RLS.
7. Agregar tests de concurrencia para token y refresh.

### Riesgos y mitigaciones

- Riesgo: Fast Refresh si un archivo exporta provider y hook juntos.
  - Mitigación: separar `AuthProvider`, `AuthContext` y `useAuth`.
- Riesgo: intentar refrescar sesión inexistente después de logout.
  - Mitigación: `getFreshAccessToken` falla limpio si no hay token y no se pidió refresh forzado.
- Riesgo: ocultar problemas reales de permisos.
  - Mitigación: `ProtectedRoute` sigue validando rol y estado laboral desde `profile`.
