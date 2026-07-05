import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type { ClaimCreateInput, ExternalClaimIntakeInput } from '../data/validators'

type Translate = (key: string, fallback?: string) => string

export type ExternalLookupTable = 'sales_orders' | 'customer_entities' | 'catalog_products'

export type ExternalLookupRows = (
  table: ExternalLookupTable,
  where: Record<string, string>,
  select: string[],
  limit: number,
) => Promise<Array<Record<string, unknown>> | null>

type ExternalIntakeDeps = {
  lookupRows: ExternalLookupRows
  translate: Translate
}

type ExternalLookupDb = {
  sales_orders: {
    id: string
    order_number: string
    customer_entity_id: string | null
    currency_code: string
    placed_at: Date | null
    tenant_id: string | null
    organization_id: string | null
    deleted_at: Date | null
  }
  customer_entities: {
    id: string
    display_name: string | null
    tenant_id: string | null
    organization_id: string | null
    deleted_at: Date | null
  }
  catalog_products: {
    id: string
    title: string | null
    sku: string | null
    tenant_id: string | null
    organization_id: string | null
    deleted_at: Date | null
  }
}

function isMissingTableError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const candidate = err as { code?: unknown; message?: unknown }
  return candidate.code === '42P01'
    || (typeof candidate.message === 'string' && candidate.message.includes('does not exist'))
}

export function createExternalIntakeDeps(
  em: EntityManager,
  translate: Translate,
  scope: { tenantId: string; organizationId: string },
  encryption?: TenantDataEncryptionService | null,
): ExternalIntakeDeps {
  const decryptCustomerRow = async (row: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (!encryption) return row
    try {
      return await encryption.decryptEntityPayload('customers:customer_entity', row, scope.tenantId, scope.organizationId)
    } catch {
      return row
    }
  }
  const lookupRows: ExternalLookupRows = async (table, where, select, limit) => {
    const db = em.getKysely<ExternalLookupDb>()
    try {
      let query = db
        .selectFrom(table)
        .select(select as never[])
        .where('tenant_id' as never, '=', scope.tenantId as never)
        .where('organization_id' as never, '=', scope.organizationId as never)
        .where('deleted_at' as never, 'is', null)
      for (const [column, value] of Object.entries(where)) {
        query = query.where(column as never, '=', value as never)
      }
      const rows = (await query.limit(limit).execute()) as Array<Record<string, unknown>>
      if (table === 'customer_entities') {
        return Promise.all(rows.map((row) => decryptCustomerRow(row)))
      }
      return rows
    } catch (err) {
      if (isMissingTableError(err)) return null
      throw err
    }
  }
  return { lookupRows, translate }
}

type ExternalScope = {
  tenantId: string
  organizationId: string
}

export type ExternalResolutionResult = {
  orderId: string | null
  customerId: string | null
  customerName: string | null
  currencyCode: string | null
  orderPlacedAt: Date | null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readString(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

function readDate(row: Record<string, unknown>, ...keys: string[]): Date | null {
  for (const key of keys) {
    const value = row[key]
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value)
      if (!Number.isNaN(parsed.getTime())) return parsed
    }
  }
  return null
}

function dateOnly(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

function customerDisplayName(row: Record<string, unknown> | null): string | null {
  if (!row) return null
  return readString(row, 'display_name', 'displayName', 'name')
}

function productDisplayName(row: Record<string, unknown> | null): string | null {
  if (!row) return null
  return readString(row, 'title', 'name', 'display_name', 'displayName')
}

async function lookupCustomer(
  deps: ExternalIntakeDeps,
  customerId: string,
): Promise<Record<string, unknown> | null | undefined> {
  const rows = await deps.lookupRows('customer_entities', { id: customerId }, ['id', 'display_name'], 1)
  if (rows === null) return undefined
  return rows[0] ?? null
}

function orderNotFound(deps: ExternalIntakeDeps): CrudHttpError {
  return new CrudHttpError(400, {
    error: deps.translate('warranty_claims.errors.orderNotFound', 'Order not found'),
  })
}

function customerOrderMismatch(deps: ExternalIntakeDeps): CrudHttpError {
  return new CrudHttpError(400, {
    error: deps.translate('warranty_claims.errors.customerOrderMismatch', 'Customer does not match the order'),
  })
}

function invalidCustomerReference(deps: ExternalIntakeDeps): CrudHttpError {
  return new CrudHttpError(400, {
    error: deps.translate('warranty_claims.errors.invalidReference', 'The referenced customer could not be found.'),
  })
}

export async function resolveExternalReferences(
  deps: ExternalIntakeDeps,
  input: ExternalClaimIntakeInput,
): Promise<ExternalResolutionResult> {
  let orderId: string | null = null
  let orderCustomerId: string | null = null
  let currencyCode: string | null = null
  let orderPlacedAt: Date | null = null

  if (input.orderId || input.orderNumber) {
    const where: Record<string, string> = input.orderId
      ? { id: input.orderId }
      : { order_number: input.orderNumber as string }
    const rows = await deps.lookupRows(
      'sales_orders',
      where,
      ['id', 'customer_entity_id', 'currency_code', 'placed_at', 'order_number'],
      1,
    )
    const order = rows?.[0] ?? null
    if (!order) throw orderNotFound(deps)
    orderId = readString(order, 'id')
    if (!orderId) throw orderNotFound(deps)
    orderCustomerId = readString(order, 'customer_entity_id', 'customerEntityId')
    currencyCode = readString(order, 'currency_code', 'currencyCode')
    orderPlacedAt = readDate(order, 'placed_at', 'placedAt')
  }

  let customerId = orderCustomerId
  let customerName: string | null = null

  if (orderCustomerId && input.customerId && input.customerId !== orderCustomerId) {
    throw customerOrderMismatch(deps)
  }

  if (!orderCustomerId && input.customerId) {
    const customer = await lookupCustomer(deps, input.customerId)
    if (!customer) throw invalidCustomerReference(deps)
    customerId = input.customerId
    customerName = customerDisplayName(customer)
  } else if (orderCustomerId) {
    const customer = await lookupCustomer(deps, orderCustomerId)
    customerName = customerDisplayName(customer ?? null)
  }

  if (!customerId) {
    customerName = input.contactName ?? null
  }

  return {
    orderId,
    customerId,
    customerName,
    currencyCode,
    orderPlacedAt,
  }
}

export async function resolveSkuProduct(
  deps: ExternalIntakeDeps,
  sku: string,
): Promise<{ productId: string; productName: string | null } | null> {
  const normalizedSku = sku.trim()
  if (!normalizedSku) return null
  const rows = await deps.lookupRows('catalog_products', { sku: normalizedSku }, ['id', 'title', 'sku'], 2)
  if (!rows || rows.length !== 1) return null
  const productId = readString(rows[0], 'id')
  if (!productId) return null
  return { productId, productName: productDisplayName(rows[0]) }
}

export function buildExternalClaimCreateInput(
  input: ExternalClaimIntakeInput,
  resolution: ExternalResolutionResult,
  settings: { defaultWarrantyMonths: number | null },
  scope: ExternalScope,
): ClaimCreateInput {
  const orderPurchaseDate = resolution.orderPlacedAt ? dateOnly(resolution.orderPlacedAt) : null
  return {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    claimType: 'warranty',
    channel: 'api',
    priority: 'normal',
    externalRef: input.externalRef,
    contactEmail: input.contactEmail ?? null,
    customerId: resolution.customerId,
    customerName: resolution.customerName,
    orderId: resolution.orderId,
    reasonCode: input.reasonCode ?? null,
    notes: input.notes ?? null,
    currencyCode: resolution.currencyCode,
    lines: input.lines.map((line, index) => ({
      lineNo: index + 1,
      productId: line.productId ?? null,
      variantId: null,
      sku: line.sku ?? null,
      productName: line.productName ?? null,
      orderLineId: null,
      serialNumber: line.serialNumber ?? null,
      purchaseDate: line.purchaseDate ?? orderPurchaseDate,
      warrantyMonths: line.warrantyMonths ?? settings.defaultWarrantyMonths,
      faultCode: line.faultCode ?? null,
      faultDescription: line.faultDescription,
      qtyClaimed: line.qtyClaimed ?? 1,
    })),
  }
}


export type ExternalIntakeCommandBus = {
  execute: (commandId: string, args: { input: unknown; ctx: unknown }) => Promise<{ result?: unknown }>
}

export type ExternalIntakeExecution =
  | { outcome: 'created'; claimId: string }
  | { outcome: 'existing' }

export async function createAndSubmitExternalClaim(input: {
  commandBus: ExternalIntakeCommandBus
  commandCtx: unknown
  createInput: ClaimCreateInput
  scope: ExternalScope
  externalRef: string
  hasExistingByExternalRef: (externalRef: string) => Promise<boolean>
  saveFailedError: () => Error
}): Promise<ExternalIntakeExecution> {
  let claimId: string
  try {
    const createResult = await input.commandBus.execute('warranty_claims.claim.create', {
      input: input.createInput,
      ctx: input.commandCtx,
    })
    const createdClaimId = (createResult.result as { claimId?: unknown } | undefined)?.claimId
    if (typeof createdClaimId !== 'string') throw input.saveFailedError()
    claimId = createdClaimId
  } catch (err) {
    if (isUniqueViolation(err) && await input.hasExistingByExternalRef(input.externalRef)) {
      return { outcome: 'existing' }
    }
    throw err
  }
  const scopedInput = { id: claimId, organizationId: input.scope.organizationId, tenantId: input.scope.tenantId }
  try {
    await input.commandBus.execute('warranty_claims.claim.submit', { input: scopedInput, ctx: input.commandCtx })
  } catch (submitError) {
    await input.commandBus
      .execute('warranty_claims.claim.delete', { input: scopedInput, ctx: input.commandCtx })
      .catch(() => undefined)
    throw submitError
  }
  return { outcome: 'created', claimId }
}

export function isUniqueViolation(err: unknown): boolean {
  const visited = new Set<unknown>()
  const inspect = (value: unknown, depth: number): boolean => {
    if (depth > 4 || !value || typeof value !== 'object' || visited.has(value)) return false
    visited.add(value)
    const record = asRecord(value)
    if (record.code === '23505' || record.sqlState === '23505') return true
    return inspect(record.driverError, depth + 1)
      || inspect(record.cause, depth + 1)
      || inspect(record.originalError, depth + 1)
      || inspect(record.original, depth + 1)
      || inspect(record.parent, depth + 1)
  }
  return inspect(err, 0)
}
