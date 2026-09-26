---
name: playwright-on-demand
description: Validación de navegador bajo demanda para NeonPrint. Usar únicamente cuando el usuario pida explícitamente Playwright o ejecutar/abrir la aplicación.
---

# Playwright bajo demanda

No ejecutes Playwright ni levantes el servidor de desarrollo por defecto. Actívalo
solo ante una petición explícita del usuario para revisar con Playwright, probar
con Playwright, ejecutar Playwright, correr la aplicación o abrirla para validar
un flujo.

1. Verifica que la solicitud indique la ruta, interacción o defecto que se debe
   comprobar. Si falta y no puede deducirse del cambio, pide esa precisión.
2. Usa `npx --package @playwright/cli playwright-cli` o el wrapper local de
   Playwright. No instales dependencias permanentes ni generes specs E2E.
   Para un inicio de sesión solicitado, usa exclusivamente el par de variables
   correspondiente de `.env.playwright.local`. No solicites esas credenciales si
   ya existen, y nunca las incluyas en comandos narrados, planes, reportes,
   nombres de archivos o capturas.
3. Obtén un snapshot antes de usar referencias de elementos y vuelve a tomarlo
   tras navegación, modales, menús o cambios relevantes de interfaz.
4. Usa datos locales/seguros. Nunca uses credenciales de producción ni realices
   acciones externas irreversibles.
5. Guarda capturas, trazas u otros artefactos en `output/playwright/` y registra
   el resultado en el directorio de la tarea.
