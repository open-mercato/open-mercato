/** @jest-environment node */

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

const mockEmit = jest.fn()
const mockCancel = jest.fn()
const mockAuthorized = jest.fn()
const mockReportError = jest.fn()
const mockLogError = jest.fn()
const mockLogWarn = jest.fn()
const mockResolveScope = jest.fn()
const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const id = '66666666-6666-4666-8666-666666666666'
const mockContainer = {
  resolve: (name: string) => {
    if (name === 'rbacService') return { userHasAllFeatures: mockAuthorized }
    if (name === 'customerInvitationService') return { cancelInvitation: mockCancel }
    return null
  },
}

jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('../../events', () => ({ emitCustomerAccountsEvent: (...args: unknown[]) => mockEmit(...args) }))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError: mockReportError }) }))
jest.mock('@open-mercato/shared/lib/logger', () => ({ createLogger: () => ({ child: () => ({ error: mockLogError, warn: mockLogWarn }) }) }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveScope(...args),
}))

import { cancelInvitationCommand } from '../invitations'

const ctx = {
  container: mockContainer,
  auth: { sub: 'staff', tenantId, orgId: organizationId },
} as unknown as CommandRuntimeContext

describe('cancel invitation command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuthorized.mockResolvedValue(true)
    mockCancel.mockResolvedValue(true)
    mockEmit.mockResolvedValue(undefined)
    mockReportError.mockReset()
    mockResolveScope.mockResolvedValue({ tenantId, selectedId: organizationId, filterIds: [organizationId], allowedIds: [organizationId] })
  })

  it('cancels within the authenticated scope and emits no credentials or recipient data', async () => {
    expect(await cancelInvitationCommand.execute({ id }, ctx)).toEqual({ cancelled: true, tenantId, organizationId })
    expect(mockCancel).toHaveBeenCalledWith(id, { tenantId, organizationId })
    expect(mockEmit).toHaveBeenCalledWith('customer_accounts.invitation.cancelled', { invitationId: id, tenantId, organizationId })
  })

  it('emits no lifecycle event for an idempotent or out-of-scope no-op', async () => {
    mockCancel.mockResolvedValue(false)
    expect(await cancelInvitationCommand.execute({ id }, ctx)).toEqual({ cancelled: false, tenantId, organizationId })
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('rejects direct invocations without scope or permission', async () => {
    await expect(cancelInvitationCommand.execute({ id }, { ...ctx, auth: null })).rejects.toMatchObject({ status: 401 })
    mockAuthorized.mockResolvedValue(false)
    await expect(cancelInvitationCommand.execute({ id }, ctx)).rejects.toMatchObject({ status: 403 })
    expect(mockCancel).not.toHaveBeenCalled()
  })

  it('reports a post-commit event failure while preserving success and its audit entry', async () => {
    const error = new Error('[internal] Event transport unavailable')
    mockEmit.mockRejectedValue(error)
    const result = await cancelInvitationCommand.execute({ id }, ctx)
    expect(result).toEqual({ cancelled: true, tenantId, organizationId })
    expect(mockLogError).toHaveBeenCalledWith('Invitation cancellation event failed', { err: error })
    expect(mockReportError).toHaveBeenCalledWith(error, { module: 'customer_accounts', code: 'customer_accounts.invitation_cancel_event_failed' })
    expect(await cancelInvitationCommand.buildLog?.({ input: { id }, result, ctx, snapshots: {} })).toMatchObject({
      replayable: false, resourceId: id,
    })
  })

  it('keeps the committed write successful when the telemetry reporter itself throws', async () => {
    mockEmit.mockRejectedValue(new Error('[internal] Event transport unavailable'))
    const reportingError = new Error('[internal] Reporter unavailable')
    mockReportError.mockImplementation(() => { throw reportingError })
    const result = await cancelInvitationCommand.execute({ id }, ctx)
    expect(result.cancelled).toBe(true)
    expect(mockLogWarn).toHaveBeenCalledWith('Invitation cancellation event reporting failed', { err: reportingError })
    expect(await cancelInvitationCommand.buildLog?.({ input: { id }, result, ctx, snapshots: {} })).toMatchObject({ resourceId: id })
  })

  it('uses the validated selected organization for the write, event, and audit', async () => {
    const selectedId = '77777777-7777-4777-8777-777777777777'
    const selectedContext = { ...ctx, selectedOrganizationId: selectedId, organizationScope: { tenantId, selectedId, filterIds: [selectedId], allowedIds: [organizationId, selectedId] } }
    const result = await cancelInvitationCommand.execute({ id }, selectedContext)
    expect(mockCancel).toHaveBeenCalledWith(id, { tenantId, organizationId: selectedId })
    expect(mockAuthorized).toHaveBeenCalledWith('staff', ['customer_accounts.invite'], { tenantId, organizationId: selectedId })
    expect(mockEmit).toHaveBeenCalledWith('customer_accounts.invitation.cancelled', { invitationId: id, tenantId, organizationId: selectedId })
    expect(await cancelInvitationCommand.buildLog?.({ input: { id }, result, ctx: selectedContext, snapshots: {} })).toMatchObject({ tenantId, organizationId: selectedId })
  })

  it('rejects invalid explicit scope even when its fallback matches the home organization', async () => {
    const rejectedContext = { ...ctx, organizationScope: { tenantId, selectedId: organizationId, filterIds: [organizationId], allowedIds: [organizationId], selectionRejected: true } }
    await expect(cancelInvitationCommand.execute({ id }, rejectedContext)).rejects.toMatchObject({ status: 403 })
    expect(mockCancel).not.toHaveBeenCalled()
  })

  it('records only real cancellations and disables replay of withdrawn credentials', async () => {
    expect(await cancelInvitationCommand.buildLog?.({ input: { id }, result: { cancelled: true, tenantId, organizationId }, ctx, snapshots: {} })).toMatchObject({
      replayable: false, resourceId: id, tenantId, organizationId,
    })
    expect(await cancelInvitationCommand.buildLog?.({ input: { id }, result: { cancelled: false, tenantId, organizationId }, ctx, snapshots: {} })).toEqual({ skipLog: true })
    expect(cancelInvitationCommand.isUndoable).toBe(false)
  })
})
