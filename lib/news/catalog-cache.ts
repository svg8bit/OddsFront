import type { NewsCatalog } from "./types.ts";

// The multilingual archive grows beyond Next's 2 MB Data Cache entry limit.
// Retain one catalog per warm worker instead of serializing it into that cache.
export function createNewsCatalogCache(load: () => Promise<NewsCatalog>, now = Date.now) {
  let current: NewsCatalog | undefined;
  let nextReadAt = 0;
  let pending: Promise<NewsCatalog> | undefined;
  return function read(): Promise<NewsCatalog> {
    if (current && now() < nextReadAt) return Promise.resolve(current);
    if (pending) return pending;
    pending = Promise.resolve().then(load).then(incoming => {
        if (current && Date.parse(incoming.updatedAt) < Date.parse(current.updatedAt)) {
          throw new Error("News catalog refresh would roll back the published edition");
        }
        current = incoming;
        nextReadAt = now() + 30_000;
        return incoming;
      }).catch(error => {
        nextReadAt = now() + 5_000;
        if (current) return current;
        throw error;
      }).finally(() => { pending = undefined; });
    return pending;
  };
}
