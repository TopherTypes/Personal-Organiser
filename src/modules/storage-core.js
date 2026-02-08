/**
 * Parses JSON defensively and returns a safe fallback on malformed payloads.
 */
export function safeJsonParse(raw, fallback = null) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return fallback;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Serialises and writes JSON defensively, returning whether persistence succeeded.
 */
export function safeJsonWrite(storageKey, value) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads a versioned collection from localStorage with legacy-array migration support.
 */
export function loadVersionedCollection({
  storageKey,
  collectionKey,
  schemaVersion,
  normaliseItem,
  backupKey = `${storageKey}.backup`,
  fallback = []
}) {
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return [...fallback];
  }

  const parsed = safeJsonParse(raw, null);
  if (parsed === null) {
    return [...fallback];
  }

  if (Array.isArray(parsed)) {
    const migrated = parsed.map(normaliseItem);

    // Store the original legacy payload before replacing it with an envelope.
    safeJsonWrite(backupKey, parsed);
    persistVersionedCollection({ storageKey, collectionKey, schemaVersion, records: migrated });
    return migrated;
  }

  if (parsed && typeof parsed === "object" && Array.isArray(parsed[collectionKey])) {
    const normalised = parsed[collectionKey].map(normaliseItem);

    // Rewrite only when normalisation changes the payload (e.g. new defaults).
    if (JSON.stringify(parsed[collectionKey]) !== JSON.stringify(normalised)) {
      persistVersionedCollection({ storageKey, collectionKey, schemaVersion, records: normalised });
    }

    return normalised;
  }

  return [...fallback];
}

/**
 * Persists a collection in a schema-versioned envelope.
 */
export function persistVersionedCollection({ storageKey, collectionKey, schemaVersion, records }) {
  return safeJsonWrite(storageKey, {
    schemaVersion,
    [collectionKey]: records
  });
}
