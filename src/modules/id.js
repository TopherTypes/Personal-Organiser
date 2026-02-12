/**
 * Monotonic counter used as a deterministic fallback when `crypto.randomUUID` is unavailable.
 *
 * We intentionally avoid pseudo-random sources in fallback mode so IDs remain predictable during
 * constrained test/runtime environments that do not expose Web Crypto.
 */
let deterministicIdCounter = 0;

/**
 * Returns a stable unique token using `crypto.randomUUID()` when available.
 *
 * If Web Crypto is not present, the function falls back to a deterministic sequence (`id_000001`,
 * `id_000002`, ...). This keeps ID generation reliable without relying on `Math.random`.
 *
 * @param {string} [prefix=""] Optional diagnostic prefix (for example `ptask_` or `pcal_`).
 * @returns {string} A generated identifier including the provided prefix.
 */
export function generateId(prefix = "") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}${crypto.randomUUID()}`;
  }

  deterministicIdCounter += 1;
  const fallbackId = `id_${String(deterministicIdCounter).padStart(6, "0")}`;
  return `${prefix}${fallbackId}`;
}
