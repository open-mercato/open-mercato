import type { AuthContext } from '@/lib/auth/server'

type AsyncMock<T = unknown, Args extends any[] = any[]> = jest.Mock<Promise<T>, Args>
type SyncMock<T = unknown, Args extends any[] = any[]> = jest.Mock<T, Args>

export type MockEntityManager = {
  findOne: AsyncMock<any>
  find: AsyncMock<any[]>
  findAndCount: AsyncMock<[any[], number]>
  create: SyncMock<any>
  persistAndFlush: AsyncMock<void>
  assign: SyncMock<any, [any, any]>
  removeAndFlush: AsyncMock<void>
}

export function createAuthMock(defaultValue?: AuthContext): AsyncMock<AuthContext, [Request?]> {
  const mock = jest.fn<Promise<AuthContext>, [Request?]>()
  if (defaultValue !== undefined) {
    mock.mockResolvedValue(defaultValue)
  }
  return mock
}

export function createMockEntityManager(overrides: Partial<MockEntityManager> = {}): MockEntityManager {
  const base: MockEntityManager = {
    findOne: jest.fn<Promise<any>, any[]>(),
    find: jest.fn<Promise<any[]>, any[]>(),
    findAndCount: jest.fn<Promise<[any[], number]>, any[]>(),
    create: jest.fn<any, any[]>(),
    persistAndFlush: jest.fn<Promise<void>, any[]>(),
    assign: jest.fn<any, [any, any]>(),
    removeAndFlush: jest.fn<Promise<void>, any[]>(),
  }
  return { ...base, ...overrides }
}

export function createMockContainer(em: MockEntityManager) {
  return {
    resolve: jest.fn((token: string) => (token === 'em' ? em : undefined)),
  }
}
