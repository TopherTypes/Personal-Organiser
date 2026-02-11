class LocalStorageMock {
  constructor() {
    this.store = new Map();
  }

  clear() {
    this.store.clear();
  }

  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  key(index) {
    return Array.from(this.store.keys())[index] ?? null;
  }

  get length() {
    return this.store.size;
  }

  removeItem(key) {
    this.store.delete(key);
  }

  setItem(key, value) {
    this.store.set(key, String(value));
  }
}

if (!globalThis.localStorage) {
  globalThis.localStorage = new LocalStorageMock();
}

if (!globalThis.sessionStorage) {
  globalThis.sessionStorage = new LocalStorageMock();
}
