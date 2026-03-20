import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { CheckoutLink, CheckoutLinkTemplate } from '../data/entities'
import { requireCheckoutScope, type CheckoutScope } from '../lib/utils'
import { serializeTemplateOrLink, toMoneyString } from '../lib/utils'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function resolveCommandScope(ctx: CommandRuntimeContext): CheckoutScope {
  return requireCheckoutScope({ auth: ctx.auth })
}

export function readCommandId(input: unknown, message: string): string {
  if (typeof input === 'string' && input.trim()) return input
  if (isRecord(input)) {
    if (typeof input.id === 'string' && input.id.trim()) return input.id
    if (isRecord(input.body) && typeof input.body.id === 'string' && input.body.id.trim()) return input.body.id
  }
  throw new CrudHttpError(400, { error: message })
}

type CheckoutRecordView = ReturnType<typeof serializeTemplateOrLink>

export type CheckoutTemplateSnapshot = CheckoutRecordView & {
  organizationId: string
  tenantId: string
  passwordHash: string | null
  custom?: CustomFieldSnapshot
}

export type CheckoutLinkSnapshot = CheckoutTemplateSnapshot & {
  slug: string
  templateId: string | null
  completionCount: number
  activeReservationCount: number
  isLocked: boolean
}

function cloneJson<T>(value: T): T {
  if (value == null) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function captureTemplateSnapshot(
  record: CheckoutLinkTemplate,
  custom?: CustomFieldSnapshot,
): CheckoutTemplateSnapshot {
  return {
    ...cloneJson(serializeTemplateOrLink(record)),
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    passwordHash: record.passwordHash ?? null,
    custom: custom ? cloneJson(custom) : undefined,
  }
}

export function captureLinkSnapshot(
  record: CheckoutLink,
  custom?: CustomFieldSnapshot,
): CheckoutLinkSnapshot {
  return {
    ...captureTemplateSnapshot(record, custom),
    slug: record.slug,
    templateId: record.templateId ?? null,
    completionCount: record.completionCount,
    activeReservationCount: record.activeReservationCount,
    isLocked: record.isLocked,
  }
}

function buildTemplateSnapshotData(snapshot: CheckoutTemplateSnapshot) {
  return {
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    name: snapshot.name,
    title: snapshot.title ?? null,
    subtitle: snapshot.subtitle ?? null,
    description: snapshot.description ?? null,
    logoAttachmentId: snapshot.logoAttachmentId ?? null,
    logoUrl: snapshot.logoUrl ?? null,
    primaryColor: snapshot.primaryColor ?? null,
    secondaryColor: snapshot.secondaryColor ?? null,
    backgroundColor: snapshot.backgroundColor ?? null,
    themeMode: snapshot.themeMode,
    pricingMode: snapshot.pricingMode,
    fixedPriceAmount: toMoneyString(snapshot.fixedPriceAmount),
    fixedPriceCurrencyCode: snapshot.fixedPriceCurrencyCode ?? null,
    fixedPriceIncludesTax: snapshot.fixedPriceIncludesTax,
    fixedPriceOriginalAmount: toMoneyString(snapshot.fixedPriceOriginalAmount),
    customAmountMin: toMoneyString(snapshot.customAmountMin),
    customAmountMax: toMoneyString(snapshot.customAmountMax),
    customAmountCurrencyCode: snapshot.customAmountCurrencyCode ?? null,
    priceListItems: cloneJson(snapshot.priceListItems ?? []),
    gatewayProviderKey: snapshot.gatewayProviderKey ?? null,
    gatewaySettings: cloneJson(snapshot.gatewaySettings ?? {}),
    customFieldsetCode: snapshot.customFieldsetCode ?? null,
    collectCustomerDetails: snapshot.collectCustomerDetails,
    customerFieldsSchema: cloneJson(snapshot.customerFieldsSchema ?? []),
    legalDocuments: cloneJson(snapshot.legalDocuments ?? {}),
    displayCustomFieldsOnPage: snapshot.displayCustomFieldsOnPage,
    successTitle: snapshot.successTitle ?? null,
    successMessage: snapshot.successMessage ?? null,
    cancelTitle: snapshot.cancelTitle ?? null,
    cancelMessage: snapshot.cancelMessage ?? null,
    errorTitle: snapshot.errorTitle ?? null,
    errorMessage: snapshot.errorMessage ?? null,
    successEmailSubject: snapshot.successEmailSubject ?? null,
    successEmailBody: snapshot.successEmailBody ?? null,
    sendSuccessEmail: snapshot.sendSuccessEmail,
    errorEmailSubject: snapshot.errorEmailSubject ?? null,
    errorEmailBody: snapshot.errorEmailBody ?? null,
    sendErrorEmail: snapshot.sendErrorEmail,
    startEmailSubject: snapshot.startEmailSubject ?? null,
    startEmailBody: snapshot.startEmailBody ?? null,
    sendStartEmail: snapshot.sendStartEmail,
    passwordHash: snapshot.passwordHash ?? null,
    maxCompletions: snapshot.maxCompletions ?? null,
    status: snapshot.status,
    checkoutType: snapshot.checkoutType,
    deletedAt: null,
  }
}

export function restoreTemplateFromSnapshot(
  target: CheckoutLinkTemplate,
  snapshot: CheckoutTemplateSnapshot,
): void {
  Object.assign(target, buildTemplateSnapshotData(snapshot))
}

export function restoreLinkFromSnapshot(
  target: CheckoutLink,
  snapshot: CheckoutLinkSnapshot,
): void {
  Object.assign(target, {
    ...buildTemplateSnapshotData(snapshot),
    slug: snapshot.slug,
    templateId: snapshot.templateId ?? null,
    completionCount: snapshot.completionCount,
    activeReservationCount: snapshot.activeReservationCount,
    isLocked: snapshot.isLocked,
  })
}

export function createTemplateFromSnapshot(snapshot: CheckoutTemplateSnapshot) {
  return {
    id: snapshot.id,
    ...buildTemplateSnapshotData(snapshot),
  }
}

export function createLinkFromSnapshot(snapshot: CheckoutLinkSnapshot) {
  return {
    id: snapshot.id,
    ...buildTemplateSnapshotData(snapshot),
    slug: snapshot.slug,
    templateId: snapshot.templateId ?? null,
    completionCount: snapshot.completionCount,
    activeReservationCount: snapshot.activeReservationCount,
    isLocked: snapshot.isLocked,
  }
}

export function toCheckoutAuditSnapshot(
  snapshot: CheckoutTemplateSnapshot | CheckoutLinkSnapshot,
): Record<string, unknown> {
  const { passwordHash: _passwordHash, ...rest } = snapshot
  return cloneJson(rest) as Record<string, unknown>
}

export { extractUndoPayload }
