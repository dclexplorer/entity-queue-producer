import { LRUCache } from 'lru-cache'

export interface LRUCacheConfig {
  maxItems: number
  ttlMs?: number
  keyNormalizer?: (key: string) => string
}

export interface ILRUNormalizedCache<T> {
  get(key: string): T | undefined
  set(key: string, value: T): void
  has(key: string): boolean
  delete(key: string): boolean
  getMany(keys: string[]): Map<string, T>
  setMany(entries: Array<{ key: string; value: T }>): void
  clear(): void
  size(): number
  keys(): string[]
  maxSize(): number
}

export function createNormalizedLRUCache<T extends object | boolean>(config: LRUCacheConfig): ILRUNormalizedCache<T> {
  const cache = new LRUCache<string, T>({
    max: config.maxItems,
    ttl: config.ttlMs
  })

  const normalize = config.keyNormalizer || ((k: string) => k)

  function get(key: string): T | undefined {
    return cache.get(normalize(key))
  }

  function set(key: string, value: T): void {
    cache.set(normalize(key), value)
  }

  function has(key: string): boolean {
    return cache.has(normalize(key))
  }

  function deleteKey(key: string): boolean {
    return cache.delete(normalize(key))
  }

  function getMany(keys: string[]): Map<string, T> {
    const result = new Map<string, T>()
    for (const key of keys) {
      const normalizedKey = normalize(key)
      const value = cache.get(normalizedKey)
      if (value !== undefined) {
        result.set(normalizedKey, value)
      }
    }
    return result
  }

  function setMany(entries: Array<{ key: string; value: T }>): void {
    for (const { key, value } of entries) {
      cache.set(normalize(key), value)
    }
  }

  function clear(): void {
    cache.clear()
  }

  function size(): number {
    return cache.size
  }

  function keys(): string[] {
    return Array.from(cache.keys())
  }

  function maxSize(): number {
    return config.maxItems
  }

  return {
    get,
    set,
    has,
    delete: deleteKey,
    getMany,
    setMany,
    clear,
    size,
    maxSize,
    keys
  }
}
