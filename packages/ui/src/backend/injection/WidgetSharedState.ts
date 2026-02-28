type Subscriber = (value: unknown) => void

export interface WidgetSharedState {
  get<T>(key: string): T | undefined
  set<T>(key: string, value: T): void
  subscribe(key: string, handler: Subscriber): () => void
}

class NamespacedWidgetSharedState implements WidgetSharedState {
  private readonly values = new Map<string, unknown>()
  private readonly subscribers = new Map<string, Set<Subscriber>>()

  constructor(private readonly namespace: string) {}

  get<T>(key: string): T | undefined {
    return this.values.get(this.toScopedKey(key)) as T | undefined
  }

  set<T>(key: string, value: T): void {
    const scopedKey = this.toScopedKey(key)
    this.values.set(scopedKey, value)
    const handlers = this.subscribers.get(scopedKey)
    if (!handlers || handlers.size === 0) return
    for (const handler of handlers) {
      handler(value)
    }
  }

  subscribe(key: string, handler: Subscriber): () => void {
    const scopedKey = this.toScopedKey(key)
    const handlers = this.subscribers.get(scopedKey) ?? new Set<Subscriber>()
    handlers.add(handler)
    this.subscribers.set(scopedKey, handlers)
    return () => {
      const current = this.subscribers.get(scopedKey)
      if (!current) return
      current.delete(handler)
      if (current.size === 0) {
        this.subscribers.delete(scopedKey)
      }
    }
  }

  private toScopedKey(key: string): string {
    return `${this.namespace}:${key}`
  }
}

const storeByNamespace = new Map<string, WidgetSharedState>()

export function getWidgetSharedState(namespace: string): WidgetSharedState {
  const normalized = namespace.trim().length > 0 ? namespace.trim() : 'global'
  const existing = storeByNamespace.get(normalized)
  if (existing) return existing
  const created = new NamespacedWidgetSharedState(normalized)
  storeByNamespace.set(normalized, created)
  return created
}
