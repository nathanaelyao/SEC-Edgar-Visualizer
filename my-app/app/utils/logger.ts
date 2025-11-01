// Simple logger utility: debug/info/warn are no-ops in production unless global.__SEC_API_DEBUG is truthy.
// Errors are always forwarded to console.error so important issues are visible.

const isDebug = Boolean((global as any).__SEC_API_DEBUG ?? (typeof __DEV__ !== 'undefined' ? __DEV__ : false));

export function debug(...args: unknown[]) {
  if (isDebug) console.log(...(args as any));
}

export function info(...args: unknown[]) {
  if (isDebug) console.info(...(args as any));
}

export function warn(...args: unknown[]) {
  if (isDebug) console.warn(...(args as any));
}

export function error(...args: unknown[]) {
  // always log errors to help with debugging and crash investigation
  console.error(...(args as any));
}
