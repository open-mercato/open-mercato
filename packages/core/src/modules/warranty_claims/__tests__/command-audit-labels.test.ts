import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createFallbackTranslator, createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import {
  createClaimCommand,
  createCreditMemoCommand,
  createReplacementOrderCommand,
  createSalesReturnCommand,
  deleteClaimCommand,
  setReturnLabelCommand,
  transitionClaimCommand,
  updateClaimCommand,
} from '../commands/claims'
import {
  createClaimLineCommand,
  deleteClaimLineCommand,
  receiveClaimLineCommand,
  releaseClaimLineQuarantineCommand,
  setClaimLineAssessmentCommand,
  updateClaimLineCommand,
} from '../commands/claim-lines'
import english from '../i18n/en.json'
import german from '../i18n/de.json'
import korean from '../i18n/ko.json'
import spanish from '../i18n/es.json'
import polish from '../i18n/pl.json'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(),
}))

const auditCases = [
  { command: createClaimCommand, key: 'warranty_claims.audit.claim.create' },
  { command: updateClaimCommand, key: 'warranty_claims.audit.claim.update' },
  { command: deleteClaimCommand, key: 'warranty_claims.audit.claim.delete' },
  { command: transitionClaimCommand, key: 'warranty_claims.audit.claim.transition' },
  { command: setReturnLabelCommand, key: 'warranty_claims.audit.claim.set_return_label' },
  { command: createSalesReturnCommand, key: 'warranty_claims.audit.claim.create_sales_return' },
  { command: createCreditMemoCommand, key: 'warranty_claims.audit.claim.create_credit_memo' },
  { command: createReplacementOrderCommand, key: 'warranty_claims.audit.claim.create_replacement_order' },
  { command: createClaimLineCommand, key: 'warranty_claims.audit.claim_line.create' },
  { command: updateClaimLineCommand, key: 'warranty_claims.audit.claim_line.update' },
  { command: deleteClaimLineCommand, key: 'warranty_claims.audit.claim_line.delete' },
  { command: receiveClaimLineCommand, key: 'warranty_claims.audit.claim_line.receive' },
  { command: releaseClaimLineQuarantineCommand, key: 'warranty_claims.audit.claim_line.release_quarantine' },
  { command: setClaimLineAssessmentCommand, key: 'warranty_claims.audit.claim_line.set_assessment' },
] as const

const snapshots = {
  before: { tenantId: 'tenant-id', organizationId: 'organization-id', claimId: 'claim-id', orderId: 'order-id' },
  after: { tenantId: 'tenant-id', organizationId: 'organization-id', claimId: 'claim-id', orderId: 'order-id' },
}
const result = {
  claimId: 'claim-id',
  lineId: 'line-id',
  salesReturnId: 'return-id',
  salesReturnUpdatedAt: '2026-10-13T10:00:00.000Z',
  creditMemoId: 'credit-memo-id',
  creditMemoUpdatedAt: '2026-10-13T10:00:00.000Z',
  replacementOrderId: 'replacement-order-id',
  replacementOrderUpdatedAt: '2026-10-13T10:00:00.000Z',
}

async function buildAuditLog(command: (typeof auditCases)[number]['command']) {
  const buildLog = command.buildLog as NonNullable<CommandHandler<unknown, typeof result>['buildLog']>
  return buildLog({ input: {}, result, snapshots, ctx: {} as CommandRuntimeContext })
}

describe.each([
  { locale: 'en', dictionary: english },
  { locale: 'de', dictionary: german },
  { locale: 'ko', dictionary: korean },
  { locale: 'es', dictionary: spanish },
  { locale: 'pl', dictionary: polish },
] as const)('warranty audit labels in $locale', ({ locale, dictionary }) => {
  beforeEach(() => {
    jest.mocked(resolveTranslations).mockResolvedValue({
      locale,
      dict: dictionary,
      t: createTranslator(dictionary),
      translate: createFallbackTranslator(dictionary),
    })
  })

  test.each(auditCases)('$command.id stores the translated label and retains audit metadata', async ({ command, key }) => {
    const log = await buildAuditLog(command)
    const isLine = command.id.startsWith('warranty_claims.claim_line.')
    expect(log).toMatchObject({
      actionLabel: dictionary[key],
      resourceKind: isLine ? 'warranty_claims.claim_line' : 'warranty_claims.claim',
      resourceId: isLine ? result.lineId : result.claimId,
      tenantId: snapshots.after.tenantId,
      organizationId: snapshots.after.organizationId,
      snapshotBefore: snapshots.before,
      snapshotAfter: snapshots.after,
      payload: { undo: snapshots },
    })
    expect(log?.actionLabel).not.toBe(key)
    if (isLine) {
      expect(log).toMatchObject({ parentResourceKind: 'warranty_claims.claim', parentResourceId: result.claimId })
    }
  })
})

describe('warranty audit label fallbacks and bridge undo payloads', () => {
  beforeEach(() => {
    jest.mocked(resolveTranslations).mockResolvedValue({
      locale: 'en',
      dict: {},
      t: createTranslator({}),
      translate: createFallbackTranslator({}),
    })
  })

  test.each(auditCases)('$command.id stores English when the dictionary is unavailable', async ({ command, key }) => {
    const log = await buildAuditLog(command)
    expect(log?.actionLabel).toBe(english[key])
  })

  test.each([
    { command: createSalesReturnCommand, bridge: 'salesReturn', document: { id: result.salesReturnId, orderId: 'order-id', updatedAt: result.salesReturnUpdatedAt } },
    { command: createCreditMemoCommand, bridge: 'creditMemo', document: { id: result.creditMemoId, updatedAt: result.creditMemoUpdatedAt } },
    { command: createReplacementOrderCommand, bridge: 'replacementOrder', document: { id: result.replacementOrderId, updatedAt: result.replacementOrderUpdatedAt } },
  ])('$command.id retains its sales-document undo reference', async ({ command, bridge, document }) => {
    const log = await buildAuditLog(command)
    expect(log?.payload).toEqual({ undo: { ...snapshots, [bridge]: document } })
  })
})
