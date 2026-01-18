import { jest } from '@jest/globals'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

type AsyncMock<T = unknown> = jest.MockedFunction<(...args: any[]) => Promise<T>>
type SyncMock<T = unknown, Args extends any[] = any[]> = jest.MockedFunction<(...args: Args) => T>

export type MockEntityManager = {
  findOne: AsyncMock<any>
  find: AsyncMock<any[]>
  findAndCount: AsyncMock<[any[], number]>
  create: SyncMock<any>
  persistAndFlush: AsyncMock<void>
  assign: SyncMock<any, [any, any]>
  removeAndFlush: AsyncMock<void>
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
    persistAndFlush: jest.fn() as AsyncMock<void>,
    assign: jest.fn() as SyncMock<any, [any, any]>,
    removeAndFlush: jest.fn() as AsyncMock<void>,
  }
  return { ...base, ...overrides }
}

export function createMockContainer(em: MockEntityManager) {
  return {
    resolve: jest.fn((token: string) => (token === 'em' ? em : undefined)),
  }
}
