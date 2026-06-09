# Pipeline Changes: Resolver Bloqueos de Supabase Auth por Concurrencia

## Coder

### Archivos agregados

- `src/utils/authManager.js`
  - Centraliza operaciones Auth.
  - Deduplica llamadas concurrentes a `getSession`.
  - Serializa `refreshSession`, `getUser` y `signOut`.
  - Mantiene cache de sesion/usuario.
  - Agrega logs seguros solo con `VITE_AUTH_DEBUG=1`.

- `src/contexts/AuthProvider.jsx`
  - Proveedor global de sesion, usuario y perfil.
  - Registra un unico `onAuthStateChange`.
  - Suscribe cambios realtime del perfil del usuario activo.
  - Usa un nombre sin colision con `authStateContext.js` para evitar resolucion stale/case-insensitive en Windows/Vite.

- `src/contexts/authStateContext.js`
  - Contexto React separado para evitar colisiones y cumplir Fast Refresh.

- `src/hooks/useAuth.js`
  - Hook publico para consumir Auth sin exponer logica interna.

- `src/__tests__/auth-manager.test.js`
  - Pruebas de concurrencia para token, refresh y logout.

### Archivos modificados

- `src/App.jsx`
  - Envuelve rutas con `AuthProvider`.
  - Importa desde `./contexts/AuthProvider` para evitar el blanco causado por resolver un contexto sin `AuthProvider`.

- `src/ProtectedRoute.jsx`
  - Usa `useAuth`.
  - Elimina `supabase.auth.getUser()` directo.
  - Elimina listener de `focus` y canal de perfil duplicado.

- `src/utils/adminApi.js`
  - Usa `authManager.getFreshAccessToken()`.
  - Elimina llamadas directas a `getSession` y `refreshSession`.
  - Usa `signOutAuth()` para limpiar sesion invalida.

- `src/pages/dashboard.jsx`
  - Usa `useAuth`.
  - Elimina `loadSession` con `supabase.auth.getUser()`.
  - Carga ordenes/usuarios admin solo cuando ya existe `authUser`.

- `src/pages/page-quote.jsx`
  - Usa `useAuth`.
  - Elimina verificacion Auth local.

- `src/pages/pages-seller.jsx`
  - Usa `useAuth`.
  - Elimina `getUser()` y `onAuthStateChange()` locales.

- `src/pages/page-production.jsx`
  - Usa `useAuth`.
  - Obtiene rol productor desde `profile` compartido.

- `src/pages/page-designer.jsx`
  - Usa `useAuth`.
  - Sincroniza `userRef` desde el contexto.

- `src/pages/page-delivery.jsx`
  - Usa `useAuth`.
  - Elimina `getUser()` local.

- `src/pages/lobby.jsx`
  - Mantiene `signInWithPassword`.
  - Usa `signOutAuth()` para cerrar sesion si la cuenta esta desactivada.

### Impacto esperado

- Se reduce la rafaga de operaciones Auth durante carga inicial.
- `Dashboard` ya no dispara `getUser + getSession + refreshSession` en paralelo.
- Solo quedan llamadas Auth directas en:
  - `authManager`
  - `AuthProvider` para el unico listener global
  - `lobby` para login.
