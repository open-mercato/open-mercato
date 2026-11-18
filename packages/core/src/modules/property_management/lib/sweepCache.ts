import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import type { CacheStrategy } from '@open-mercato/cache'

const cursorIdSchema = z.string().uuid()

export const SWEEP_CURSOR_TTL_MS = 24 * 60 * 60 * 1000

export function resolveSweepCache(container: AwilixContainer): CacheStrategy | null {
  try {
    const cache = container.resolve('cache') as CacheStrategy | null | undefined
    return cache && typeof cache.get === 'function' && typeof cache.set === 'function' && typeof cache.delete === 'function' ? cache : null
  } catch {
    return null
  }
}

export function isCursorId(value: unknown): value is string {
  return cursorIdSchema.safeParse(value).success
}
