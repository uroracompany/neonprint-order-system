# Pipeline Test Results: Resolver Bloqueos de Supabase Auth por Concurrencia

## Tester

### Pruebas automaticas agregadas

`src/__tests__/auth-manager.test.js`

- 10 llamadas concurrentes a `getFreshAccessToken()` ejecutan una sola llamada real a `getSession()`.
- 10 llamadas con sesion proxima a expirar ejecutan una sola llamada real a `refreshSession()`.
- `signOutAuth()` limpia cache y la siguiente llamada falla limpio si ya no hay sesion.

### Verificacion de llamadas Auth

Comando:

```bash
rg "supabase\.auth\.(getUser|getSession|refreshSession|signOut|onAuthStateChange|signInWithPassword)" src supabaseClient.js
```

Resultado esperado confirmado:

- `src/utils/authManager.js`: operaciones Auth centralizadas.
- `src/contexts/AuthProvider.jsx`: unico `onAuthStateChange`.
- `src/pages/lobby.jsx`: unico `signInWithPassword`.
- No quedan llamadas directas de Auth en paginas protegidas ni en `ProtectedRoute`.

### Comandos ejecutados

```bash
npm run lint
```

Resultado: OK.

```bash
npm test
```

Resultado: OK, 10 archivos de prueba, 101 tests pasando.

```bash
npm run build
```

Resultado: OK, build de Vite completado.

### Correccion posterior de pantalla blanca

El servidor dev seguia resolviendo `./contexts/AuthContext` como `/src/contexts/authContext.js`, que no exportaba `AuthProvider`. Eso provocaba pantalla blanca en runtime.

Correccion aplicada:

- `src/contexts/AuthProvider.jsx` reemplaza al nombre anterior del provider.
- `src/App.jsx` importa `AuthProvider` desde `./contexts/AuthProvider`.
- `src/contexts/AuthContext.jsx` fue eliminado.

Verificacion local:

```bash
curl.exe --max-time 8 -s http://localhost:5173/src/App.jsx | Select-String -Pattern "AuthProvider"
```

Resultado confirmado: Vite sirve `import { AuthProvider } from "/src/contexts/AuthProvider.jsx";`.
