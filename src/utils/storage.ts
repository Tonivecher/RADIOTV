// Browser privacy settings can deny storage even when the page itself is allowed.
// Keep the current tab usable; persistence is optional.
const temporary = new Map<string, string | null>();

export const safeStorage = {
  getItem(key: string): string | null {
    if (temporary.has(key)) {
      return temporary.get(key) ?? null;
    }
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
      temporary.delete(key);
    } catch {
      temporary.set(key, value);
    }
  },
  removeItem(key: string): void {
    try {
      window.localStorage.removeItem(key);
      temporary.delete(key);
    } catch {
      temporary.set(key, null);
    }
  },
};
