/** @jest-environment node */

import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  resolveAvailabilityWriteAccess,
  assertAvailabilityWriteAccess,
  type AvailabilityAccessContext,
  type AvailabilityWriteAccess,
} from '../api/access'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

const mockLogger = jest.requireMock('@open-mercato/shared/lib/logger').createLogger('test') as {
  debug: jest.Mock
  info: jest.Mock
  warn: jest.Mock
  error: jest.Mock
}


type ResolveOptions = { allowUnregistered?: boolean }

type MockResolveSpec = {
  registered: boolean
  resolver?: { resolveAvailabilityWriteAccess: jest.Mock }
}

function buildContainer(spec: MockResolveSpec) {
  const resolve = jest.fn((name: string, opts?: ResolveOptions) => {
    if (name !== 'availabilityAccessResolver') {
      throw new Error(`unexpected resolve: ${name}`)
    }
    if (spec.registered) return spec.resolver
    if (opts?.allowUnregistered) return undefined
    throw new Error('Awilix would throw when unregistered without allowUnregistered')
  })
  return { resolve } as unknown as AvailabilityAccessContext['container']
}

function ctxWithContainer(
  container: AvailabilityAccessContext['container'],
  overrides?: Partial<AvailabilityAccessContext>,
): AvailabilityAccessContext {
  return {
    container,
    auth: {
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    } as AvailabilityAccessContext['auth'],
    selectedOrganizationId: 'org-1',
    ...overrides,
  }
}

const translate = (_key: string, fallback?: string) => fallback ?? 'unauthorized'

describe('planner availability access — fail-soft when staff DI is absent', () => {
  let warnSpy: jest.Mock
  beforeEach(() => {
    mockLogger.warn.mockClear()
    warnSpy = mockLogger.warn
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('returns unregistered: true with all permissions denied when resolver is missing', async () => {
    const container = buildContainer({ registered: false })
    const access = await resolveAvailabilityWriteAccess(ctxWithContainer(container))
    expect(access).toEqual({
      canManageAll: false,
      canManageSelf: false,
      canManageUnavailability: false,
      memberId: null,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      unregistered: true,
    })
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('availabilityAccessResolver unregistered'),
    )
  })

  it('asserts a dedicated 403 staff_module_not_loaded error when staff is absent', async () => {
    const container = buildContainer({ registered: false })
    try {
      await assertAvailabilityWriteAccess(
        ctxWithContainer(container),
        { subjectType: 'member', subjectId: 'member-1' },
        translate,
      )
      throw new Error('expected throw')
    } catch (err) {
      expect(isCrudHttpError(err)).toBe(true)
      expect((err as { status: number }).status).toBe(403)
      expect((err as { body: { error: string } }).body).toEqual({
        error: 'staff_module_not_loaded',
      })
    }
  })
})

describe('planner availability access — delegates to staff resolver when registered', () => {
  it('returns the resolver response verbatim (canManageAll path)', async () => {
    const resolverShape: AvailabilityWriteAccess = {
      canManageAll: true,
      canManageSelf: true,
      canManageUnavailability: true,
      memberId: null,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }
    const resolver = {
      resolveAvailabilityWriteAccess: jest.fn(async () => resolverShape),
    }
    const container = buildContainer({ registered: true, resolver })

    const access = await resolveAvailabilityWriteAccess(ctxWithContainer(container))
    expect(access).toBe(resolverShape)
    expect(resolver.resolveAvailabilityWriteAccess).toHaveBeenCalledTimes(1)
  })

  it('throws the standard unauthorized 403 when access is denied (not unregistered)', async () => {
    const resolver = {
      resolveAvailabilityWriteAccess: jest.fn(async () => ({
        canManageAll: false,
        canManageSelf: false,
        canManageUnavailability: false,
        memberId: null,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      })),
    }
    const container = buildContainer({ registered: true, resolver })

    try {
      await assertAvailabilityWriteAccess(
        ctxWithContainer(container),
        { subjectType: 'member', subjectId: 'member-1' },
        translate,
      )
      throw new Error('expected throw')
    } catch (err) {
      expect(isCrudHttpError(err)).toBe(true)
      expect((err as { status: number }).status).toBe(403)
      const body = (err as { body: { error: string } }).body
      expect(body.error).not.toBe('staff_module_not_loaded')
    }
  })

  it('permits self-scope edits only when memberId matches the requested subject', async () => {
    const resolver = {
      resolveAvailabilityWriteAccess: jest.fn(async () => ({
        canManageAll: false,
        canManageSelf: true,
        canManageUnavailability: false,
        memberId: 'member-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      })),
    }
    const container = buildContainer({ registered: true, resolver })

    const access = await assertAvailabilityWriteAccess(
      ctxWithContainer(container),
      { subjectType: 'member', subjectId: 'member-1' },
      translate,
    )
    expect(access.memberId).toBe('member-1')

    try {
      await assertAvailabilityWriteAccess(
        ctxWithContainer(container),
        { subjectType: 'member', subjectId: 'other-member' },
        translate,
      )
      throw new Error('expected throw')
    } catch (err) {
      expect(isCrudHttpError(err)).toBe(true)
    }
  })
})
