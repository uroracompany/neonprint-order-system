# PLAN ID: 20260825-r2-production-cors

Original user request: analizar la funcionalidad Cloudflare R2 y determinar qué falta para que funcione primero en producción y luego en local.

Baseline commit: `81cf7072e6296ecdb88ea84817d827a2f31d3c84`

Affected systems: Cloudflare R2 bucket configuration, Vercel Production environment configuration; no source files.

Acceptance criteria:

1. El navegador puede ejecutar el PUT firmado contra R2 desde el dominio de producción.
2. El archivo se registra como `r2` y se puede descargar y eliminar.
3. La configuración local usa un bucket/origen de desarrollo separado.

Risks: CORS puede esconder un fallo posterior de firma o permisos; se validará con PUT real 2xx. Las URLs firmadas y secretos no se comparten ni se guardan en cliente.

Required specialist checks: configuración de variables Vercel y política CORS Cloudflare.

STATUS: DRAFT
