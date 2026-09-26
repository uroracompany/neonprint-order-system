import { lazy } from "react";

const DEFAULT_RETRIES = 2;
const DEFAULT_DELAY_MS = 400;

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function retryDynamicImport(importer, options = {}) {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await importer();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await wait(delayMs * (attempt + 1));
    }
  }

  throw lastError;
}

export function lazyWithRetry(importer, options) {
  return lazy(() => retryDynamicImport(importer, options));
}
