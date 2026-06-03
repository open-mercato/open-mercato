import { jest } from '@jest/globals'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

type AsyncMock<T = unknown, Args extends any[] = any[]> = jest.MockedFunction<(...args: Args) => Promise<T>>
type SyncMock<T = unknown, Args extends any[] = any[]> = jest.MockedFunction<(...args: Args) => T>

export type MockEntityManager = {
  findOne: AsyncMock<any>
  find: AsyncMock<any[]>
  findAndCount: AsyncMock<[any[], number]>
  create: SyncMock<any>
  persist: SyncMock<any>
  remove: SyncMock<any>
  flush: AsyncMock<void>
  assign: SyncMock<any, [any, any]>
}

export type MockCache = {
  get: AsyncMock<any>
  set: AsyncMock<void, [string, unknown, { ttl?: number; tags?: string[] }?]>
  deleteByTags: AsyncMock<number, [string[]]>
  clearAll: () => void
}

export function createAuthMock(defaultValue?: AuthContext): AsyncMock<AuthContext> {
  const mock = jest.fn() as AsyncMock<AuthContext>
  if (defaultValue !== undefined) {
    mock.mockResolvedValue(defaultValue)
  }
  return mock
}

export function createMockEntityManager(overrides: Partial<MockEntityManager> = {}): MockEntityManager {
  const base: MockEntityManager = {
    findOne: jest.fn() as AsyncMock<any>,
    find: jest.fn() as AsyncMock<any[]>,
    findAndCount: jest.fn() as AsyncMock<[any[], number]>,
    create: jest.fn() as SyncMock<any>,
    persist: jest.fn(function persist(this: any) { return this }) as unknown as SyncMock<any>,
    remove: jest.fn(function remove(this: any) { return this }) as unknown as SyncMock<any>,
    flush: jest.fn() as AsyncMock<void>,
    assign: jest.fn() as SyncMock<any, [any, any]>,
  }
  return { ...base, ...overrides }
}

export function createMockCache(): MockCache {
  const entries = new Map<string, { value: unknown; tags: string[] }>()

  return {
    get: jest.fn(async (key: string) => entries.get(key)?.value ?? null) as AsyncMock<any>,
    set: jest.fn(async (key: string, value: unknown, options?: { ttl?: number; tags?: string[] }) => {
      entries.set(key, { value, tags: options?.tags ?? [] })
    }) as AsyncMock<void, [string, unknown, { ttl?: number; tags?: string[] }?]>,
    deleteByTags: jest.fn(async (tags: string[]) => {
      let deleted = 0
      for (const [key, entry] of entries.entries()) {
        if (entry.tags.some((tag) => tags.includes(tag))) {
          entries.delete(key)
          deleted++
        }
      }
      return deleted
    }) as AsyncMock<number, [string[]]>,
    clearAll: () => entries.clear(),
  }
}

export function createMockContainer(em: MockEntityManager, cache?: MockCache) {
  return {
    resolve: jest.fn((token: string) => {
      if (token === 'em') return em
      if (token === 'cache') return cache
      return undefined
    }),
  }
}
