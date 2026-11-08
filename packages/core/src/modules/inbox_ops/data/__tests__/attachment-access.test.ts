/** @jest-environment node */

import type { AwilixContainer } from 'awilix'
import { createAttachmentAccessContext, evaluateAttachmentAccess } from '@open-mercato/core/modules/attachments/lib/access-runner'
import { getAttachmentAccessRegistry, registerAttachmentAccessResolvers } from '@open-mercato/core/modules/attachments/lib/access-registry'
import type {
  AttachmentAccessAction,
  AttachmentAccessInput,
  AttachmentAccessTarget,
} from '@open-mercato/core/modules/attachments/lib/access-types'
import { attachmentAccessResolvers, protectedAttachmentTargets } from '../attachment-access'
import { InboxEmail } from '../entities'

const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const TENANT_B = '33333333-3333-4333-8333-333333333333'
const ORG_B = '44444444-4444-4444-8444-444444444444'
const EMAIL_LIVE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const EMAIL_PENDING_RELEASE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OWNER = 'inbox_ops:inbox_email'

const resolver = attachmentAccessResolvers[0]
const em = { name: 'request-em' }
const container = { resolve: jest.fn(() => em) } as unknown as AwilixContainer & { resolve: jest.Mock }

function primary(recordId: string): AttachmentAccessTarget {
  return { entityId: OWNER, recordId, origin: 'primary' }
}

function buildInput(overrides: {
  action?: AttachmentAccessAction
  userFeatures?: string[]
  isSuperAdmin?: boolean
  targets?: AttachmentAccessTarget[]
  tenantId?: string | null
  organizationId?: string | null
  cache?: Map<string, unknown>
} = {}): AttachmentAccessInput {
  const tenantId = overrides.tenantId === undefined ? TENANT_A : overrides.tenantId
  const organizationId = overrides.organizationId === undefined ? ORG_A : overrides.organizationId
  const targets = overrides.targets ?? [primary(EMAIL_LIVE)]
  return {
    action: overrides.action ?? 'read',
    subject: {
      auth: { sub: 'user-1', tenantId, orgId: organizationId },
      userFeatures: overrides.userFeatures ?? ['inbox_ops.proposals.view'],
      tenantId,
      organizationId,
      isSuperAdmin: overrides.isSuperAdmin ?? false,
    },
    attachment: {
      id: 'attachment-1',
      entityId: targets[0]?.entityId ?? OWNER,
      recordId: targets[0]?.recordId ?? EMAIL_LIVE,
      partitionCode: 'privateAttachments',
      tenantId,
      organizationId,
      fileName: 'offer.pdf',
      mimeType: 'application/pdf',
    },
    partition: { code: 'privateAttachments', isPublic: false, tenantId: null, organizationId: null },
    targets,
    container,
    cache: overrides.cache ?? new Map(),
    signal: new AbortController().signal,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindWithDecryption.mockResolvedValue([{ id: EMAIL_PENDING_RELEASE }])
})

describe('inbox_ops attachment access declaration', () => {
  afterEach(() => registerAttachmentAccessResolvers([]))

  it('declares one resolver and a protected target kept out of the shared library', () => {
    expect(attachmentAccessResolvers).toHaveLength(1)
    expect(resolver).toMatchObject({ id: 'inbox_ops.email-attachments', targetPartition: '*', targetEntity: OWNER })
    expect(protectedAttachmentTargets).toEqual([
      { resolverId: 'inbox_ops.email-attachments', targetPartition: '*', targetEntity: OWNER, listInLibrary: false },
    ])
  })

  it('passes the attachments registry validation', () => {
    registerAttachmentAccessResolvers([{
      moduleId: 'inbox_ops',
      resolvers: attachmentAccessResolvers,
      protectedTargets: protectedAttachmentTargets,
    }])
    const registry = getAttachmentAccessRegistry()
    expect(registry.invalid).toBe(false)
    expect(registry.resolvers.map((entry) => entry.id)).toEqual(['inbox_ops.email-attachments'])
    expect(registry.protectedTargets).toEqual([
      expect.objectContaining({ resolverId: 'inbox_ops.email-attachments', targetEntity: OWNER, listInLibrary: false }),
    ])
  })
})

describe('inbox_ops.email-attachments resolver', () => {
  it.each(['read', 'render', 'metadata', 'export'] as const)('allows %s with inbox_ops.proposals.view', async (action) => {
    await expect(resolver.resolve(buildInput({ action }))).resolves.toEqual({ ok: true })
  })

  it.each([
    ['a module wildcard', ['inbox_ops.*'], false],
    ['the global wildcard of a super-admin', ['*'], true],
  ])('allows reads through %s', async (_label, userFeatures, isSuperAdmin) => {
    await expect(resolver.resolve(buildInput({ userFeatures, isSuperAdmin }))).resolves.toEqual({ ok: true })
  })

  it.each(['read', 'render', 'metadata', 'export'] as const)('answers 404 for %s without the feature and never queries', async (action) => {
    const decision = await resolver.resolve(buildInput({
      action,
      userFeatures: ['inbox_ops.log.view', 'attachments.view', 'attachments.manage', 'inbox_ops.proposals'],
    }))
    expect(decision).toEqual({ ok: false, status: 404, reason: 'inbox_email_not_found' })
    expect(container.resolve).not.toHaveBeenCalled()
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('answers 404 when the owning email is deleted and its attachments are not released yet', async () => {
    await expect(resolver.resolve(buildInput({ targets: [primary(EMAIL_PENDING_RELEASE)] })))
      .resolves.toEqual({ ok: false, status: 404, reason: 'inbox_email_not_found' })
  })

  it('answers 404 when a pending-release email is only an assignment target, whatever the id case', async () => {
    const decision = await resolver.resolve(buildInput({
      targets: [
        { entityId: 'library:upload', recordId: 'upload-1', origin: 'primary' },
        { entityId: OWNER, recordId: EMAIL_PENDING_RELEASE.toUpperCase(), origin: 'assignment' },
      ],
    }))
    expect(decision).toEqual({ ok: false, status: 404, reason: 'inbox_email_not_found' })
  })

  it('also denies super-admins while the deletion is pending release', async () => {
    await expect(resolver.resolve(buildInput({
      userFeatures: ['*'], isSuperAdmin: true, targets: [primary(EMAIL_PENDING_RELEASE)],
    }))).resolves.toMatchObject({ ok: false, status: 404 })
  })

  it.each([
    ['delete', false, ['inbox_ops.proposals.view', 'inbox_ops.proposals.manage', 'attachments.manage']],
    ['reassign', false, ['inbox_ops.proposals.view', 'inbox_ops.proposals.manage', 'attachments.manage']],
    ['delete', true, ['*']],
    ['reassign', true, ['*']],
    ['delete', false, ['inbox_ops.*']],
  ] as const)('refuses %s with 403 to a reader (super-admin: %s) without any lookup', async (action, isSuperAdmin, userFeatures) => {
    const decision = await resolver.resolve(buildInput({ action, isSuperAdmin, userFeatures: [...userFeatures] }))
    expect(decision).toEqual({ ok: false, status: 403, reason: 'inbox_email_attachment_managed_by_inbox' })
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it.each([
    ['delete', []],
    ['reassign', ['attachments.manage', 'inbox_ops.proposals.manage', 'inbox_ops.log.view']],
  ] as const)('answers 404 for %s without the read feature, so the id is not revealed as an inbox attachment', async (action, userFeatures) => {
    const decision = await resolver.resolve(buildInput({ action, userFeatures: [...userFeatures] }))
    expect(decision).toEqual({ ok: false, status: 404, reason: 'inbox_email_not_found' })
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('hides a global row claiming an email owner without querying', async () => {
    await expect(resolver.resolve(buildInput({ tenantId: null, organizationId: null })))
      .resolves.toMatchObject({ ok: false, status: 404 })
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('loads the deny set once per tenant-and-organization scope with a WHERE served by the partial index', async () => {
    const cache = new Map<string, unknown>()
    const decisions = await Promise.all([
      resolver.resolve(buildInput({ cache, targets: [primary(EMAIL_LIVE)] })),
      resolver.resolve(buildInput({ cache, targets: [primary(EMAIL_PENDING_RELEASE)] })),
      resolver.resolve(buildInput({ cache, action: 'metadata', targets: [primary(EMAIL_LIVE)] })),
    ])
    expect(decisions.map((decision) => decision.ok)).toEqual([true, false, true])
    expect(mockFindWithDecryption).toHaveBeenCalledTimes(1)
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      em,
      InboxEmail,
      {
        tenantId: TENANT_A,
        organizationId: ORG_A,
        deletedAt: { $ne: null },
        attachmentsReleasedAt: null,
        $or: [
          { attachmentsStatus: { $ne: null } },
          { attachmentsReleaseRequestedAt: { $ne: null } },
        ],
      },
      { fields: ['id'], disableIdentityMap: true },
      { tenantId: TENANT_A, organizationId: ORG_A },
    )
  })

  it('fails closed when the deny-set query fails', async () => {
    mockFindWithDecryption.mockRejectedValueOnce(new Error('db down'))
    await expect(resolver.resolve(buildInput())).rejects.toThrow('db down')
  })
})

describe('inbox_ops.email-attachments through the attachments access runner', () => {
  const superAdminRbac = {
    loadAcl: jest.fn(async () => ({ isSuperAdmin: true, organizations: null })),
    getEffectiveFeatures: jest.fn(async () => ['*']),
  }
  const runnerContainer = {
    resolve: jest.fn((token: string) => (token === 'rbacService' ? superAdminRbac : em)),
  } as unknown as AwilixContainer
  const partition = { code: 'privateAttachments', isPublic: false }
  const superAdmin = { sub: 'root', tenantId: TENANT_A, orgId: ORG_A, roles: ['superadmin'], isSuperAdmin: true }

  function row(id: string, emailId: string, tenantId: string, organizationId: string) {
    return {
      id, entityId: OWNER, recordId: emailId, partitionCode: 'privateAttachments',
      tenantId, organizationId, fileName: `${id}.pdf`, mimeType: 'application/pdf',
    }
  }

  beforeEach(() => {
    registerAttachmentAccessResolvers([{
      moduleId: 'inbox_ops',
      resolvers: attachmentAccessResolvers,
      protectedTargets: protectedAttachmentTargets,
    }])
    mockFindWithDecryption.mockImplementation(async (_em: unknown, _entity: unknown, where: { tenantId: string }) => (
      where.tenantId === TENANT_A ? [{ id: EMAIL_PENDING_RELEASE }] : []
    ))
  })

  afterEach(() => registerAttachmentAccessResolvers([]))

  it('keys deny sets by the scope of each row in a super-admin scan', async () => {
    const context = createAttachmentAccessContext(runnerContainer)
    const scan = [
      row('a-1', EMAIL_PENDING_RELEASE, TENANT_A, ORG_A),
      row('a-2', EMAIL_LIVE, TENANT_A, ORG_A),
      row('b-1', EMAIL_PENDING_RELEASE, TENANT_B, ORG_B),
      row('b-2', EMAIL_LIVE, TENANT_B, ORG_B),
    ]
    const results = []
    for (const attachment of scan) {
      results.push(await evaluateAttachmentAccess({ auth: superAdmin, attachment, partition, action: 'read', context }))
    }
    expect(results.map((result) => result.ok)).toEqual([false, true, true, true])
    expect(results[0]).toMatchObject({ status: 404, protected: true })
    expect(mockFindWithDecryption).toHaveBeenCalledTimes(2)
    expect(mockFindWithDecryption.mock.calls.map((call) => call[4])).toEqual([
      { tenantId: TENANT_A, organizationId: ORG_A },
      { tenantId: TENANT_B, organizationId: ORG_B },
    ])
  })

  it('refuses deletion to a super-admin', async () => {
    const result = await evaluateAttachmentAccess({
      auth: superAdmin,
      attachment: row('a-2', EMAIL_LIVE, TENANT_A, ORG_A),
      partition,
      action: 'delete',
      context: createAttachmentAccessContext(runnerContainer),
    })
    expect(result).toMatchObject({ ok: false, status: 403, protected: true })
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })
})
