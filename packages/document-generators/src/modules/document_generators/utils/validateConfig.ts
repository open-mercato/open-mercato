import type { ZodType } from 'zod'

export function validateConfig<T extends object>(raw: unknown, schema: ZodType<T>, cache: WeakMap<object, T>, name: string): T {
  const cacheable = typeof raw === 'object' && raw !== null
  const cached = cacheable ? cache.get(raw) : undefined
  if (cached) return cached
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
    throw new Error(`[internal] Invalid ${name}: ${issues}`)
  }
  if (cacheable) cache.set(raw, parsed.data)
  return parsed.data
}
