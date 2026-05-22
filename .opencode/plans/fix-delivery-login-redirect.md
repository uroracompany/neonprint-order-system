# Plan: Corrección Redirección Login Delivery

## Diagnóstico

**Causa raíz:** En `src/pages/lobby.jsx:122-129`, el objeto `roleRoutes` no incluye `delivery`, por lo que `navigate(undefined || "/")` redirige al login.

## Cambios requeridos (3 archivos)

### 1. `src/pages/lobby.jsx` — Línea 128
Añadir `delivery: "/delivery"`:

```javascript
const roleRoutes = {
  admin: "/dashboard",
  seller: "/page-seller",
  designer: "/designer",
  quote: "/quote",
  printer: "/production",
  delivery: "/delivery",       // <-- AÑADIR
};
```

### 2. `src/pages/dashboard.jsx` — Línea 125
Añadir `delivery: "Entregador"` en `getRoleLabel`:

```javascript
const getRoleLabel = (role) => {
  const map = {
    seller: "Vendedor",
    designer: "Diseñador",
    quote: "Cotizador",
    admin: "Administrador",
    printer: "Producción",
    delivery: "Entregador",    // <-- AÑADIR
  };
  return map[role] || role;
};
```

### 3. `src/pages/dashboard.jsx` — Línea 131
Añadir `delivery: ["Entregador", "cyan"]` en `roleMap`:

```javascript
const roleMap = {
  admin: ["Administrador", "danger"],
  seller: ["Vendedor", "info"],
  designer: ["Diseñador", "purple"],
  quote: ["Cotizador", "blue"],
  printer: ["Producción", "orange"],
  delivery: ["Entregador", "cyan"],   // <-- AÑADIR
};
```

## Verificación post-cambio

1. `npm run build` — sin errores de compilación
2. Login con usuario `delivery` → redirige a `/delivery`
3. Sidebar muestra rol correctamente
4. Dashboard admin muestra "Entregador" en la tabla de usuarios
