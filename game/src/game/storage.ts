// Accessing the storage property itself can throw, before any method is called.
type Area = 'localStorage' | 'sessionStorage';
export function readStored(key: string, area: Area = 'localStorage'): string | null {
  try { return globalThis[area].getItem(key); } catch { return null; }
}
export function writeStored(key: string, value: string, area: Area = 'localStorage'): boolean {
  try { globalThis[area].setItem(key, value); return true; } catch { return false; }
}
export function removeStored(key: string, area: Area = 'localStorage'): boolean {
  try { globalThis[area].removeItem(key); return true; } catch { return false; }
}
