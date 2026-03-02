/**
 * Environment-aware logger utility.
 *
 * In production builds, debug and log calls are suppressed.
 * Warn and error always emit regardless of environment.
 *
 * Usage:
 *   import { createLogger } from '../utils/logger';
 *   const log = createLogger('ModuleName');
 *   log.debug('detailed info', data);
 *   log.info('operational info');
 *   log.warn('potential issue', detail);
 *   log.error('failure', error);
 */

// Vite sets import.meta.env.PROD at build time; cast to avoid needing vite/client types
const isDev = !(import.meta as unknown as { env: { PROD: boolean } }).env.PROD;

export interface Logger {
  debug: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

// Shared no-op for suppressed levels
const noop = (): void => {};

/**
 * Creates a prefixed logger for a specific module.
 *
 * @param module - Module name used as prefix, e.g. 'AI', 'Persistence', 'CardGen'
 */
export function createLogger(module: string): Logger {
  const prefix = `[${module}]`;

  return {
    debug: isDev ? (...args: unknown[]) => console.debug(prefix, ...args) : noop,
    log: isDev ? (...args: unknown[]) => console.log(prefix, ...args) : noop,
    info: isDev ? (...args: unknown[]) => console.info(prefix, ...args) : noop,
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
  };
}
