// Funcionalidad para el control de tasa de solicitudes (rate limiting) para prevenir abusos y proteger el servidor.

const WINDOW_MS = 60 * 1000;  // Ventana de tiempo en milisegundos (1 minuto)
const MAX_REQUESTS = 10; // Número máximo de solicitudes permitidas por ventana de tiempo

// Mapa para almacenar los conteos de solicitudes por IP y endpoint
const hits = new Map();

// Limpiar las entradas expiradas periódicamente
setInterval(() => {
  const now = Date.now(); // Obtener el tiempo actual
  for (const [key, entry] of hits) {
    // Si la ventana de tiempo ha expirado, eliminar la entrada del mapa
    if (now >= entry.resetAt) {
      hits.delete(key);
    }
  }
}, WINDOW_MS);


// Funcionalidad que recibe request HTTP
export function rateLimit(req) {
  // Obtener la dirección IP del cliente desde los encabezados o la conexión
  const ip =
    req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers?.["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown"
  ;

  // Crear una clave única para la combinación de IP y endpoint (URL o método)
  const key = `${ip}:${req.url || req.method}`;

  // Obtener el tiempo actual y la entrada correspondiente en el mapa de hits
  const now = Date.now();

  // Si no existe una entrada para esta clave o la ventana de tiempo ha expirado, crear una nueva entrada con el conteo inicial y el tiempo de reinicio
  const entry = hits.get(key);

  // Si no hay una entrada o la ventana de tiempo ha expirado, se permite la solicitud y se establece un nuevo conteo y tiempo de reinicio
  if (!entry || now >= entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_REQUESTS - 1 };
  }

  // Si el conteo de solicitudes ha alcanzado el máximo permitido, se bloquea la solicitud y se calcula el tiempo de espera para el próximo intento
  if (entry.count >= MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  // Si la solicitud es permitida, se incrementa el conteo de solicitudes para esta clave y se devuelve el número de solicitudes restantes
  entry.count += 1;
  return { allowed: true, remaining: MAX_REQUESTS - entry.count };
}
