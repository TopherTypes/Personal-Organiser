/**
 * Centralises personal-mode storage key generation so every personal module
 * persists to dedicated non-work paths.
 */
const PERSONAL_STORAGE_ROOT = "second-brain.personal";

/**
 * Builds a versioned localStorage key for a personal module collection.
 */
export function buildPersonalStorageKey(moduleName, version = 1) {
  return `${PERSONAL_STORAGE_ROOT}.${moduleName}.v${version}`;
}
