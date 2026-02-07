// @ts-nocheck

import { randomUUID } from 'crypto'
import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, emitCrudSideEffects, requireId, type CrudEventsConfig } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { deriveResourceFromCommandId, invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { normalizeCustomFieldValues } from '@open-mercato/shared/lib/custom-fields/normalize'
import { E } from '#generated/entities.ids.generated'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  SalesQuote,
  SalesQuoteLine,
  SalesQuoteAdjustment,
  SalesOrder,
  SalesOrderLine,
  SalesOrderAdjustment,
  SalesShipment,
  SalesShipmentItem,
  SalesPayment,
  SalesPaymentAllocation,
  SalesDocumentAddress,
  SalesNote,
  SalesChannel,
  SalesShippingMethod,
  SalesDeliveryWindow,
  SalesPaymentMethod,
  SalesDocumentTag,
  SalesDocumentTagAssignment,
  type SalesLineKind,
  type SalesAdjustmentKind,
  type SalesSettings,
} from '../data/entities'
import { CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import {
  CustomerAddress,
  CustomerEntity,
  CustomerPersonProfile,
} from '../../customers/data/entities'
import {
  quoteCreateSchema,
  quoteLineCreateSchema,
  quoteAdjustmentCreateSchema,
  orderCreateSchema,
  orderLineCreateSchema,
  orderAdjustmentCreateSchema,
  type QuoteCreateInput,
  type QuoteLineCreateInput,
  type QuoteAdjustmentCreateInput,
  type OrderCreateInput,
  type OrderLineCreateInput,
  type OrderAdjustmentCreateInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  toNumericString,
} from './shared'
import {
  loadShipmentSnapshot,
  restoreShipmentSnapshot,
  type ShipmentSnapshot,
} from './shipments'
import {
  loadPaymentSnapshot,
  restorePaymentSnapshot,
  type PaymentSnapshot,
} from './payments'
import type { SalesCalculationService } from '../services/salesCalculationService'
import type { TaxCalculationService } from '../services/taxCalculationService'
import type { PaymentMethodContext, ShippingMethodContext } from '../lib/providers'
import {
  type SalesLineSnapshot,
  type SalesAdjustmentDraft,
  type SalesLineCalculationResult,
  type SalesDocumentCalculationResult,
} from '../lib/types'
import { resolveDictionaryEntryValue } from '../lib/dictionaries'
import { resolveStatusEntryIdByValue } from '../lib/statusHelpers'
import { SalesDocumentNumberGenerator } from '../services/salesDocumentNumberGenerator'
import { loadSalesSettings } from './settings'
import { notificationTypes } from '../notifications'

// CRUD events configuration for workflow triggers
const orderCrudEvents: CrudEventsConfig<SalesOrder> = {
  module: 'sales',
  entity: 'orders',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const quoteCrudEvents: CrudEventsConfig<SalesQuote> = {
  module: 'sales',
  entity: 'quotes',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type DocumentAddressSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  documentId: string
  documentKind: 'order' | 'quote'
  customerAddressId: string | null
  name: string | null
  purpose: string | null
  companyName: string | null
  addressLine1: string
  addressLine2: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
  buildingNumber: string | null
  flatNumber: string | null
  latitude: number | null
  longitude: number | null
}

type NoteSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  contextType: 'order' | 'quote'
  contextId: string
  orderId: string | null
  quoteId: string | null
  body: string
  authorUserId: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
}

type TagAssignmentSnapshot = {
  id: string
  tagId: string
  organizationId: string
  tenantId: string
  documentId: string
  documentKind: 'order' | 'quote'
}

type QuoteGraphSnapshot = {
  quote: {
    id: string
    organizationId: string
    tenantId: string
    quoteNumber: string
    statusEntryId: string | null
    status: string | null
    customerEntityId: string | null
    customerContactId: string | null
    customerSnapshot: Record<string, unknown> | null
    billingAddressId: string | null
    shippingAddressId: string | null
    billingAddressSnapshot: Record<string, unknown> | null
    shippingAddressSnapshot: Record<string, unknown> | null
    currencyCode: string
    validFrom: string | null
    validUntil: string | null
    comments: string | null
    taxInfo: Record<string, unknown> | null
    shippingMethodId: string | null
    shippingMethodCode: string | null
    deliveryWindowId: string | null
    deliveryWindowCode: string | null
    paymentMethodId: string | null
    paymentMethodCode: string | null
    channelId: string | null
    shippingMethodSnapshot: Record<string, unknown> | null
    deliveryWindowSnapshot: Record<string, unknown> | null
    paymentMethodSnapshot: Record<string, unknown> | null
    metadata: Record<string, unknown> | null
    customFieldSetId: string | null
    customFields: Record<string, unknown> | null
    subtotalNetAmount: string
    subtotalGrossAmount: string
    discountTotalAmount: string
    taxTotalAmount: string
    grandTotalNetAmount: string
    grandTotalGrossAmount: string
    totalsSnapshot: Record<string, unknown> | null
    lineItemCount: number
  }
  lines: QuoteLineSnapshot[]
  adjustments: QuoteAdjustmentSnapshot[]
  addresses: DocumentAddressSnapshot[]
  notes: NoteSnapshot[]
  tags: TagAssignmentSnapshot[]
}

type QuoteLineSnapshot = {
  id: string
  lineNumber: number
  kind: string
  statusEntryId: string | null
  status: string | null
  productId: string | null
  productVariantId: string | null
  catalogSnapshot: Record<string, unknown> | null
  name: string | null
  description: string | null
  comment: string | null
  quantity: string
  quantityUnit: string | null
  currencyCode: string
  unitPriceNet: string
  unitPriceGross: string
  discountAmount: string
  discountPercent: string
  taxRate: string
  taxAmount: string
  totalNetAmount: string
  totalGrossAmount: string
  configuration: Record<string, unknown> | null
  promotionCode: string | null
  promotionSnapshot: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  customFieldSetId: string | null
  customFields: Record<string, unknown> | null
}

type QuoteAdjustmentSnapshot = {
  id: string
  scope: 'order' | 'line'
  kind: string
  code: string | null
  label: string | null
  calculatorKey: string | null
  promotionId: string | null
  rate: string
  amountNet: string
  amountGross: string
  currencyCode: string | null
  metadata: Record<string, unknown> | null
  position: number
  quoteLineId: string | null
  customFields: Record<string, unknown> | null
}

type OrderGraphSnapshot = {
  order: {
    id: string
    organizationId: string
    tenantId: string
    orderNumber: string
    statusEntryId: string | null
    status: string | null
    fulfillmentStatusEntryId: string | null
    fulfillmentStatus: string | null
    paymentStatusEntryId: string | null
    paymentStatus: string | null
    customerEntityId: string | null
    customerContactId: string | null
    customerSnapshot: Record<string, unknown> | null
    billingAddressId: string | null
    shippingAddressId: string | null
    billingAddressSnapshot: Record<string, unknown> | null
    shippingAddressSnapshot: Record<string, unknown> | null
    currencyCode: string
    exchangeRate: string | null
    taxStrategyKey: string | null
    discountStrategyKey: string | null
    taxInfo: Record<string, unknown> | null
    shippingMethodId: string | null
    shippingMethodCode: string | null
    deliveryWindowId: string | null
    deliveryWindowCode: string | null
    paymentMethodId: string | null
    paymentMethodCode: string | null
    channelId: string | null
    placedAt: string | null
    expectedDeliveryAt: string | null
    dueAt: string | null
    comments: string | null
    internalNotes: string | null
    shippingMethodSnapshot: Record<string, unknown> | null
    deliveryWindowSnapshot: Record<string, unknown> | null
    paymentMethodSnapshot: Record<string, unknown> | null
    metadata: Record<string, unknown> | null
    customFieldSetId: string | null
    customFields: Record<string, unknown> | null
    subtotalNetAmount: string
    subtotalGrossAmount: string
    discountTotalAmount: string
    taxTotalAmount: string
    shippingNetAmount: string
    shippingGrossAmount: string
    surchargeTotalAmount: string
    grandTotalNetAmount: string
    grandTotalGrossAmount: string
    paidTotalAmount: string
    refundedTotalAmount: string
    outstandingAmount: string
    totalsSnapshot: Record<string, unknown> | null
    lineItemCount: number
  }
  lines: OrderLineSnapshot[]
  adjustments: OrderAdjustmentSnapshot[]
  addresses: DocumentAddressSnapshot[]
  notes: NoteSnapshot[]
  tags: TagAssignmentSnapshot[]
  shipments: ShipmentSnapshot[]
  payments: PaymentSnapshot[]
}

type OrderLineSnapshot = {
  id: string
  lineNumber: number
  kind: string
  statusEntryId: string | null
  status: string | null
  productId: string | null
  productVariantId: string | null
  catalogSnapshot: Record<string, unknown> | null
  name: string | null
  description: string | null
  comment: string | null
  quantity: string
  quantityUnit: string | null
  reservedQuantity: string
  fulfilledQuantity: string
  invoicedQuantity: string
  returnedQuantity: string
  currencyCode: string
  unitPriceNet: string
  unitPriceGross: string
  discountAmount: string
  discountPercent: string
  taxRate: string
  taxAmount: string
  totalNetAmount: string
  totalGrossAmount: string
  configuration: Record<string, unknown> | null
  promotionCode: string | null
  promotionSnapshot: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  customFieldSetId: string | null
  customFields: Record<string, unknown> | null
}

type OrderAdjustmentSnapshot = {
  id: string
  scope: 'order' | 'line'
  kind: string
  code: string | null
  label: string | null
  calculatorKey: string | null
  promotionId: string | null
  rate: string
  amountNet: string
  amountGross: string
  currencyCode: string | null
  metadata: Record<string, unknown> | null
  position: number
  orderLineId: string | null
  customFields: Record<string, unknown> | null
}

type OrderUndoPayload = {
  before?: OrderGraphSnapshot | null
  after?: OrderGraphSnapshot | null
}

type QuoteUndoPayload = {
  before?: QuoteGraphSnapshot | null
  after?: QuoteGraphSnapshot | null
}

type QuoteConvertUndoPayload = {
  quote?: QuoteGraphSnapshot | null
  order?: OrderGraphSnapshot | null
}

const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, { message: 'currency_code_invalid' })

const dateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' })
  .refine((value) => !Number.isNaN(new Date(value).getTime()), { message: 'invalid_date' })

const addressSnapshotSchema = z.record(z.string(), z.unknown()).nullable().optional()

export const documentUpdateSchema = z
  .object({
    id: z.string().uuid(),
    customerEntityId: z.string().uuid().nullable().optional(),
    customerContactId: z.string().uuid().nullable().optional(),
    customerSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    customerReference: z.string().nullable().optional(),
    externalReference: z.string().nullable().optional(),
    comment: z.string().nullable().optional(),
    orderNumber: z.string().trim().min(1).max(191).optional(),
    quoteNumber: z.string().trim().min(1).max(191).optional(),
    currencyCode: currencyCodeSchema.optional(),
    channelId: z.string().uuid().nullable().optional(),
    statusEntryId: z.string().uuid().nullable().optional(),
    placedAt: z.union([dateOnlySchema, z.null()]).optional(),
    expectedDeliveryAt: z.union([dateOnlySchema, z.null()]).optional(),
    shippingAddressId: z.string().uuid().nullable().optional(),
    billingAddressId: z.string().uuid().nullable().optional(),
    shippingAddressSnapshot: addressSnapshotSchema,
    billingAddressSnapshot: addressSnapshotSchema,
    shippingMethodId: z.string().uuid().nullable().optional(),
    shippingMethodCode: z.string().nullable().optional(),
    shippingMethodSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    paymentMethodId: z.string().uuid().nullable().optional(),
    paymentMethodCode: z.string().nullable().optional(),
    paymentMethodSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    tags: z.array(z.string().uuid()).optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
    customFieldSetId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (input) =>
      typeof input.currencyCode === 'string' ||
      input.placedAt !== undefined ||
      input.expectedDeliveryAt !== undefined ||
      input.channelId !== undefined ||
      input.statusEntryId !== undefined ||
      input.shippingAddressId !== undefined ||
      input.billingAddressId !== undefined ||
      input.customerEntityId !== undefined ||
      input.customerContactId !== undefined ||
      input.customerSnapshot !== undefined ||
      input.metadata !== undefined ||
      input.customerReference !== undefined ||
      input.externalReference !== undefined ||
      input.comment !== undefined ||
      input.orderNumber !== undefined ||
      input.quoteNumber !== undefined ||
      input.shippingAddressSnapshot !== undefined ||
      input.billingAddressSnapshot !== undefined ||
      input.shippingMethodId !== undefined ||
      input.shippingMethodCode !== undefined ||
      input.shippingMethodSnapshot !== undefined ||
      input.paymentMethodId !== undefined ||
      input.paymentMethodCode !== undefined ||
      input.paymentMethodSnapshot !== undefined ||
      input.tags !== undefined ||
      input.customFields !== undefined ||
      input.customFieldSetId !== undefined,
    { message: 'update_payload_empty' }
  )

export type DocumentUpdateInput = z.infer<typeof documentUpdateSchema>

type DocumentLineCreateInput = QuoteLineCreateInput | OrderLineCreateInput
type DocumentAdjustmentCreateInput = QuoteAdjustmentCreateInput | OrderAdjustmentCreateInput

function cloneJson<T>(value: T): T {
  if (value === null || value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

async function resolveCustomerSnapshot(
  em: EntityManager,
  organizationId: string,
  tenantId: string,
  customerEntityId?: string | null,
  customerContactId?: string | null
): Promise<Record<string, unknown> | null> {
  if (!customerEntityId) return null
  const customer = await em.findOne(
    CustomerEntity,
    { id: customerEntityId, organizationId, tenantId },
    { populate: ['personProfile', 'companyProfile'] }
  )
  if (!customer) return null

  const contact = customerContactId
    ? await em.findOne(CustomerPersonProfile, {
        id: customerContactId,
        organizationId,
        tenantId,
      })
    : null

  return {
    customer: {
      id: customer.id,
      kind: customer.kind,
      displayName: customer.displayName,
      primaryEmail: customer.primaryEmail ?? null,
      primaryPhone: customer.primaryPhone ?? null,
      personProfile: customer.personProfile
        ? {
            id: customer.personProfile.id,
            firstName: customer.personProfile.firstName ?? null,
            lastName: customer.personProfile.lastName ?? null,
            preferredName: customer.personProfile.preferredName ?? null,
          }
        : null,
      companyProfile: customer.companyProfile
        ? {
            id: customer.companyProfile.id,
            legalName: customer.companyProfile.legalName ?? null,
            brandName: customer.companyProfile.brandName ?? null,
            domain: customer.companyProfile.domain ?? null,
            websiteUrl: customer.companyProfile.websiteUrl ?? null,
          }
        : null,
    },
    contact: contact
      ? {
          id: contact.id,
          firstName: contact.firstName ?? null,
          lastName: contact.lastName ?? null,
          preferredName: contact.preferredName ?? null,
          jobTitle: contact.jobTitle ?? null,
          department: contact.department ?? null,
        }
      : null,
  }
}

async function resolveAddressSnapshot(
  em: EntityManager,
  organizationId: string,
  tenantId: string,
  addressId?: string | null
): Promise<Record<string, unknown> | null> {
  if (!addressId) return null
  const address = await em.findOne(CustomerAddress, {
    id: addressId,
    organizationId,
    tenantId,
  })
  if (!address) return null

  return {
    id: address.id,
    name: address.name ?? null,
    purpose: address.purpose ?? null,
    companyName: address.companyName ?? null,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2 ?? null,
    buildingNumber: address.buildingNumber ?? null,
    flatNumber: address.flatNumber ?? null,
    city: address.city ?? null,
    region: address.region ?? null,
    postalCode: address.postalCode ?? null,
    country: address.country ?? null,
    latitude: address.latitude ?? null,
    longitude: address.longitude ?? null,
    isPrimary: address.isPrimary,
  }
}

async function resolveDocumentReferences(
  em: EntityManager,
  parsed: {
    organizationId: string
    tenantId: string
    customerEntityId?: string | null
    customerContactId?: string | null
    customerSnapshot?: Record<string, unknown> | null
    billingAddressId?: string | null
    shippingAddressId?: string | null
    billingAddressSnapshot?: Record<string, unknown> | null
    shippingAddressSnapshot?: Record<string, unknown> | null
    shippingMethodId?: string | null
    deliveryWindowId?: string | null
    paymentMethodId?: string | null
  }
): Promise<{
  customerSnapshot: Record<string, unknown> | null
  billingAddressSnapshot: Record<string, unknown> | null
  shippingAddressSnapshot: Record<string, unknown> | null
  shippingMethod: SalesShippingMethod | null
  deliveryWindow: SalesDeliveryWindow | null
  paymentMethod: SalesPaymentMethod | null
}> {
  const [
    resolvedCustomerSnapshot,
    resolvedBillingSnapshot,
    resolvedShippingSnapshot,
    shippingMethod,
    deliveryWindow,
    paymentMethod,
  ] = await Promise.all([
    parsed.customerSnapshot
      ? Promise.resolve(cloneJson(parsed.customerSnapshot))
      : resolveCustomerSnapshot(
          em,
          parsed.organizationId,
          parsed.tenantId,
          parsed.customerEntityId ?? null,
          parsed.customerContactId ?? null
        ),
    parsed.billingAddressSnapshot
      ? Promise.resolve(cloneJson(parsed.billingAddressSnapshot))
      : resolveAddressSnapshot(
          em,
          parsed.organizationId,
          parsed.tenantId,
          parsed.billingAddressId ?? null
        ),
    parsed.shippingAddressSnapshot
      ? Promise.resolve(cloneJson(parsed.shippingAddressSnapshot))
      : resolveAddressSnapshot(
          em,
          parsed.organizationId,
          parsed.tenantId,
          parsed.shippingAddressId ?? null
        ),
    parsed.shippingMethodId
      ? em.findOne(SalesShippingMethod, {
          id: parsed.shippingMethodId,
          organizationId: parsed.organizationId,
          tenantId: parsed.tenantId,
        })
      : Promise.resolve(null),
    parsed.deliveryWindowId
      ? em.findOne(SalesDeliveryWindow, {
          id: parsed.deliveryWindowId,
          organizationId: parsed.organizationId,
          tenantId: parsed.tenantId,
        })
      : Promise.resolve(null),
    parsed.paymentMethodId
      ? em.findOne(SalesPaymentMethod, {
          id: parsed.paymentMethodId,
          organizationId: parsed.organizationId,
          tenantId: parsed.tenantId,
        })
      : Promise.resolve(null),
  ])

  return {
    customerSnapshot: resolvedCustomerSnapshot ? cloneJson(resolvedCustomerSnapshot) : null,
    billingAddressSnapshot: resolvedBillingSnapshot ? cloneJson(resolvedBillingSnapshot) : null,
    shippingAddressSnapshot: resolvedShippingSnapshot ? cloneJson(resolvedShippingSnapshot) : null,
    shippingMethod: shippingMethod ?? null,
    deliveryWindow: deliveryWindow ?? null,
    paymentMethod: paymentMethod ?? null,
  }
}

function normalizeStatusValue(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length ? trimmed : null
}

function resolveNoteAuthorFromAuth(auth: any): string | null {
  if (!auth || auth.isApiKey) return null
  const sub = typeof auth.sub === 'string' ? auth.sub.trim() : ''
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
  return uuidRegex.test(sub) ? sub : null
}

function resolveStatusChangeActor(auth: any, translate: any): string {
  const unknownLabel = translate('sales.orders.status_change.actor_unknown', 'unknown user')
  if (!auth) return unknownLabel
  if (auth.isApiKey) {
    const keyName = typeof auth.keyName === 'string' ? auth.keyName.trim() : ''
    const keyId = typeof auth.keyId === 'string' ? auth.keyId.trim() : ''
    const label = keyName || keyId || (typeof auth.sub === 'string' ? auth.sub : '')
    return label
      ? translate('sales.orders.status_change.actor_api_key', 'API key {name}', { name: label })
      : unknownLabel
  }
  const email = typeof auth.email === 'string' ? auth.email.trim() : ''
  if (email) return email
  const sub = typeof auth.sub === 'string' ? auth.sub.trim() : ''
  if (sub) return sub
  return unknownLabel
}

function formatStatusLabel(status: string | null, translate: any): string {
  if (status && status.trim().length) return status.trim()
  return translate('sales.orders.status_change.empty', 'unset')
}

async function appendOrderStatusChangeNote({
  em,
  order,
  previousStatus,
  auth,
}: {
  em: EntityManager
  order: SalesOrder
  previousStatus: string | null
  auth: any
}): Promise<SalesNote | null> {
  const nextStatus = normalizeStatusValue(order.status)
  if (previousStatus === nextStatus) return null
  const { translate } = await resolveTranslations()
  const body = translate(
    'sales.orders.status_change.note',
    'Status changed from {from} to {to} by {actor}.',
    {
      from: formatStatusLabel(previousStatus, translate),
      to: formatStatusLabel(nextStatus, translate),
      actor: resolveStatusChangeActor(auth, translate),
    }
  )
  const note = em.create(SalesNote, {
    organizationId: order.organizationId,
    tenantId: order.tenantId,
    contextType: 'order',
    contextId: order.id,
    order,
    authorUserId: resolveNoteAuthorFromAuth(auth),
    appearanceIcon: null,
    appearanceColor: null,
    body,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  em.persist(note)
  return note
}

async function applyDocumentUpdate({
  kind,
  entity,
  input,
  em,
}: {
  kind: 'order' | 'quote'
  entity: SalesOrder | SalesQuote
  input: DocumentUpdateInput
  em: EntityManager
}): Promise<void> {
  const organizationId = (entity as any).organizationId as string
  const tenantId = (entity as any).tenantId as string
  const status = typeof (entity as any).status === 'string' ? (entity as any).status : null
  const { translate } = await resolveTranslations()

  const wantsCustomerChange =
    input.customerEntityId !== undefined ||
    input.customerContactId !== undefined ||
    input.customerSnapshot !== undefined ||
    input.metadata !== undefined
  const wantsAddressChange =
    input.shippingAddressId !== undefined ||
    input.billingAddressId !== undefined ||
    input.shippingAddressSnapshot !== undefined ||
    input.billingAddressSnapshot !== undefined

  let settings: SalesSettings | null = null
  if (kind === 'order' && (wantsCustomerChange || wantsAddressChange)) {
    settings = await loadSalesSettings(em, { organizationId, tenantId })
  }

  const guardStatus = (allowed: string[] | null | undefined, errorKey: string, fallback: string) => {
    if (!Array.isArray(allowed)) return
    if (allowed.length === 0) {
      throw new CrudHttpError(400, { error: translate(errorKey, fallback) })
    }
    if (!status || !allowed.includes(status)) {
      throw new CrudHttpError(400, { error: translate(errorKey, fallback) })
    }
  }

  if (kind === 'order' && wantsCustomerChange) {
    guardStatus(
      settings?.orderCustomerEditableStatuses ?? null,
      'sales.orders.edit_customer_blocked',
      'Editing the customer is blocked for this status.'
    )
  }
  if (kind === 'order' && wantsAddressChange) {
    guardStatus(
      settings?.orderAddressEditableStatuses ?? null,
      'sales.orders.edit_addresses_blocked',
      'Editing addresses is blocked for this status.'
    )
  }

  if (kind === 'order' && typeof input.orderNumber === 'string') {
    (entity as SalesOrder).orderNumber = input.orderNumber
  }
  if (kind === 'quote' && typeof input.quoteNumber === 'string') {
    (entity as SalesQuote).quoteNumber = input.quoteNumber
  }

  if (input.customerEntityId !== undefined) {
    entity.customerEntityId = input.customerEntityId ?? null
    entity.customerSnapshot = await resolveCustomerSnapshot(
      em,
      organizationId,
      tenantId,
      input.customerEntityId,
      input.customerContactId ?? entity.customerContactId ?? null
    )
    entity.customerContactId = input.customerContactId ?? null
    entity.billingAddressId = null
    entity.shippingAddressId = null
    entity.billingAddressSnapshot = null
    entity.shippingAddressSnapshot = null
  }
  if (input.customerContactId !== undefined) {
    entity.customerContactId = input.customerContactId ?? null
    if (entity.customerEntityId) {
      entity.customerSnapshot = await resolveCustomerSnapshot(
        em,
        organizationId,
        tenantId,
        entity.customerEntityId,
        input.customerContactId
      )
    }
  }
  if (input.customerSnapshot !== undefined) {
    entity.customerSnapshot = input.customerSnapshot ?? null
  }
  if (input.metadata !== undefined) {
    entity.metadata = input.metadata ?? null
  }
  if (input.externalReference !== undefined) {
    const normalized = typeof input.externalReference === 'string' ? input.externalReference.trim() : ''
    entity.externalReference = normalized.length ? normalized : null
  }
  if (input.customerReference !== undefined) {
    const normalized = typeof input.customerReference === 'string' ? input.customerReference.trim() : ''
    entity.customerReference = normalized.length ? normalized : null
  }
  if (input.comment !== undefined) {
    const normalized = typeof input.comment === 'string' ? input.comment.trim() : ''
    entity.comments = normalized.length ? normalized : null
  }
  if (typeof input.currencyCode === 'string') {
    entity.currencyCode = input.currencyCode
  }
  if (input.channelId !== undefined) {
    if (input.channelId === null) {
      entity.channelId = null
    } else {
      const channel = await em.findOne(SalesChannel, {
        id: input.channelId,
        organizationId,
        tenantId,
        deletedAt: null,
      })
      if (!channel) {
        throw new CrudHttpError(400, { error: translate('sales.documents.detail.channelInvalid', 'Selected channel could not be found.') })
      }
      entity.channelId = channel.id
    }
  }
  if (input.statusEntryId !== undefined) {
    const statusValue = await resolveDictionaryEntryValue(em, input.statusEntryId)
    if (input.statusEntryId && !statusValue) {
      throw new CrudHttpError(400, { error: translate('sales.documents.detail.statusInvalid', 'Selected status could not be found.') })
    }
    ;(entity as any).statusEntryId = input.statusEntryId ?? null
    ;(entity as any).status = statusValue
  }
  if (input.placedAt !== undefined) {
    if (input.placedAt === null) {
      entity.placedAt = null
    } else {
      const parsed = new Date(input.placedAt)
      entity.placedAt = Number.isNaN(parsed.getTime()) ? entity.placedAt : parsed
    }
  }
  if (input.expectedDeliveryAt !== undefined && 'expectedDeliveryAt' in entity) {
    if (input.expectedDeliveryAt === null) {
      (entity as SalesOrder).expectedDeliveryAt = null
    } else {
      const parsed = new Date(input.expectedDeliveryAt)
      ;(entity as SalesOrder).expectedDeliveryAt = Number.isNaN(parsed.getTime())
        ? (entity as SalesOrder).expectedDeliveryAt
        : parsed
    }
  }
  if (input.shippingAddressId !== undefined) {
    entity.shippingAddressId = input.shippingAddressId ?? null
    if (input.shippingAddressSnapshot === undefined) {
      entity.shippingAddressSnapshot = await resolveAddressSnapshot(em, organizationId, tenantId, input.shippingAddressId)
    }
  }
  if (input.billingAddressId !== undefined) {
    entity.billingAddressId = input.billingAddressId ?? null
    if (input.billingAddressSnapshot === undefined) {
      entity.billingAddressSnapshot = await resolveAddressSnapshot(em, organizationId, tenantId, input.billingAddressId)
    }
  }
  if (input.shippingAddressSnapshot !== undefined) {
    entity.shippingAddressSnapshot = input.shippingAddressSnapshot ?? null
  }
  if (input.billingAddressSnapshot !== undefined) {
    entity.billingAddressSnapshot = input.billingAddressSnapshot ?? null
  }
  if (input.shippingMethodId !== undefined || input.shippingMethodSnapshot !== undefined || input.shippingMethodCode !== undefined) {
    let shippingMethod: SalesShippingMethod | null = null
    if (input.shippingMethodId) {
      shippingMethod = await em.findOne(SalesShippingMethod, {
        id: input.shippingMethodId,
        organizationId,
        tenantId,
        deletedAt: null,
      })
      if (!shippingMethod) {
        throw new CrudHttpError(400, { error: translate('sales.documents.detail.shippingMethodInvalid', 'Selected shipping method could not be found.') })
      }
    }
    ;(entity as any).shippingMethodId = input.shippingMethodId ?? null
    ;(entity as any).shippingMethod = shippingMethod ?? null
    ;(entity as any).shippingMethodCode = input.shippingMethodCode ?? shippingMethod?.code ?? null
    if (input.shippingMethodSnapshot !== undefined) {
      ;(entity as any).shippingMethodSnapshot = input.shippingMethodSnapshot ?? null
    } else {
      ;(entity as any).shippingMethodSnapshot = shippingMethod
        ? {
            id: shippingMethod.id,
            code: shippingMethod.code,
            name: shippingMethod.name,
            description: shippingMethod.description ?? null,
            carrierCode: shippingMethod.carrierCode ?? null,
            providerKey: shippingMethod.providerKey ?? null,
            serviceLevel: shippingMethod.serviceLevel ?? null,
            estimatedTransitDays: shippingMethod.estimatedTransitDays ?? null,
            baseRateNet: shippingMethod.baseRateNet,
            baseRateGross: shippingMethod.baseRateGross,
            currencyCode: shippingMethod.currencyCode ?? null,
            metadata: shippingMethod.metadata ? cloneJson(shippingMethod.metadata) : null,
            providerSettings:
              shippingMethod.metadata && typeof shippingMethod.metadata === 'object'
                ? cloneJson(
                    (shippingMethod.metadata as Record<string, unknown>).providerSettings ??
                      null
                  )
                : null,
          }
        : null
    }
  }
  if (input.paymentMethodId !== undefined || input.paymentMethodSnapshot !== undefined || input.paymentMethodCode !== undefined) {
    let paymentMethod: SalesPaymentMethod | null = null
    if (input.paymentMethodId) {
      paymentMethod = await em.findOne(SalesPaymentMethod, {
        id: input.paymentMethodId,
        organizationId,
        tenantId,
        deletedAt: null,
      })
      if (!paymentMethod) {
        throw new CrudHttpError(400, { error: translate('sales.documents.detail.paymentMethodInvalid', 'Selected payment method could not be found.') })
      }
    }
    ;(entity as any).paymentMethodId = input.paymentMethodId ?? null
    ;(entity as any).paymentMethod = paymentMethod ?? null
    ;(entity as any).paymentMethodCode = input.paymentMethodCode ?? paymentMethod?.code ?? null
    if (input.paymentMethodSnapshot !== undefined) {
      ;(entity as any).paymentMethodSnapshot = input.paymentMethodSnapshot ?? null
    } else {
      ;(entity as any).paymentMethodSnapshot = paymentMethod
        ? {
            id: paymentMethod.id,
            code: paymentMethod.code,
            name: paymentMethod.name,
            description: paymentMethod.description ?? null,
            providerKey: paymentMethod.providerKey ?? null,
            terms: paymentMethod.terms ?? null,
            metadata: paymentMethod.metadata ? cloneJson(paymentMethod.metadata) : null,
            providerSettings:
              paymentMethod.metadata && typeof paymentMethod.metadata === 'object'
                ? cloneJson(
                    (paymentMethod.metadata as Record<string, unknown>).providerSettings ??
                      null
                  )
                : null,
          }
        : null
    }
  }

  if (input.tags !== undefined) {
    await syncSalesDocumentTags(em, {
      documentId: entity.id,
      kind,
      organizationId,
      tenantId,
      tagIds: input.tags,
    })
  }

  if (input.customFieldSetId !== undefined) {
    ;(entity as any).customFieldSetId = input.customFieldSetId ?? null
  }

  if (input.customFields !== undefined) {
    const values =
      input.customFields && typeof input.customFields === 'object' && !Array.isArray(input.customFields)
        ? (input.customFields as Record<string, unknown>)
        : {}
    await setRecordCustomFields(em, {
      entityId: kind === 'order' ? E.sales.sales_order : E.sales.sales_quote,
      recordId: entity.id,
      organizationId,
      tenantId,
      values,
    })
  }
}

async function loadQuoteSnapshot(em: EntityManager, id: string): Promise<QuoteGraphSnapshot | null> {
  const quote = await em.findOne(SalesQuote, { id, deletedAt: null })
  if (!quote) return null
  const lines = await em.find(SalesQuoteLine, { quote: quote }, { orderBy: { lineNumber: 'asc' } })
  const adjustments = await em.find(SalesQuoteAdjustment, { quote: quote }, { orderBy: { position: 'asc' } })
  const [addresses, notes, tags, quoteCustomFields, lineCustomFields, adjustmentCustomFields] = await Promise.all([
    em.find(SalesDocumentAddress, { documentId: id, documentKind: 'quote' }),
    em.find(SalesNote, { contextType: 'quote', contextId: id }),
    findWithDecryption(
      em,
      SalesDocumentTagAssignment,
      { documentId: id, documentKind: 'quote' },
      { populate: ['tag'] },
      { tenantId: quote.tenantId, organizationId: quote.organizationId },
    ),
    loadCustomFieldValues({
      em,
      entityId: E.sales.sales_quote,
      recordIds: [quote.id],
      tenantIdByRecord: { [quote.id]: quote.tenantId },
      organizationIdByRecord: { [quote.id]: quote.organizationId },
    }),
    lines.length
      ? loadCustomFieldValues({
          em,
          entityId: E.sales.sales_quote_line,
          recordIds: lines.map((line) => line.id),
          tenantIdByRecord: Object.fromEntries(lines.map((line) => [line.id, quote.tenantId])),
          organizationIdByRecord: Object.fromEntries(lines.map((line) => [line.id, quote.organizationId])),
        })
      : Promise.resolve({}),
    adjustments.length
      ? loadCustomFieldValues({
          em,
          entityId: E.sales.sales_quote_adjustment,
          recordIds: adjustments.map((adj) => adj.id),
          tenantIdByRecord: Object.fromEntries(adjustments.map((adj) => [adj.id, quote.tenantId])),
          organizationIdByRecord: Object.fromEntries(adjustments.map((adj) => [adj.id, quote.organizationId])),
        })
      : Promise.resolve({}),
  ])
  const addressSnapshots: DocumentAddressSnapshot[] = addresses.map((entry) => ({
    id: entry.id,
    organizationId: entry.organizationId,
    tenantId: entry.tenantId,
    documentId: entry.documentId,
    documentKind: 'quote',
    customerAddressId: entry.customerAddressId ?? null,
    name: entry.name ?? null,
    purpose: entry.purpose ?? null,
    companyName: entry.companyName ?? null,
    addressLine1: entry.addressLine1,
    addressLine2: entry.addressLine2 ?? null,
    city: entry.city ?? null,
    region: entry.region ?? null,
    postalCode: entry.postalCode ?? null,
    country: entry.country ?? null,
    buildingNumber: entry.buildingNumber ?? null,
    flatNumber: entry.flatNumber ?? null,
    latitude: entry.latitude ?? null,
    longitude: entry.longitude ?? null,
  }))
  const noteSnapshots: NoteSnapshot[] = notes.map((entry) => ({
    id: entry.id,
    organizationId: entry.organizationId,
    tenantId: entry.tenantId,
    contextType: entry.contextType as 'order' | 'quote',
    contextId: entry.contextId,
    orderId: entry.order ? (typeof entry.order === 'string' ? entry.order : entry.order.id) : null,
    quoteId: entry.quote ? (typeof entry.quote === 'string' ? entry.quote : entry.quote.id) : null,
    body: entry.body,
    authorUserId: entry.authorUserId ?? null,
    appearanceIcon: entry.appearanceIcon ?? null,
    appearanceColor: entry.appearanceColor ?? null,
  }))
  const tagSnapshots: TagAssignmentSnapshot[] = tags
    .map((assignment) => {
      const tagId =
        typeof assignment.tag === 'string'
          ? assignment.tag
          : assignment.tag?.id ?? (assignment as any)?.tag_id ?? null
      if (!tagId) return null
      return {
        id: assignment.id,
        tagId,
        organizationId: assignment.organizationId,
        tenantId: assignment.tenantId,
        documentId: assignment.documentId,
        documentKind: 'quote',
      }
    })
    .filter((entry): entry is TagAssignmentSnapshot => !!entry)

  return {
    quote: {
      id: quote.id,
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      quoteNumber: quote.quoteNumber,
      statusEntryId: quote.statusEntryId ?? null,
      status: quote.status ?? null,
      customerEntityId: quote.customerEntityId ?? null,
      customerContactId: quote.customerContactId ?? null,
      customerSnapshot: quote.customerSnapshot ? cloneJson(quote.customerSnapshot) : null,
      billingAddressId: quote.billingAddressId ?? null,
      shippingAddressId: quote.shippingAddressId ?? null,
      billingAddressSnapshot: quote.billingAddressSnapshot ? cloneJson(quote.billingAddressSnapshot) : null,
      shippingAddressSnapshot: quote.shippingAddressSnapshot ? cloneJson(quote.shippingAddressSnapshot) : null,
      currencyCode: quote.currencyCode,
      validFrom: quote.validFrom ? quote.validFrom.toISOString() : null,
      validUntil: quote.validUntil ? quote.validUntil.toISOString() : null,
      comments: quote.comments ?? null,
      taxInfo: quote.taxInfo ? cloneJson(quote.taxInfo) : null,
      shippingMethodId: quote.shippingMethodId ?? null,
      shippingMethodCode: quote.shippingMethodCode ?? null,
      deliveryWindowId: quote.deliveryWindowId ?? null,
      deliveryWindowCode: quote.deliveryWindowCode ?? null,
      paymentMethodId: quote.paymentMethodId ?? null,
      paymentMethodCode: quote.paymentMethodCode ?? null,
      channelId: quote.channelId ?? null,
      shippingMethodSnapshot: quote.shippingMethodSnapshot ? cloneJson(quote.shippingMethodSnapshot) : null,
      deliveryWindowSnapshot: quote.deliveryWindowSnapshot ? cloneJson(quote.deliveryWindowSnapshot) : null,
      paymentMethodSnapshot: quote.paymentMethodSnapshot ? cloneJson(quote.paymentMethodSnapshot) : null,
      metadata: quote.metadata ? cloneJson(quote.metadata) : null,
      customFieldSetId: quote.customFieldSetId ?? null,
      customFields: quoteCustomFields[quote.id] ? cloneJson(quoteCustomFields[quote.id]) : null,
      subtotalNetAmount: quote.subtotalNetAmount,
      subtotalGrossAmount: quote.subtotalGrossAmount,
      discountTotalAmount: quote.discountTotalAmount,
      taxTotalAmount: quote.taxTotalAmount,
      grandTotalNetAmount: quote.grandTotalNetAmount,
      grandTotalGrossAmount: quote.grandTotalGrossAmount,
      totalsSnapshot: quote.totalsSnapshot ? cloneJson(quote.totalsSnapshot) : null,
      lineItemCount: quote.lineItemCount,
    },
    lines: lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      kind: line.kind,
      statusEntryId: line.statusEntryId ?? null,
      status: line.status ?? null,
      productId: line.productId ?? null,
      productVariantId: line.productVariantId ?? null,
      catalogSnapshot: line.catalogSnapshot ? cloneJson(line.catalogSnapshot) : null,
      name: line.name ?? null,
      description: line.description ?? null,
      comment: line.comment ?? null,
      quantity: line.quantity,
      quantityUnit: line.quantityUnit ?? null,
      currencyCode: line.currencyCode,
      unitPriceNet: line.unitPriceNet,
      unitPriceGross: line.unitPriceGross,
      discountAmount: line.discountAmount,
      discountPercent: line.discountPercent,
      taxRate: line.taxRate,
      taxAmount: line.taxAmount,
      totalNetAmount: line.totalNetAmount,
      totalGrossAmount: line.totalGrossAmount,
      configuration: line.configuration ? cloneJson(line.configuration) : null,
      promotionCode: line.promotionCode ?? null,
      promotionSnapshot: line.promotionSnapshot ? cloneJson(line.promotionSnapshot) : null,
      metadata: line.metadata ? cloneJson(line.metadata) : null,
      customFieldSetId: line.customFieldSetId ?? null,
      customFields: lineCustomFields[line.id] ? cloneJson(lineCustomFields[line.id]) : null,
    })),
    adjustments: adjustments.map((adj) => ({
      id: adj.id,
      scope: adj.scope,
      kind: adj.kind,
      code: adj.code ?? null,
      label: adj.label ?? null,
      calculatorKey: adj.calculatorKey ?? null,
      promotionId: adj.promotionId ?? null,
      rate: adj.rate,
      amountNet: adj.amountNet,
      amountGross: adj.amountGross,
      currencyCode: adj.currencyCode ?? null,
      metadata: adj.metadata ? cloneJson(adj.metadata) : null,
      position: adj.position,
      quoteLineId: typeof adj.quoteLine === 'string' ? adj.quoteLine : adj.quoteLine?.id ?? null,
      customFields: adjustmentCustomFields[adj.id] ? cloneJson(adjustmentCustomFields[adj.id]) : null,
    })),
    addresses: addressSnapshots,
    notes: noteSnapshots,
    tags: tagSnapshots,
  }
}

async function loadOrderSnapshot(em: EntityManager, id: string): Promise<OrderGraphSnapshot | null> {
  const order = await em.findOne(SalesOrder, { id, deletedAt: null })
  if (!order) return null
  const lines = await em.find(SalesOrderLine, { order: order }, { orderBy: { lineNumber: 'asc' } })
  const adjustments = await em.find(SalesOrderAdjustment, { order: order }, { orderBy: { position: 'asc' } })
  const [addresses, notes, tags, shipments, payments, orderCustomFields, lineCustomFields, adjustmentCustomFields] = await Promise.all([
    em.find(SalesDocumentAddress, { documentId: id, documentKind: 'order' }),
    em.find(SalesNote, { contextType: 'order', contextId: id }),
    findWithDecryption(
      em,
      SalesDocumentTagAssignment,
      { documentId: id, documentKind: 'order' },
      { populate: ['tag'] },
      { tenantId: order.tenantId, organizationId: order.organizationId },
    ),
    em.find(SalesShipment, { order: order }),
    em.find(SalesPayment, { order: order }),
    loadCustomFieldValues({
      em,
      entityId: E.sales.sales_order,
      recordIds: [order.id],
      tenantIdByRecord: { [order.id]: order.tenantId },
      organizationIdByRecord: { [order.id]: order.organizationId },
    }),
    lines.length
      ? loadCustomFieldValues({
          em,
          entityId: E.sales.sales_order_line,
          recordIds: lines.map((line) => line.id),
          tenantIdByRecord: Object.fromEntries(lines.map((line) => [line.id, order.tenantId])),
          organizationIdByRecord: Object.fromEntries(lines.map((line) => [line.id, order.organizationId])),
        })
      : Promise.resolve({}),
    adjustments.length
      ? loadCustomFieldValues({
          em,
          entityId: E.sales.sales_order_adjustment,
          recordIds: adjustments.map((adj) => adj.id),
          tenantIdByRecord: Object.fromEntries(adjustments.map((adj) => [adj.id, order.tenantId])),
          organizationIdByRecord: Object.fromEntries(adjustments.map((adj) => [adj.id, order.organizationId])),
        })
      : Promise.resolve({}),
  ])
  const shipmentSnapshots = (
    await Promise.all(shipments.map((entry) => loadShipmentSnapshot(em, entry.id)))
  ).filter((entry): entry is ShipmentSnapshot => !!entry)
  const paymentSnapshots = (
    await Promise.all(payments.map((entry) => loadPaymentSnapshot(em, entry.id)))
  ).filter((entry): entry is PaymentSnapshot => !!entry)
  const addressSnapshots: DocumentAddressSnapshot[] = addresses.map((entry) => ({
    id: entry.id,
    organizationId: entry.organizationId,
    tenantId: entry.tenantId,
    documentId: entry.documentId,
    documentKind: 'order',
    customerAddressId: entry.customerAddressId ?? null,
    name: entry.name ?? null,
    purpose: entry.purpose ?? null,
    companyName: entry.companyName ?? null,
    addressLine1: entry.addressLine1,
    addressLine2: entry.addressLine2 ?? null,
    city: entry.city ?? null,
    region: entry.region ?? null,
    postalCode: entry.postalCode ?? null,
    country: entry.country ?? null,
    buildingNumber: entry.buildingNumber ?? null,
    flatNumber: entry.flatNumber ?? null,
    latitude: entry.latitude ?? null,
    longitude: entry.longitude ?? null,
  }))
  const noteSnapshots: NoteSnapshot[] = notes.map((entry) => ({
    id: entry.id,
    organizationId: entry.organizationId,
    tenantId: entry.tenantId,
    contextType: entry.contextType as 'order' | 'quote',
    contextId: entry.contextId,
    orderId: entry.order ? (typeof entry.order === 'string' ? entry.order : entry.order.id) : null,
    quoteId: entry.quote ? (typeof entry.quote === 'string' ? entry.quote : entry.quote.id) : null,
    body: entry.body,
    authorUserId: entry.authorUserId ?? null,
    appearanceIcon: entry.appearanceIcon ?? null,
    appearanceColor: entry.appearanceColor ?? null,
  }))
  const tagSnapshots: TagAssignmentSnapshot[] = tags
    .map((assignment) => {
      const tagId =
        typeof assignment.tag === 'string'
          ? assignment.tag
          : assignment.tag?.id ?? (assignment as any)?.tag_id ?? null
      if (!tagId) return null
      return {
        id: assignment.id,
        tagId,
        organizationId: assignment.organizationId,
        tenantId: assignment.tenantId,
        documentId: assignment.documentId,
        documentKind: 'order',
      }
    })
    .filter((entry): entry is TagAssignmentSnapshot => !!entry)

  return {
    order: {
      id: order.id,
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      orderNumber: order.orderNumber,
      statusEntryId: order.statusEntryId ?? null,
      status: order.status ?? null,
      fulfillmentStatusEntryId: order.fulfillmentStatusEntryId ?? null,
      fulfillmentStatus: order.fulfillmentStatus ?? null,
      paymentStatusEntryId: order.paymentStatusEntryId ?? null,
      paymentStatus: order.paymentStatus ?? null,
      customerEntityId: order.customerEntityId ?? null,
      customerContactId: order.customerContactId ?? null,
      customerSnapshot: order.customerSnapshot ? cloneJson(order.customerSnapshot) : null,
      billingAddressId: order.billingAddressId ?? null,
      shippingAddressId: order.shippingAddressId ?? null,
      billingAddressSnapshot: order.billingAddressSnapshot ? cloneJson(order.billingAddressSnapshot) : null,
      shippingAddressSnapshot: order.shippingAddressSnapshot ? cloneJson(order.shippingAddressSnapshot) : null,
      currencyCode: order.currencyCode,
      exchangeRate: order.exchangeRate ?? null,
      taxStrategyKey: order.taxStrategyKey ?? null,
      discountStrategyKey: order.discountStrategyKey ?? null,
      taxInfo: order.taxInfo ? cloneJson(order.taxInfo) : null,
      shippingMethodId: order.shippingMethodId ?? null,
      shippingMethodCode: order.shippingMethodCode ?? null,
      deliveryWindowId: order.deliveryWindowId ?? null,
      deliveryWindowCode: order.deliveryWindowCode ?? null,
      paymentMethodId: order.paymentMethodId ?? null,
      paymentMethodCode: order.paymentMethodCode ?? null,
      channelId: order.channelId ?? null,
      placedAt: order.placedAt ? order.placedAt.toISOString() : null,
      expectedDeliveryAt: order.expectedDeliveryAt ? order.expectedDeliveryAt.toISOString() : null,
      dueAt: order.dueAt ? order.dueAt.toISOString() : null,
      comments: order.comments ?? null,
      internalNotes: order.internalNotes ?? null,
      shippingMethodSnapshot: order.shippingMethodSnapshot ? cloneJson(order.shippingMethodSnapshot) : null,
      deliveryWindowSnapshot: order.deliveryWindowSnapshot ? cloneJson(order.deliveryWindowSnapshot) : null,
      paymentMethodSnapshot: order.paymentMethodSnapshot ? cloneJson(order.paymentMethodSnapshot) : null,
      metadata: order.metadata ? cloneJson(order.metadata) : null,
      customFieldSetId: order.customFieldSetId ?? null,
      customFields: orderCustomFields[order.id] ? cloneJson(orderCustomFields[order.id]) : null,
      subtotalNetAmount: order.subtotalNetAmount,
      subtotalGrossAmount: order.subtotalGrossAmount,
      discountTotalAmount: order.discountTotalAmount,
      taxTotalAmount: order.taxTotalAmount,
      shippingNetAmount: order.shippingNetAmount,
      shippingGrossAmount: order.shippingGrossAmount,
      surchargeTotalAmount: order.surchargeTotalAmount,
      grandTotalNetAmount: order.grandTotalNetAmount,
      grandTotalGrossAmount: order.grandTotalGrossAmount,
      paidTotalAmount: order.paidTotalAmount,
      refundedTotalAmount: order.refundedTotalAmount,
      outstandingAmount: order.outstandingAmount,
      totalsSnapshot: order.totalsSnapshot ? cloneJson(order.totalsSnapshot) : null,
      lineItemCount: order.lineItemCount,
    },
    lines: lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      kind: line.kind,
      statusEntryId: line.statusEntryId ?? null,
      status: line.status ?? null,
      productId: line.productId ?? null,
      productVariantId: line.productVariantId ?? null,
      catalogSnapshot: line.catalogSnapshot ? cloneJson(line.catalogSnapshot) : null,
      name: line.name ?? null,
      description: line.description ?? null,
      comment: line.comment ?? null,
      quantity: line.quantity,
      quantityUnit: line.quantityUnit ?? null,
      reservedQuantity: line.reservedQuantity,
      fulfilledQuantity: line.fulfilledQuantity,
      invoicedQuantity: line.invoicedQuantity,
      returnedQuantity: line.returnedQuantity,
      currencyCode: line.currencyCode,
      unitPriceNet: line.unitPriceNet,
      unitPriceGross: line.unitPriceGross,
      discountAmount: line.discountAmount,
      discountPercent: line.discountPercent,
      taxRate: line.taxRate,
      taxAmount: line.taxAmount,
      totalNetAmount: line.totalNetAmount,
      totalGrossAmount: line.totalGrossAmount,
      configuration: line.configuration ? cloneJson(line.configuration) : null,
      promotionCode: line.promotionCode ?? null,
      promotionSnapshot: line.promotionSnapshot ? cloneJson(line.promotionSnapshot) : null,
      metadata: line.metadata ? cloneJson(line.metadata) : null,
      customFieldSetId: line.customFieldSetId ?? null,
      customFields: lineCustomFields[line.id] ? cloneJson(lineCustomFields[line.id]) : null,
    })),
    adjustments: adjustments.map((adj) => ({
      id: adj.id,
      scope: adj.scope,
      kind: adj.kind,
      code: adj.code ?? null,
      label: adj.label ?? null,
      calculatorKey: adj.calculatorKey ?? null,
      promotionId: adj.promotionId ?? null,
      rate: adj.rate,
      amountNet: adj.amountNet,
      amountGross: adj.amountGross,
      currencyCode: adj.currencyCode ?? null,
      metadata: adj.metadata ? cloneJson(adj.metadata) : null,
      position: adj.position,
      orderLineId: typeof adj.orderLine === 'string' ? adj.orderLine : adj.orderLine?.id ?? null,
      customFields: adjustmentCustomFields[adj.id] ? cloneJson(adjustmentCustomFields[adj.id]) : null,
    })),
    addresses: addressSnapshots,
    notes: noteSnapshots,
    tags: tagSnapshots,
    shipments: shipmentSnapshots,
    payments: paymentSnapshots,
  }
}

type DeletableEntity = { id?: string; organizationId?: string | null; tenantId?: string | null }

async function queueDeletionSideEffects(
  dataEngine: DataEngine,
  entities: DeletableEntity[] | DeletableEntity | null | undefined,
  entityType: string
): Promise<void> {
  if (!entities) return
  const list = Array.isArray(entities) ? entities : [entities]
  const tasks: Array<Promise<void>> = []
  for (const entity of list) {
    if (!entity) continue
    const id = typeof entity.id === 'string' ? entity.id : null
    if (!id) continue
    tasks.push(
      emitCrudSideEffects({
        dataEngine,
        action: 'deleted',
        entity,
        identifiers: {
          id,
          organizationId: entity.organizationId ?? null,
          tenantId: entity.tenantId ?? null,
        },
        indexer: { entityType },
      })
    )
  }
  if (tasks.length) await Promise.all(tasks)
}

function toNumeric(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

function normalizeShippingMethodContext(
  snapshot: Record<string, unknown> | null | undefined,
  id?: string | null,
  code?: string | null,
  currencyCode?: string
): ShippingMethodContext | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const metadata = (snapshot as Record<string, unknown>).metadata
  const providerSettings =
    (snapshot as Record<string, unknown>).providerSettings ??
    (metadata && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>).providerSettings ?? null
      : null)
  return {
    id: (snapshot as Record<string, unknown>).id as string | undefined ?? id ?? null,
    code:
      typeof (snapshot as Record<string, unknown>).code === 'string'
        ? ((snapshot as Record<string, unknown>).code as string)
        : code ?? null,
    name:
      typeof (snapshot as Record<string, unknown>).name === 'string'
        ? ((snapshot as Record<string, unknown>).name as string)
        : null,
    providerKey:
      typeof (snapshot as Record<string, unknown>).providerKey === 'string'
        ? ((snapshot as Record<string, unknown>).providerKey as string)
        : null,
    currencyCode:
      typeof (snapshot as Record<string, unknown>).currencyCode === 'string'
        ? ((snapshot as Record<string, unknown>).currencyCode as string)
        : currencyCode ?? null,
    baseRateNet: toNumeric(
      ((snapshot as Record<string, unknown>).baseRateNet ??
        (snapshot as Record<string, unknown>).base_rate_net) as string | number | null
    ),
    baseRateGross: toNumeric(
      ((snapshot as Record<string, unknown>).baseRateGross ??
        (snapshot as Record<string, unknown>).base_rate_gross) as string | number | null
    ),
    metadata:
      metadata && typeof metadata === 'object' ? cloneJson(metadata as Record<string, unknown>) : null,
    providerSettings:
      providerSettings && typeof providerSettings === 'object'
        ? cloneJson(providerSettings as Record<string, unknown>)
        : null,
  }
}

function normalizePaymentMethodContext(
  snapshot: Record<string, unknown> | null | undefined,
  id?: string | null,
  code?: string | null
): PaymentMethodContext | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const metadata = (snapshot as Record<string, unknown>).metadata
  const providerSettings =
    (snapshot as Record<string, unknown>).providerSettings ??
    (metadata && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>).providerSettings ?? null
      : null)
  return {
    id: (snapshot as Record<string, unknown>).id as string | undefined ?? id ?? null,
    code:
      typeof (snapshot as Record<string, unknown>).code === 'string'
        ? ((snapshot as Record<string, unknown>).code as string)
        : code ?? null,
    name:
      typeof (snapshot as Record<string, unknown>).name === 'string'
        ? ((snapshot as Record<string, unknown>).name as string)
        : null,
    providerKey:
      typeof (snapshot as Record<string, unknown>).providerKey === 'string'
        ? ((snapshot as Record<string, unknown>).providerKey as string)
        : null,
    terms:
      typeof (snapshot as Record<string, unknown>).terms === 'string'
        ? ((snapshot as Record<string, unknown>).terms as string)
        : null,
    metadata:
      metadata && typeof metadata === 'object' ? cloneJson(metadata as Record<string, unknown>) : null,
    providerSettings:
      providerSettings && typeof providerSettings === 'object'
        ? cloneJson(providerSettings as Record<string, unknown>)
        : null,
  }
}

function buildProviderContext(params: {
  shippingSnapshot?: Record<string, unknown> | null
  paymentSnapshot?: Record<string, unknown> | null
  shippingMethodId?: string | null
  paymentMethodId?: string | null
  shippingMethodCode?: string | null
  paymentMethodCode?: string | null
  currencyCode: string
}) {
  return {
    shippingMethod: normalizeShippingMethodContext(
      params.shippingSnapshot,
      params.shippingMethodId,
      params.shippingMethodCode,
      params.currencyCode
    ),
    paymentMethod: normalizePaymentMethodContext(
      params.paymentSnapshot,
      params.paymentMethodId,
      params.paymentMethodCode
    ),
  }
}

function buildCalculationContext(params: {
  tenantId: string
  organizationId: string
  currencyCode: string
  shippingSnapshot?: Record<string, unknown> | null
  paymentSnapshot?: Record<string, unknown> | null
  shippingMethodId?: string | null
  paymentMethodId?: string | null
  shippingMethodCode?: string | null
  paymentMethodCode?: string | null
}) {
  return {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    currencyCode: params.currencyCode,
    metadata: buildProviderContext({
      shippingSnapshot: params.shippingSnapshot,
      paymentSnapshot: params.paymentSnapshot,
      shippingMethodId: params.shippingMethodId,
      paymentMethodId: params.paymentMethodId,
      shippingMethodCode: params.shippingMethodCode,
      paymentMethodCode: params.paymentMethodCode,
      currencyCode: params.currencyCode,
    }),
  }
}


function mapOrderLineEntityToSnapshot(line: SalesOrderLine): SalesLineSnapshot {
  return {
    id: line.id,
    lineNumber: line.lineNumber,
    kind: line.kind,
    productId: line.productId ?? null,
    productVariantId: line.productVariantId ?? null,
    name: line.name ?? null,
    description: line.description ?? null,
    comment: line.comment ?? null,
    quantity: toNumeric(line.quantity),
    quantityUnit: line.quantityUnit ?? null,
    currencyCode: line.currencyCode,
    unitPriceNet: toNumeric(line.unitPriceNet),
    unitPriceGross: toNumeric(line.unitPriceGross),
    discountAmount: toNumeric(line.discountAmount),
    discountPercent: toNumeric(line.discountPercent),
    taxRate: toNumeric(line.taxRate),
    taxAmount: toNumeric(line.taxAmount),
    totalNetAmount: toNumeric(line.totalNetAmount),
    totalGrossAmount: toNumeric(line.totalGrossAmount),
    configuration: line.configuration ? cloneJson(line.configuration) : null,
    promotionCode: line.promotionCode ?? null,
    metadata: line.metadata ? cloneJson(line.metadata) : null,
    customFieldSetId: line.customFieldSetId ?? null,
  }
}

function mapQuoteLineEntityToSnapshot(line: SalesQuoteLine): SalesLineSnapshot {
  return {
    id: line.id,
    lineNumber: line.lineNumber,
    kind: line.kind,
    productId: line.productId ?? null,
    productVariantId: line.productVariantId ?? null,
    name: line.name ?? null,
    description: line.description ?? null,
    comment: line.comment ?? null,
    quantity: toNumeric(line.quantity),
    quantityUnit: line.quantityUnit ?? null,
    currencyCode: line.currencyCode,
    unitPriceNet: toNumeric(line.unitPriceNet),
    unitPriceGross: toNumeric(line.unitPriceGross),
    discountAmount: toNumeric(line.discountAmount),
    discountPercent: toNumeric(line.discountPercent),
    taxRate: toNumeric(line.taxRate),
    taxAmount: toNumeric(line.taxAmount),
    totalNetAmount: toNumeric(line.totalNetAmount),
    totalGrossAmount: toNumeric(line.totalGrossAmount),
    configuration: line.configuration ? cloneJson(line.configuration) : null,
    promotionCode: line.promotionCode ?? null,
    metadata: line.metadata ? cloneJson(line.metadata) : null,
    customFieldSetId: line.customFieldSetId ?? null,
  }
}

function mapOrderAdjustmentToDraft(adjustment: SalesOrderAdjustment): SalesAdjustmentDraft {
  return {
    id: adjustment.id,
    scope: adjustment.scope ?? 'order',
    kind: adjustment.kind,
    code: adjustment.code ?? null,
    label: adjustment.label ?? null,
    calculatorKey: adjustment.calculatorKey ?? null,
    promotionId: adjustment.promotionId ?? null,
    rate: toNumeric(adjustment.rate),
    amountNet: toNumeric(adjustment.amountNet),
    amountGross: toNumeric(adjustment.amountGross),
    currencyCode: adjustment.currencyCode ?? null,
    metadata: adjustment.metadata ? cloneJson(adjustment.metadata) : null,
    position: adjustment.position ?? 0,
  }
}

function mapQuoteAdjustmentToDraft(adjustment: SalesQuoteAdjustment): SalesAdjustmentDraft {
  return {
    id: adjustment.id,
    scope: adjustment.scope ?? 'order',
    kind: adjustment.kind,
    code: adjustment.code ?? null,
    label: adjustment.label ?? null,
    calculatorKey: adjustment.calculatorKey ?? null,
    promotionId: adjustment.promotionId ?? null,
    rate: toNumeric(adjustment.rate),
    amountNet: toNumeric(adjustment.amountNet),
    amountGross: toNumeric(adjustment.amountGross),
    currencyCode: adjustment.currencyCode ?? null,
    metadata: adjustment.metadata ? cloneJson(adjustment.metadata) : null,
    position: adjustment.position ?? 0,
  }
}

async function emitTotalsCalculated(
  eventBus: EventBus | null | undefined,
  payload: {
    documentKind: SalesDocumentKind
    documentId: string
    organizationId: string
    tenantId: string
    customerId?: string | null
    totals: SalesDocumentCalculationResult['totals']
    lineCount: number
  }
): Promise<void> {
  if (!eventBus) return
  await eventBus.emitEvent('sales.document.totals.calculated', payload)
}

function createLineSnapshotFromInput(
  line: DocumentLineCreateInput,
  lineNumber: number
): SalesLineSnapshot {
  return {
    lineNumber,
    kind: line.kind ?? 'product',
    productId: line.productId ?? null,
    productVariantId: line.productVariantId ?? null,
    name: line.name ?? null,
    description: line.description ?? null,
    comment: line.comment ?? null,
    quantity: Number(line.quantity ?? 0),
    quantityUnit: line.quantityUnit ?? null,
    currencyCode: line.currencyCode,
    unitPriceNet: line.unitPriceNet ?? null,
    unitPriceGross: line.unitPriceGross ?? null,
    discountAmount: line.discountAmount ?? null,
    discountPercent: line.discountPercent ?? null,
    taxRate: line.taxRate ?? null,
    taxAmount: line.taxAmount ?? null,
    totalNetAmount: line.totalNetAmount ?? null,
    totalGrossAmount: line.totalGrossAmount ?? null,
    configuration: line.configuration ? cloneJson(line.configuration) : null,
    promotionCode: line.promotionCode ?? null,
    metadata: line.metadata ? cloneJson(line.metadata) : null,
    customFieldSetId: 'customFieldSetId' in line ? (line as any).customFieldSetId ?? null : null,
    customFields:
      'customFields' in line && line.customFields
        ? cloneJson((line as any).customFields)
        : null,
  }
}

function createAdjustmentDraftFromInput(
  adjustment: DocumentAdjustmentCreateInput & { id?: string | null }
): SalesAdjustmentDraft {
  const lineRef =
    'quoteLineId' in adjustment
      ? (adjustment as any).quoteLineId
      : (adjustment as any).orderLineId
  if (adjustment.scope === 'line' && lineRef) {
    throw new CrudHttpError(400, { error: 'Line-scoped adjustments are not supported yet.' })
  }
  return {
    id: typeof adjustment.id === 'string' ? adjustment.id : undefined,
    scope: adjustment.scope ?? 'order',
    kind: adjustment.kind ?? 'custom',
    code: adjustment.code ?? null,
    label: adjustment.label ?? null,
    calculatorKey: adjustment.calculatorKey ?? null,
    promotionId: adjustment.promotionId ?? null,
    rate: adjustment.rate ?? null,
    amountNet: adjustment.amountNet ?? null,
    amountGross: adjustment.amountGross ?? null,
    currencyCode: adjustment.currencyCode ?? null,
    metadata: adjustment.metadata ? cloneJson(adjustment.metadata) : null,
    position: adjustment.position ?? 0,
  }
}

function convertLineCalculationToEntityInput(
  lineResult: SalesLineCalculationResult,
  sourceLine: DocumentLineCreateInput,
  document: { organizationId: string; tenantId: string },
  index: number
) {
  const line = lineResult.line
  return {
    lineNumber: line.lineNumber ?? index + 1,
    kind: line.kind ?? 'product',
    statusEntryId: sourceLine.statusEntryId ?? null,
    productId: sourceLine.productId ?? null,
    productVariantId: sourceLine.productVariantId ?? null,
    catalogSnapshot: sourceLine.catalogSnapshot ? cloneJson(sourceLine.catalogSnapshot) : null,
    name: line.name ?? null,
    description: line.description ?? null,
    comment: line.comment ?? null,
    quantity: toNumericString(line.quantity) ?? '0',
    quantityUnit: line.quantityUnit ?? null,
    currencyCode: line.currencyCode,
    unitPriceNet:
      toNumericString(line.unitPriceNet ?? (lineResult.netAmount / Math.max(line.quantity || 1, 1))) ??
      '0',
    unitPriceGross:
      toNumericString(
        line.unitPriceGross ?? (lineResult.grossAmount / Math.max(line.quantity || 1, 1))
      ) ?? '0',
    discountAmount: toNumericString(lineResult.discountAmount) ?? '0',
    discountPercent: toNumericString(line.discountPercent) ?? '0',
    taxRate: toNumericString(line.taxRate) ?? '0',
    taxAmount: toNumericString(lineResult.taxAmount) ?? '0',
    totalNetAmount: toNumericString(lineResult.netAmount) ?? '0',
    totalGrossAmount: toNumericString(lineResult.grossAmount) ?? '0',
    configuration: line.configuration ? cloneJson(line.configuration) : null,
    promotionCode: line.promotionCode ?? null,
    promotionSnapshot: sourceLine.promotionSnapshot ? cloneJson(sourceLine.promotionSnapshot) : null,
    metadata: line.metadata ? cloneJson(line.metadata) : null,
    customFieldSetId: sourceLine.customFieldSetId ?? null,
    organizationId: document.organizationId,
    tenantId: document.tenantId,
  }
}

function convertAdjustmentResultToEntityInput(
  adjustment: SalesAdjustmentDraft,
  sourceAdjustment: DocumentAdjustmentCreateInput | null,
  document: { organizationId: string; tenantId: string },
  index: number
) {
  const metadata = adjustment.metadata ? cloneJson(adjustment.metadata) : null
  const resolvedPosition =
    sourceAdjustment?.position ??
    (adjustment.position !== null && adjustment.position !== undefined ? adjustment.position : index)
  return {
    scope: adjustment.scope ?? 'order',
    kind: adjustment.kind ?? 'custom',
    code: adjustment.code ?? null,
    label: adjustment.label ?? null,
    calculatorKey: adjustment.calculatorKey ?? null,
    promotionId: adjustment.promotionId ?? null,
    rate: toNumericString(adjustment.rate) ?? '0',
    amountNet: toNumericString(adjustment.amountNet) ?? '0',
    amountGross: toNumericString(adjustment.amountGross ?? adjustment.amountNet) ?? '0',
    currencyCode: adjustment.currencyCode ?? null,
    metadata,
    position: resolvedPosition,
    organizationId: document.organizationId,
    tenantId: document.tenantId,
  }
}

async function applyOrderLineResults(params: {
  em: EntityManager
  order: SalesOrder
  calculation: SalesDocumentCalculationResult
  sourceLines: Array<DocumentLineCreateInput & { id?: string }>
  existingLines: SalesOrderLine[]
}): Promise<void> {
  const { em, order, calculation, sourceLines, existingLines } = params
  const existingMap = new Map(existingLines.map((line) => [line.id, line]))
  const persisted = new Set<string>()
  const statusCache = new Map<string, string | null>()
  const resolveStatus = async (entryId?: string | null) => {
    if (!entryId) return null
    if (statusCache.has(entryId)) return statusCache.get(entryId) ?? null
    const value = await resolveDictionaryEntryValue(em, entryId)
    statusCache.set(entryId, value)
    return value
  }
  for (let index = 0; index < calculation.lines.length; index += 1) {
    const lineResult = calculation.lines[index]
    const sourceLine = sourceLines[index]
    const statusEntryId = (sourceLine as any).statusEntryId ?? null
    const statusValue = await resolveStatus(statusEntryId ?? null)
    const payload = convertLineCalculationToEntityInput(lineResult, sourceLine, order, index)
    const existing = sourceLine.id ? existingMap.get(sourceLine.id) ?? null : null
    const lineEntity =
      existing ??
      em.create(SalesOrderLine, {
        order,
        id: sourceLine.id ?? undefined,
        reservedQuantity: existing?.reservedQuantity ?? '0',
        fulfilledQuantity: existing?.fulfilledQuantity ?? '0',
        invoicedQuantity: existing?.invoicedQuantity ?? '0',
        returnedQuantity: existing?.returnedQuantity ?? '0',
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      })
    Object.assign(lineEntity, {
      ...payload,
      order,
      statusEntryId,
      status: statusValue,
    })
    em.persist(lineEntity)
    const rawCustomFields = (sourceLine as any).customFields
    if (rawCustomFields !== undefined && rawCustomFields !== null) {
      const customValues =
        rawCustomFields && typeof rawCustomFields === 'object'
          ? (rawCustomFields as Record<string, unknown>)
          : {}
      await setRecordCustomFields(em, {
        entityId: E.sales.sales_order_line,
        recordId: lineEntity.id,
        organizationId: order.organizationId,
        tenantId: order.tenantId,
        values: normalizeCustomFieldValues(customValues),
      })
    }
    persisted.add(lineEntity.id)
  }
  for (const [id, line] of existingMap.entries()) {
    if (!persisted.has(id)) {
      em.remove(line)
    }
  }
}

async function applyQuoteLineResults(params: {
  em: EntityManager
  quote: SalesQuote
  calculation: SalesDocumentCalculationResult
  sourceLines: Array<DocumentLineCreateInput & { id?: string }>
  existingLines: SalesQuoteLine[]
}): Promise<void> {
  const { em, quote, calculation, sourceLines, existingLines } = params
  const existingMap = new Map(existingLines.map((line) => [line.id, line]))
  const persisted = new Set<string>()
  const statusCache = new Map<string, string | null>()
  const resolveStatus = async (entryId?: string | null) => {
    if (!entryId) return null
    if (statusCache.has(entryId)) return statusCache.get(entryId) ?? null
    const value = await resolveDictionaryEntryValue(em, entryId)
    statusCache.set(entryId, value)
    return value
  }
  for (let index = 0; index < calculation.lines.length; index += 1) {
    const lineResult = calculation.lines[index]
    const sourceLine = sourceLines[index]
    const statusEntryId = (sourceLine as any).statusEntryId ?? null
    const statusValue = await resolveStatus(statusEntryId ?? null)
    const payload = convertLineCalculationToEntityInput(lineResult, sourceLine, quote, index)
    const existing = sourceLine.id ? existingMap.get(sourceLine.id) ?? null : null
    const lineEntity =
      existing ??
      em.create(SalesQuoteLine, {
        quote,
        id: sourceLine.id ?? undefined,
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      })
    Object.assign(lineEntity, {
      ...payload,
      quote,
      statusEntryId,
      status: statusValue,
    })
    em.persist(lineEntity)
    const rawCustomFields = (sourceLine as any).customFields
    if (rawCustomFields !== undefined && rawCustomFields !== null) {
      const customValues =
        rawCustomFields && typeof rawCustomFields === 'object'
          ? (rawCustomFields as Record<string, unknown>)
          : {}
      await setRecordCustomFields(em, {
        entityId: E.sales.sales_quote_line,
        recordId: lineEntity.id,
        organizationId: quote.organizationId,
        tenantId: quote.tenantId,
        values: normalizeCustomFieldValues(customValues),
      })
    }
    persisted.add(lineEntity.id)
  }
  for (const [id, line] of existingMap.entries()) {
    if (!persisted.has(id)) {
      em.remove(line)
    }
  }
}

async function replaceQuoteLines(
  em: EntityManager,
  quote: SalesQuote,
  calculation: SalesDocumentCalculationResult,
  lineInputs: QuoteLineCreateInput[]
): Promise<void> {
  await em.nativeDelete(SalesQuoteLine, { quote: quote.id })
  const statusCache = new Map<string, string | null>()
  const resolveStatus = async (entryId?: string | null) => {
    if (!entryId) return null
    if (statusCache.has(entryId)) return statusCache.get(entryId) ?? null
    const value = await resolveDictionaryEntryValue(em, entryId)
    statusCache.set(entryId, value)
    return value
  }
  for (let index = 0; index < calculation.lines.length; index += 1) {
    const lineResult = calculation.lines[index]
    const sourceLine = lineInputs[index]
    const entityInput = convertLineCalculationToEntityInput(lineResult, sourceLine, quote, index)
    const statusValue = await resolveStatus(sourceLine.statusEntryId ?? null)
    const lineEntity = em.create(SalesQuoteLine, {
      quote,
      ...entityInput,
      status: statusValue,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(lineEntity)
    const rawCustomFields = (sourceLine as any).customFields
    if (rawCustomFields !== undefined && rawCustomFields !== null) {
      const customValues =
        rawCustomFields && typeof rawCustomFields === 'object'
          ? (rawCustomFields as Record<string, unknown>)
          : {}
      await setRecordCustomFields(em, {
        entityId: E.sales.sales_quote_line,
        recordId: lineEntity.id,
        organizationId: quote.organizationId,
        tenantId: quote.tenantId,
        values: normalizeCustomFieldValues(customValues),
      })
    }
  }
}

async function replaceQuoteAdjustments(
  em: EntityManager,
  quote: SalesQuote,
  calculation: SalesDocumentCalculationResult,
  adjustmentInputs: QuoteAdjustmentCreateInput[] | null
): Promise<void> {
  const existing = await em.find(SalesQuoteAdjustment, { quote }, { orderBy: { position: 'asc' } })
  const existingMap = new Map<string, SalesQuoteAdjustment>()
  existing.forEach((adj) => existingMap.set(adj.id, adj))
  const seen = new Set<string>()
  const adjustmentDrafts = calculation.adjustments
  for (let index = 0; index < adjustmentDrafts.length; index += 1) {
    const draft = adjustmentDrafts[index]
    const sourceById = adjustmentInputs?.find((adj) => (adj as any).id === draft.id) ?? null
    const source = sourceById ?? (adjustmentInputs ? adjustmentInputs[index] ?? null : null)
    const entityInput = convertAdjustmentResultToEntityInput(draft, source, quote, index)
    const adjustmentId =
      (draft as any).id ??
      (source as any)?.id ??
      randomUUID()
    const existingEntity = existingMap.get(adjustmentId)
    const entity =
      existingEntity ??
      em.create(SalesQuoteAdjustment, {
        id: adjustmentId,
        quote,
        organizationId: quote.organizationId,
        tenantId: quote.tenantId,
        createdAt: new Date(),
      })
    entity.scope = entityInput.scope
    entity.kind = entityInput.kind
    entity.code = entityInput.code ?? null
    entity.label = entityInput.label ?? null
    entity.calculatorKey = entityInput.calculatorKey ?? null
    entity.promotionId = entityInput.promotionId ?? null
    entity.rate = entityInput.rate ?? '0'
    entity.amountNet = entityInput.amountNet ?? '0'
    entity.amountGross = entityInput.amountGross ?? entityInput.amountNet ?? '0'
    entity.currencyCode = entityInput.currencyCode ?? quote.currencyCode
    entity.metadata = entityInput.metadata ?? null
    entity.position = entityInput.position ?? index
    entity.updatedAt = new Date()
    entity.quoteLine = null
    seen.add(adjustmentId)
    if (source?.customFields !== undefined) {
      await setRecordCustomFields(em, {
        entityId: E.sales.sales_quote_adjustment,
        recordId: adjustmentId,
        organizationId: quote.organizationId,
        tenantId: quote.tenantId,
        values:
          source.customFields && typeof source.customFields === 'object'
            ? (source.customFields as Record<string, unknown>)
            : {},
      })
    }
    em.persist(entity)
  }

  existing.forEach((adj) => {
    if (!seen.has(adj.id)) {
      em.remove(adj)
    }
  })
}

async function replaceOrderLines(
  em: EntityManager,
  order: SalesOrder,
  calculation: SalesDocumentCalculationResult,
  lineInputs: OrderLineCreateInput[]
): Promise<void> {
  await em.nativeDelete(SalesOrderLine, { order: order.id })
  const statusCache = new Map<string, string | null>()
  const resolveStatus = async (entryId?: string | null) => {
    if (!entryId) return null
    if (statusCache.has(entryId)) return statusCache.get(entryId) ?? null
    const value = await resolveDictionaryEntryValue(em, entryId)
    statusCache.set(entryId, value)
    return value
  }
  for (let index = 0; index < calculation.lines.length; index += 1) {
    const lineResult = calculation.lines[index]
    const sourceLine = lineInputs[index]
    const entityInput = convertLineCalculationToEntityInput(lineResult, sourceLine, order, index)
    const statusValue = await resolveStatus(sourceLine.statusEntryId ?? null)
    const lineEntity = em.create(SalesOrderLine, {
      order,
      ...entityInput,
      reservedQuantity: '0',
      fulfilledQuantity: '0',
      invoicedQuantity: '0',
      returnedQuantity: '0',
      status: statusValue,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(lineEntity)
    const rawCustomFields = (sourceLine as any).customFields
    if (rawCustomFields !== undefined && rawCustomFields !== null) {
      const customValues =
        rawCustomFields && typeof rawCustomFields === 'object'
          ? (rawCustomFields as Record<string, unknown>)
          : {}
      await setRecordCustomFields(em, {
        entityId: E.sales.sales_order_line,
        recordId: lineEntity.id,
        organizationId: order.organizationId,
        tenantId: order.tenantId,
        values: normalizeCustomFieldValues(customValues),
      })
    }
  }
}

async function replaceOrderAdjustments(
  em: EntityManager,
  order: SalesOrder,
  calculation: SalesDocumentCalculationResult,
  adjustmentInputs: OrderAdjustmentCreateInput[] | null
): Promise<void> {
  const existing = await em.find(SalesOrderAdjustment, { order }, { orderBy: { position: 'asc' } })
  const existingMap = new Map<string, SalesOrderAdjustment>()
  existing.forEach((adj) => existingMap.set(adj.id, adj))
  const seen = new Set<string>()
  const adjustmentDrafts = calculation.adjustments
  for (let index = 0; index < adjustmentDrafts.length; index += 1) {
    const draft = adjustmentDrafts[index]
    const sourceById = adjustmentInputs?.find((adj) => (adj as any).id === draft.id) ?? null
    const source = sourceById ?? (adjustmentInputs ? adjustmentInputs[index] ?? null : null)
    const entityInput = convertAdjustmentResultToEntityInput(draft, source, order, index)
    const adjustmentId =
      (draft as any).id ??
      (source as any)?.id ??
      randomUUID()
    const existingEntity = existingMap.get(adjustmentId)
    const entity =
      existingEntity ??
      em.create(SalesOrderAdjustment, {
        id: adjustmentId,
        order,
        organizationId: order.organizationId,
        tenantId: order.tenantId,
        createdAt: new Date(),
      })
    entity.scope = entityInput.scope
    entity.kind = entityInput.kind
    entity.code = entityInput.code ?? null
    entity.label = entityInput.label ?? null
    entity.calculatorKey = entityInput.calculatorKey ?? null
    entity.promotionId = entityInput.promotionId ?? null
    entity.rate = entityInput.rate ?? '0'
    entity.amountNet = entityInput.amountNet ?? '0'
    entity.amountGross = entityInput.amountGross ?? entityInput.amountNet ?? '0'
    entity.currencyCode = entityInput.currencyCode ?? order.currencyCode
    entity.metadata = entityInput.metadata ?? null
    entity.position = entityInput.position ?? index
    entity.updatedAt = new Date()
    entity.orderLine = null
    seen.add(adjustmentId)
    if (source?.customFields !== undefined) {
      await setRecordCustomFields(em, {
        entityId: E.sales.sales_order_adjustment,
        recordId: adjustmentId,
        organizationId: order.organizationId,
        tenantId: order.tenantId,
        values:
          source.customFields && typeof source.customFields === 'object'
            ? (source.customFields as Record<string, unknown>)
            : {},
      })
    }
    em.persist(entity)
  }

  existing.forEach((adj) => {
    if (!seen.has(adj.id)) {
      em.remove(adj)
    }
  })
}

function applyQuoteTotals(
  quote: SalesQuote,
  totals: SalesDocumentCalculationResult['totals'],
  lineCount: number
): void {
  quote.subtotalNetAmount = toNumericString(totals.subtotalNetAmount) ?? '0'
  quote.subtotalGrossAmount = toNumericString(totals.subtotalGrossAmount) ?? '0'
  quote.discountTotalAmount = toNumericString(totals.discountTotalAmount) ?? '0'
  quote.taxTotalAmount = toNumericString(totals.taxTotalAmount) ?? '0'
  quote.grandTotalNetAmount = toNumericString(totals.grandTotalNetAmount) ?? '0'
  quote.grandTotalGrossAmount = toNumericString(totals.grandTotalGrossAmount) ?? '0'
  quote.totalsSnapshot = cloneJson(totals)
  quote.lineItemCount = lineCount
}

function applyOrderTotals(
  order: SalesOrder,
  totals: SalesDocumentCalculationResult['totals'],
  lineCount: number
): void {
  order.subtotalNetAmount = toNumericString(totals.subtotalNetAmount) ?? '0'
  order.subtotalGrossAmount = toNumericString(totals.subtotalGrossAmount) ?? '0'
  order.discountTotalAmount = toNumericString(totals.discountTotalAmount) ?? '0'
  order.taxTotalAmount = toNumericString(totals.taxTotalAmount) ?? '0'
  order.shippingNetAmount = toNumericString(totals.shippingNetAmount) ?? '0'
  order.shippingGrossAmount = toNumericString(totals.shippingGrossAmount) ?? '0'
  order.surchargeTotalAmount = toNumericString(totals.surchargeTotalAmount) ?? '0'
  order.grandTotalNetAmount = toNumericString(totals.grandTotalNetAmount) ?? '0'
  order.grandTotalGrossAmount = toNumericString(totals.grandTotalGrossAmount) ?? '0'
  order.paidTotalAmount = toNumericString(totals.paidTotalAmount) ?? '0'
  order.refundedTotalAmount = toNumericString(totals.refundedTotalAmount) ?? '0'
  order.outstandingAmount = toNumericString(totals.outstandingAmount) ?? '0'
  order.totalsSnapshot = cloneJson(totals)
  order.lineItemCount = lineCount
}

function normalizePaymentTotal(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(value, 0)
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0
  }
  return 0
}

function resolveExistingPaymentTotals(order: SalesOrder) {
  return {
    paidTotalAmount: normalizePaymentTotal(order.paidTotalAmount),
    refundedTotalAmount: normalizePaymentTotal(order.refundedTotalAmount),
  }
}

function ensureQuoteScope(ctx: Parameters<typeof ensureTenantScope>[0], organizationId: string, tenantId: string): void {
  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)
}

function ensureOrderScope(ctx: Parameters<typeof ensureTenantScope>[0], organizationId: string, tenantId: string): void {
  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)
}


function normalizeTagIds(tags?: Array<string | null | undefined>): string[] {
  if (!Array.isArray(tags)) return []
  const set = new Set<string>()
  tags.forEach((id) => {
    if (typeof id === 'string' && id.trim().length > 0) set.add(id.trim())
  })
  return Array.from(set)
}

function buildTagChange(
  beforeTags: TagAssignmentSnapshot[] | undefined,
  afterTags: TagAssignmentSnapshot[] | undefined
): { from: string[]; to: string[] } | null {
  const beforeIds = normalizeTagIds(beforeTags?.map((tag) => tag.tagId))
  const afterIds = normalizeTagIds(afterTags?.map((tag) => tag.tagId))
  beforeIds.sort()
  afterIds.sort()
  if (beforeIds.length === afterIds.length && beforeIds.every((id, index) => id === afterIds[index])) {
    return null
  }
  return { from: beforeIds, to: afterIds }
}

function buildOrderUpdateChangeKeys(input: DocumentUpdateInput): string[] {
  const keys = new Set<string>()
  if (input.orderNumber !== undefined) keys.add('orderNumber')
  if (input.statusEntryId !== undefined) {
    keys.add('statusEntryId')
    keys.add('status')
  }
  if (input.customerEntityId !== undefined) {
    keys.add('customerEntityId')
    keys.add('customerContactId')
    keys.add('customerSnapshot')
    keys.add('billingAddressId')
    keys.add('shippingAddressId')
    keys.add('billingAddressSnapshot')
    keys.add('shippingAddressSnapshot')
  }
  if (input.customerContactId !== undefined) {
    keys.add('customerContactId')
    keys.add('customerSnapshot')
  }
  if (input.customerSnapshot !== undefined) keys.add('customerSnapshot')
  if (input.metadata !== undefined) keys.add('metadata')
  if (input.comment !== undefined) keys.add('comments')
  if (input.currencyCode !== undefined) keys.add('currencyCode')
  if (input.channelId !== undefined) keys.add('channelId')
  if (input.placedAt !== undefined) keys.add('placedAt')
  if (input.expectedDeliveryAt !== undefined) keys.add('expectedDeliveryAt')
  if (input.shippingAddressId !== undefined || input.shippingAddressSnapshot !== undefined) {
    keys.add('shippingAddressId')
    keys.add('shippingAddressSnapshot')
  }
  if (input.billingAddressId !== undefined || input.billingAddressSnapshot !== undefined) {
    keys.add('billingAddressId')
    keys.add('billingAddressSnapshot')
  }
  if (
    input.shippingMethodId !== undefined ||
    input.shippingMethodCode !== undefined ||
    input.shippingMethodSnapshot !== undefined
  ) {
    keys.add('shippingMethodId')
    keys.add('shippingMethodCode')
    keys.add('shippingMethodSnapshot')
  }
  if (
    input.paymentMethodId !== undefined ||
    input.paymentMethodCode !== undefined ||
    input.paymentMethodSnapshot !== undefined
  ) {
    keys.add('paymentMethodId')
    keys.add('paymentMethodCode')
    keys.add('paymentMethodSnapshot')
  }
  if (input.customFieldSetId !== undefined) keys.add('customFieldSetId')
  if (input.customFields !== undefined) keys.add('customFields')
  return Array.from(keys)
}

function buildQuoteUpdateChangeKeys(input: DocumentUpdateInput): string[] {
  const keys = new Set<string>()
  if (input.quoteNumber !== undefined) keys.add('quoteNumber')
  if (input.statusEntryId !== undefined) {
    keys.add('statusEntryId')
    keys.add('status')
  }
  if (input.customerEntityId !== undefined) {
    keys.add('customerEntityId')
    keys.add('customerContactId')
    keys.add('customerSnapshot')
    keys.add('billingAddressId')
    keys.add('shippingAddressId')
    keys.add('billingAddressSnapshot')
    keys.add('shippingAddressSnapshot')
  }
  if (input.customerContactId !== undefined) {
    keys.add('customerContactId')
    keys.add('customerSnapshot')
  }
  if (input.customerSnapshot !== undefined) keys.add('customerSnapshot')
  if (input.metadata !== undefined) keys.add('metadata')
  if (input.comment !== undefined) keys.add('comments')
  if (input.currencyCode !== undefined) keys.add('currencyCode')
  if (input.channelId !== undefined) keys.add('channelId')
  if (input.shippingAddressId !== undefined || input.shippingAddressSnapshot !== undefined) {
    keys.add('shippingAddressId')
    keys.add('shippingAddressSnapshot')
  }
  if (input.billingAddressId !== undefined || input.billingAddressSnapshot !== undefined) {
    keys.add('billingAddressId')
    keys.add('billingAddressSnapshot')
  }
  if (
    input.shippingMethodId !== undefined ||
    input.shippingMethodCode !== undefined ||
    input.shippingMethodSnapshot !== undefined
  ) {
    keys.add('shippingMethodId')
    keys.add('shippingMethodCode')
    keys.add('shippingMethodSnapshot')
  }
  if (
    input.paymentMethodId !== undefined ||
    input.paymentMethodCode !== undefined ||
    input.paymentMethodSnapshot !== undefined
  ) {
    keys.add('paymentMethodId')
    keys.add('paymentMethodCode')
    keys.add('paymentMethodSnapshot')
  }
  if (input.customFieldSetId !== undefined) keys.add('customFieldSetId')
  if (input.customFields !== undefined) keys.add('customFields')
  return Array.from(keys)
}

async function syncSalesDocumentTags(em: EntityManager, params: {
  documentId: string
  kind: SalesDocumentKind
  organizationId: string
  tenantId: string
  tagIds?: Array<string | null | undefined> | null
}) {
  if (params.tagIds === undefined) return
  const tagIds = normalizeTagIds(params.tagIds)
  if (tagIds.length === 0) {
    await em.nativeDelete(SalesDocumentTagAssignment, { documentId: params.documentId, documentKind: params.kind })
    return
  }
  const tagsInScope = await em.find(SalesDocumentTag, {
    id: { $in: tagIds },
    organizationId: params.organizationId,
    tenantId: params.tenantId,
  })
  if (tagsInScope.length !== tagIds.length) {
    throw new CrudHttpError(400, { error: 'One or more tags not found for this scope' })
  }
  const byId = new Map(tagsInScope.map((tag) => [tag.id, tag]))
  await em.nativeDelete(SalesDocumentTagAssignment, { documentId: params.documentId, documentKind: params.kind })
  for (const tagId of tagIds) {
    const tag = byId.get(tagId)
    if (!tag) continue
    const assignment = em.create(SalesDocumentTagAssignment, {
      organizationId: params.organizationId,
      tenantId: params.tenantId,
      documentId: params.documentId,
      documentKind: params.kind,
      tag,
      order: params.kind === 'order' ? em.getReference(SalesOrder, params.documentId) : null,
      quote: params.kind === 'quote' ? em.getReference(SalesQuote, params.documentId) : null,
    })
    em.persist(assignment)
  }
}

function applyQuoteSnapshot(quote: SalesQuote, snapshot: QuoteGraphSnapshot['quote']): void {
  quote.organizationId = snapshot.organizationId
  quote.tenantId = snapshot.tenantId
  quote.quoteNumber = snapshot.quoteNumber
  quote.statusEntryId = snapshot.statusEntryId ?? null
  quote.status = snapshot.status ?? null
  quote.customerEntityId = snapshot.customerEntityId ?? null
  quote.customerContactId = snapshot.customerContactId ?? null
  quote.customerSnapshot = snapshot.customerSnapshot ? cloneJson(snapshot.customerSnapshot) : null
  quote.billingAddressId = snapshot.billingAddressId ?? null
  quote.shippingAddressId = snapshot.shippingAddressId ?? null
  quote.billingAddressSnapshot = snapshot.billingAddressSnapshot ? cloneJson(snapshot.billingAddressSnapshot) : null
  quote.shippingAddressSnapshot = snapshot.shippingAddressSnapshot
    ? cloneJson(snapshot.shippingAddressSnapshot)
    : null
  quote.currencyCode = snapshot.currencyCode
  quote.validFrom = snapshot.validFrom ? new Date(snapshot.validFrom) : null
  quote.validUntil = snapshot.validUntil ? new Date(snapshot.validUntil) : null
  quote.comments = snapshot.comments ?? null
  quote.taxInfo = snapshot.taxInfo ? cloneJson(snapshot.taxInfo) : null
  quote.shippingMethodId = snapshot.shippingMethodId ?? null
  quote.shippingMethodCode = snapshot.shippingMethodCode ?? null
  quote.deliveryWindowId = snapshot.deliveryWindowId ?? null
  quote.deliveryWindowCode = snapshot.deliveryWindowCode ?? null
  quote.paymentMethodId = snapshot.paymentMethodId ?? null
  quote.paymentMethodCode = snapshot.paymentMethodCode ?? null
  quote.shippingMethodSnapshot = snapshot.shippingMethodSnapshot ? cloneJson(snapshot.shippingMethodSnapshot) : null
  quote.deliveryWindowSnapshot = snapshot.deliveryWindowSnapshot
    ? cloneJson(snapshot.deliveryWindowSnapshot)
    : null
  quote.paymentMethodSnapshot = snapshot.paymentMethodSnapshot ? cloneJson(snapshot.paymentMethodSnapshot) : null
  quote.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  quote.channelId = snapshot.channelId ?? null
  quote.customFieldSetId = snapshot.customFieldSetId ?? null
  quote.subtotalNetAmount = snapshot.subtotalNetAmount
  quote.subtotalGrossAmount = snapshot.subtotalGrossAmount
  quote.discountTotalAmount = snapshot.discountTotalAmount
  quote.taxTotalAmount = snapshot.taxTotalAmount
  quote.grandTotalNetAmount = snapshot.grandTotalNetAmount
  quote.grandTotalGrossAmount = snapshot.grandTotalGrossAmount
  quote.totalsSnapshot = snapshot.totalsSnapshot ? cloneJson(snapshot.totalsSnapshot) : null
  quote.lineItemCount = snapshot.lineItemCount
}

function applyOrderSnapshot(order: SalesOrder, snapshot: OrderGraphSnapshot['order']): void {
  order.organizationId = snapshot.organizationId
  order.tenantId = snapshot.tenantId
  order.orderNumber = snapshot.orderNumber
  order.statusEntryId = snapshot.statusEntryId ?? null
  order.status = snapshot.status ?? null
  order.fulfillmentStatusEntryId = snapshot.fulfillmentStatusEntryId ?? null
  order.fulfillmentStatus = snapshot.fulfillmentStatus ?? null
  order.paymentStatusEntryId = snapshot.paymentStatusEntryId ?? null
  order.paymentStatus = snapshot.paymentStatus ?? null
  order.customerEntityId = snapshot.customerEntityId ?? null
  order.customerContactId = snapshot.customerContactId ?? null
  order.customerSnapshot = snapshot.customerSnapshot ? cloneJson(snapshot.customerSnapshot) : null
  order.billingAddressId = snapshot.billingAddressId ?? null
  order.shippingAddressId = snapshot.shippingAddressId ?? null
  order.billingAddressSnapshot = snapshot.billingAddressSnapshot ? cloneJson(snapshot.billingAddressSnapshot) : null
  order.shippingAddressSnapshot = snapshot.shippingAddressSnapshot
    ? cloneJson(snapshot.shippingAddressSnapshot)
    : null
  order.currencyCode = snapshot.currencyCode
  order.exchangeRate = snapshot.exchangeRate ?? null
  order.taxStrategyKey = snapshot.taxStrategyKey ?? null
  order.discountStrategyKey = snapshot.discountStrategyKey ?? null
  order.taxInfo = snapshot.taxInfo ? cloneJson(snapshot.taxInfo) : null
  order.shippingMethodId = snapshot.shippingMethodId ?? null
  order.shippingMethodCode = snapshot.shippingMethodCode ?? null
  order.deliveryWindowId = snapshot.deliveryWindowId ?? null
  order.deliveryWindowCode = snapshot.deliveryWindowCode ?? null
  order.paymentMethodId = snapshot.paymentMethodId ?? null
  order.paymentMethodCode = snapshot.paymentMethodCode ?? null
  order.channelId = snapshot.channelId ?? null
  order.placedAt = snapshot.placedAt ? new Date(snapshot.placedAt) : null
  order.expectedDeliveryAt = snapshot.expectedDeliveryAt ? new Date(snapshot.expectedDeliveryAt) : null
  order.dueAt = snapshot.dueAt ? new Date(snapshot.dueAt) : null
  order.comments = snapshot.comments ?? null
  order.internalNotes = snapshot.internalNotes ?? null
  order.shippingMethodSnapshot = snapshot.shippingMethodSnapshot ? cloneJson(snapshot.shippingMethodSnapshot) : null
  order.deliveryWindowSnapshot = snapshot.deliveryWindowSnapshot
    ? cloneJson(snapshot.deliveryWindowSnapshot)
    : null
  order.paymentMethodSnapshot = snapshot.paymentMethodSnapshot ? cloneJson(snapshot.paymentMethodSnapshot) : null
  order.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  order.customFieldSetId = snapshot.customFieldSetId ?? null
  order.subtotalNetAmount = snapshot.subtotalNetAmount
  order.subtotalGrossAmount = snapshot.subtotalGrossAmount
  order.discountTotalAmount = snapshot.discountTotalAmount
  order.taxTotalAmount = snapshot.taxTotalAmount
  order.shippingNetAmount = snapshot.shippingNetAmount
  order.shippingGrossAmount = snapshot.shippingGrossAmount
  order.surchargeTotalAmount = snapshot.surchargeTotalAmount
  order.grandTotalNetAmount = snapshot.grandTotalNetAmount
  order.grandTotalGrossAmount = snapshot.grandTotalGrossAmount
  order.paidTotalAmount = snapshot.paidTotalAmount
  order.refundedTotalAmount = snapshot.refundedTotalAmount
  order.outstandingAmount = snapshot.outstandingAmount
  order.totalsSnapshot = snapshot.totalsSnapshot ? cloneJson(snapshot.totalsSnapshot) : null
  order.lineItemCount = snapshot.lineItemCount
}

async function restoreQuoteGraph(
  em: EntityManager,
  snapshot: QuoteGraphSnapshot
): Promise<SalesQuote> {
  let quote = await em.findOne(SalesQuote, { id: snapshot.quote.id })
  if (!quote) {
    quote = em.create(SalesQuote, {
      id: snapshot.quote.id,
      organizationId: snapshot.quote.organizationId,
      tenantId: snapshot.quote.tenantId,
      quoteNumber: snapshot.quote.quoteNumber,
      statusEntryId: snapshot.quote.statusEntryId ?? null,
      status: snapshot.quote.status ?? null,
      customerEntityId: snapshot.quote.customerEntityId ?? null,
      customerContactId: snapshot.quote.customerContactId ?? null,
      customerSnapshot: snapshot.quote.customerSnapshot ? cloneJson(snapshot.quote.customerSnapshot) : null,
      billingAddressId: snapshot.quote.billingAddressId ?? null,
      shippingAddressId: snapshot.quote.shippingAddressId ?? null,
      billingAddressSnapshot: snapshot.quote.billingAddressSnapshot
        ? cloneJson(snapshot.quote.billingAddressSnapshot)
        : null,
      shippingAddressSnapshot: snapshot.quote.shippingAddressSnapshot
        ? cloneJson(snapshot.quote.shippingAddressSnapshot)
        : null,
      currencyCode: snapshot.quote.currencyCode,
      validFrom: snapshot.quote.validFrom ? new Date(snapshot.quote.validFrom) : null,
      validUntil: snapshot.quote.validUntil ? new Date(snapshot.quote.validUntil) : null,
      comments: snapshot.quote.comments ?? null,
      taxInfo: snapshot.quote.taxInfo ? cloneJson(snapshot.quote.taxInfo) : null,
      shippingMethodId: snapshot.quote.shippingMethodId ?? null,
      shippingMethodCode: snapshot.quote.shippingMethodCode ?? null,
      deliveryWindowId: snapshot.quote.deliveryWindowId ?? null,
      deliveryWindowCode: snapshot.quote.deliveryWindowCode ?? null,
      paymentMethodId: snapshot.quote.paymentMethodId ?? null,
      paymentMethodCode: snapshot.quote.paymentMethodCode ?? null,
      shippingMethodSnapshot: snapshot.quote.shippingMethodSnapshot
        ? cloneJson(snapshot.quote.shippingMethodSnapshot)
        : null,
      deliveryWindowSnapshot: snapshot.quote.deliveryWindowSnapshot
        ? cloneJson(snapshot.quote.deliveryWindowSnapshot)
        : null,
      paymentMethodSnapshot: snapshot.quote.paymentMethodSnapshot
        ? cloneJson(snapshot.quote.paymentMethodSnapshot)
        : null,
      metadata: snapshot.quote.metadata ? cloneJson(snapshot.quote.metadata) : null,
      channelId: snapshot.quote.channelId ?? null,
      customFieldSetId: snapshot.quote.customFieldSetId ?? null,
      subtotalNetAmount: snapshot.quote.subtotalNetAmount,
      subtotalGrossAmount: snapshot.quote.subtotalGrossAmount,
      discountTotalAmount: snapshot.quote.discountTotalAmount,
      taxTotalAmount: snapshot.quote.taxTotalAmount,
      grandTotalNetAmount: snapshot.quote.grandTotalNetAmount,
      grandTotalGrossAmount: snapshot.quote.grandTotalGrossAmount,
      totalsSnapshot: snapshot.quote.totalsSnapshot ? cloneJson(snapshot.quote.totalsSnapshot) : null,
      lineItemCount: snapshot.quote.lineItemCount,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(quote)
  }
  applyQuoteSnapshot(quote, snapshot.quote)
  await em.flush()
  const existingLines = await em.find(SalesQuoteLine, { quote: quote.id }, { fields: ['id'] })
  const existingAdjustments = await em.find(SalesQuoteAdjustment, { quote: quote.id }, { fields: ['id'] })
  await em.nativeDelete(CustomFieldValue, { entityId: E.sales.sales_quote, recordId: quote.id })
  if (existingLines.length) {
    await em.nativeDelete(CustomFieldValue, {
      entityId: E.sales.sales_quote_line,
      recordId: { $in: existingLines.map((line) => line.id) },
    })
  }
  if (existingAdjustments.length) {
    await em.nativeDelete(CustomFieldValue, {
      entityId: E.sales.sales_quote_adjustment,
      recordId: { $in: existingAdjustments.map((adj) => adj.id) },
    })
  }
  const addressSnapshots = Array.isArray(snapshot.addresses) ? snapshot.addresses : []
  const noteSnapshots = Array.isArray(snapshot.notes) ? snapshot.notes : []
  const tagSnapshots = Array.isArray(snapshot.tags) ? snapshot.tags : []
  await em.nativeDelete(SalesDocumentAddress, { documentId: quote.id, documentKind: 'quote' })
  await em.nativeDelete(SalesNote, { contextType: 'quote', contextId: quote.id })
  await em.nativeDelete(SalesDocumentTagAssignment, { documentId: quote.id, documentKind: 'quote' })
  await em.nativeDelete(SalesQuoteLine, { quote: quote.id })
  await em.nativeDelete(SalesQuoteAdjustment, { quote: quote.id })
  existingLines.forEach((entry) => em.getUnitOfWork().unsetIdentity(entry))
  existingAdjustments.forEach((entry) => em.getUnitOfWork().unsetIdentity(entry))

  snapshot.lines.forEach((line) => {
    const lineEntity = em.create(SalesQuoteLine, {
      id: line.id,
      quote,
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      lineNumber: line.lineNumber,
      kind: line.kind as SalesLineKind,
      statusEntryId: line.statusEntryId ?? null,
      status: line.status ?? null,
      productId: line.productId ?? null,
      productVariantId: line.productVariantId ?? null,
      catalogSnapshot: line.catalogSnapshot ? cloneJson(line.catalogSnapshot) : null,
      name: line.name ?? null,
      description: line.description ?? null,
      comment: line.comment ?? null,
      quantity: line.quantity,
      quantityUnit: line.quantityUnit ?? null,
      currencyCode: line.currencyCode,
      unitPriceNet: line.unitPriceNet,
      unitPriceGross: line.unitPriceGross,
      discountAmount: line.discountAmount,
      discountPercent: line.discountPercent,
      taxRate: line.taxRate,
      taxAmount: line.taxAmount,
      totalNetAmount: line.totalNetAmount,
      totalGrossAmount: line.totalGrossAmount,
      configuration: line.configuration ? cloneJson(line.configuration) : null,
      promotionCode: line.promotionCode ?? null,
      promotionSnapshot: line.promotionSnapshot ? cloneJson(line.promotionSnapshot) : null,
      metadata: line.metadata ? cloneJson(line.metadata) : null,
      customFieldSetId: line.customFieldSetId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(lineEntity)
  })

  snapshot.adjustments.forEach((adjustment, index) => {
    const adjustmentEntity = em.create(SalesQuoteAdjustment, {
      id: adjustment.id,
      quote,
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      scope: adjustment.scope,
      kind: adjustment.kind as SalesAdjustmentKind,
      code: adjustment.code ?? null,
      label: adjustment.label ?? null,
      calculatorKey: adjustment.calculatorKey ?? null,
      promotionId: adjustment.promotionId ?? null,
      rate: adjustment.rate,
      amountNet: adjustment.amountNet,
      amountGross: adjustment.amountGross,
      currencyCode: adjustment.currencyCode ?? null,
      metadata: adjustment.metadata ? cloneJson(adjustment.metadata) : null,
      position: adjustment.position ?? index,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    adjustmentEntity.quoteLine = null
    em.persist(adjustmentEntity)
  })

  addressSnapshots.forEach((entry) => {
    const entity = em.create(SalesDocumentAddress, {
      id: entry.id,
      organizationId: entry.organizationId,
      tenantId: entry.tenantId,
      documentId: quote.id,
      documentKind: 'quote',
      customerAddressId: entry.customerAddressId ?? null,
      name: entry.name ?? null,
      purpose: entry.purpose ?? null,
      companyName: entry.companyName ?? null,
      addressLine1: entry.addressLine1,
      addressLine2: entry.addressLine2 ?? null,
      city: entry.city ?? null,
      region: entry.region ?? null,
      postalCode: entry.postalCode ?? null,
      country: entry.country ?? null,
      buildingNumber: entry.buildingNumber ?? null,
      flatNumber: entry.flatNumber ?? null,
      latitude: entry.latitude ?? null,
      longitude: entry.longitude ?? null,
      quote,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(entity)
  })

  noteSnapshots.forEach((entry) => {
    const entity = em.create(SalesNote, {
      id: entry.id,
      organizationId: entry.organizationId,
      tenantId: entry.tenantId,
      contextType: 'quote',
      contextId: quote.id,
      order: null,
      quote,
      body: entry.body,
      authorUserId: entry.authorUserId ?? null,
      appearanceIcon: entry.appearanceIcon ?? null,
      appearanceColor: entry.appearanceColor ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(entity)
  })

  tagSnapshots.forEach((entry) => {
    const tag = em.getReference(SalesDocumentTag, entry.tagId)
    const assignment = em.create(SalesDocumentTagAssignment, {
      id: entry.id,
      organizationId: entry.organizationId,
      tenantId: entry.tenantId,
      documentId: quote.id,
      documentKind: 'quote',
      tag,
      quote,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(assignment)
  })

  if (snapshot.quote.customFields) {
    await setRecordCustomFields(em, {
      entityId: E.sales.sales_quote,
      recordId: quote.id,
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      values: normalizeCustomFieldValues(snapshot.quote.customFields),
    })
  }
  for (const line of snapshot.lines) {
    if (!line.customFields) continue
    await setRecordCustomFields(em, {
      entityId: E.sales.sales_quote_line,
      recordId: line.id,
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      values: normalizeCustomFieldValues(line.customFields),
    })
  }
  for (const adjustment of snapshot.adjustments) {
    if (!adjustment.customFields) continue
    await setRecordCustomFields(em, {
      entityId: E.sales.sales_quote_adjustment,
      recordId: adjustment.id,
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      values: normalizeCustomFieldValues(adjustment.customFields),
    })
  }

  return quote
}

async function restoreOrderGraph(
  em: EntityManager,
  snapshot: OrderGraphSnapshot
): Promise<SalesOrder> {
  let order = await em.findOne(SalesOrder, { id: snapshot.order.id })
  if (!order) {
    order = em.create(SalesOrder, {
      id: snapshot.order.id,
      organizationId: snapshot.order.organizationId,
      tenantId: snapshot.order.tenantId,
      orderNumber: snapshot.order.orderNumber,
      statusEntryId: snapshot.order.statusEntryId ?? null,
      status: snapshot.order.status ?? null,
      fulfillmentStatusEntryId: snapshot.order.fulfillmentStatusEntryId ?? null,
      fulfillmentStatus: snapshot.order.fulfillmentStatus ?? null,
      paymentStatusEntryId: snapshot.order.paymentStatusEntryId ?? null,
      paymentStatus: snapshot.order.paymentStatus ?? null,
      customerEntityId: snapshot.order.customerEntityId ?? null,
      customerContactId: snapshot.order.customerContactId ?? null,
      customerSnapshot: snapshot.order.customerSnapshot ? cloneJson(snapshot.order.customerSnapshot) : null,
      billingAddressId: snapshot.order.billingAddressId ?? null,
      shippingAddressId: snapshot.order.shippingAddressId ?? null,
      billingAddressSnapshot: snapshot.order.billingAddressSnapshot
        ? cloneJson(snapshot.order.billingAddressSnapshot)
        : null,
      shippingAddressSnapshot: snapshot.order.shippingAddressSnapshot
        ? cloneJson(snapshot.order.shippingAddressSnapshot)
        : null,
      currencyCode: snapshot.order.currencyCode,
      exchangeRate: snapshot.order.exchangeRate ?? null,
      taxStrategyKey: snapshot.order.taxStrategyKey ?? null,
      discountStrategyKey: snapshot.order.discountStrategyKey ?? null,
      taxInfo: snapshot.order.taxInfo ? cloneJson(snapshot.order.taxInfo) : null,
      shippingMethodId: snapshot.order.shippingMethodId ?? null,
      shippingMethodCode: snapshot.order.shippingMethodCode ?? null,
      deliveryWindowId: snapshot.order.deliveryWindowId ?? null,
      deliveryWindowCode: snapshot.order.deliveryWindowCode ?? null,
      paymentMethodId: snapshot.order.paymentMethodId ?? null,
      paymentMethodCode: snapshot.order.paymentMethodCode ?? null,
      channelId: snapshot.order.channelId ?? null,
      placedAt: snapshot.order.placedAt ? new Date(snapshot.order.placedAt) : null,
      expectedDeliveryAt: snapshot.order.expectedDeliveryAt ? new Date(snapshot.order.expectedDeliveryAt) : null,
      dueAt: snapshot.order.dueAt ? new Date(snapshot.order.dueAt) : null,
      comments: snapshot.order.comments ?? null,
      internalNotes: snapshot.order.internalNotes ?? null,
      shippingMethodSnapshot: snapshot.order.shippingMethodSnapshot
        ? cloneJson(snapshot.order.shippingMethodSnapshot)
        : null,
      deliveryWindowSnapshot: snapshot.order.deliveryWindowSnapshot
        ? cloneJson(snapshot.order.deliveryWindowSnapshot)
        : null,
      paymentMethodSnapshot: snapshot.order.paymentMethodSnapshot
        ? cloneJson(snapshot.order.paymentMethodSnapshot)
        : null,
      metadata: snapshot.order.metadata ? cloneJson(snapshot.order.metadata) : null,
      customFieldSetId: snapshot.order.customFieldSetId ?? null,
      subtotalNetAmount: snapshot.order.subtotalNetAmount,
      subtotalGrossAmount: snapshot.order.subtotalGrossAmount,
      discountTotalAmount: snapshot.order.discountTotalAmount,
      taxTotalAmount: snapshot.order.taxTotalAmount,
      shippingNetAmount: snapshot.order.shippingNetAmount,
      shippingGrossAmount: snapshot.order.shippingGrossAmount,
      surchargeTotalAmount: snapshot.order.surchargeTotalAmount,
      grandTotalNetAmount: snapshot.order.grandTotalNetAmount,
      grandTotalGrossAmount: snapshot.order.grandTotalGrossAmount,
      paidTotalAmount: snapshot.order.paidTotalAmount,
      refundedTotalAmount: snapshot.order.refundedTotalAmount,
      outstandingAmount: snapshot.order.outstandingAmount,
      totalsSnapshot: snapshot.order.totalsSnapshot ? cloneJson(snapshot.order.totalsSnapshot) : null,
      lineItemCount: snapshot.order.lineItemCount,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(order)
  }
  applyOrderSnapshot(order, snapshot.order)
  await em.flush()
  const existingLines = await em.find(SalesOrderLine, { order: order.id }, { fields: ['id'] })
  const existingAdjustments = await em.find(SalesOrderAdjustment, { order: order.id }, { fields: ['id'] })
  await em.nativeDelete(CustomFieldValue, { entityId: E.sales.sales_order, recordId: order.id })
  if (existingLines.length) {
    await em.nativeDelete(CustomFieldValue, {
      entityId: E.sales.sales_order_line,
      recordId: { $in: existingLines.map((line) => line.id) },
    })
  }
  if (existingAdjustments.length) {
    await em.nativeDelete(CustomFieldValue, {
      entityId: E.sales.sales_order_adjustment,
      recordId: { $in: existingAdjustments.map((adj) => adj.id) },
    })
  }
  const addressSnapshots = Array.isArray(snapshot.addresses) ? snapshot.addresses : []
  const noteSnapshots = Array.isArray(snapshot.notes) ? snapshot.notes : []
  const tagSnapshots = Array.isArray(snapshot.tags) ? snapshot.tags : []
  const shipmentSnapshots = Array.isArray(snapshot.shipments) ? snapshot.shipments : []
  const paymentSnapshots = Array.isArray(snapshot.payments) ? snapshot.payments : []
  const existingShipments = await em.find(SalesShipment, { order: order.id })
  const shipmentIds = existingShipments.map((entry) => entry.id)
  if (shipmentIds.length) {
    await em.nativeDelete(SalesShipmentItem, { shipment: { $in: shipmentIds } })
    await em.nativeDelete(SalesShipment, { id: { $in: shipmentIds } })
    existingShipments.forEach((entry) => em.getUnitOfWork().unsetIdentity(entry))
  }
  await em.nativeDelete(SalesPaymentAllocation, { order: order.id })
  await em.nativeDelete(SalesPayment, { order: order.id })
  await em.nativeDelete(SalesDocumentAddress, { documentId: order.id, documentKind: 'order' })
  await em.nativeDelete(SalesNote, { contextType: 'order', contextId: order.id })
  await em.nativeDelete(SalesDocumentTagAssignment, { documentId: order.id, documentKind: 'order' })
  await em.nativeDelete(SalesOrderAdjustment, { order: order.id })
  await em.nativeDelete(SalesOrderLine, { order: order.id })
  existingLines.forEach((entry) => em.getUnitOfWork().unsetIdentity(entry))
  existingAdjustments.forEach((entry) => em.getUnitOfWork().unsetIdentity(entry))

  snapshot.lines.forEach((line) => {
    const lineEntity = em.create(SalesOrderLine, {
      id: line.id,
      order,
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      lineNumber: line.lineNumber,
      kind: line.kind as SalesLineKind,
      statusEntryId: line.statusEntryId ?? null,
      status: line.status ?? null,
      productId: line.productId ?? null,
      productVariantId: line.productVariantId ?? null,
      catalogSnapshot: line.catalogSnapshot ? cloneJson(line.catalogSnapshot) : null,
      name: line.name ?? null,
      description: line.description ?? null,
      comment: line.comment ?? null,
      quantity: line.quantity,
      quantityUnit: line.quantityUnit ?? null,
      reservedQuantity: line.reservedQuantity,
      fulfilledQuantity: line.fulfilledQuantity,
      invoicedQuantity: line.invoicedQuantity,
      returnedQuantity: line.returnedQuantity,
      currencyCode: line.currencyCode,
      unitPriceNet: line.unitPriceNet,
      unitPriceGross: line.unitPriceGross,
      discountAmount: line.discountAmount,
      discountPercent: line.discountPercent,
      taxRate: line.taxRate,
      taxAmount: line.taxAmount,
      totalNetAmount: line.totalNetAmount,
      totalGrossAmount: line.totalGrossAmount,
      configuration: line.configuration ? cloneJson(line.configuration) : null,
      promotionCode: line.promotionCode ?? null,
      promotionSnapshot: line.promotionSnapshot ? cloneJson(line.promotionSnapshot) : null,
      metadata: line.metadata ? cloneJson(line.metadata) : null,
      customFieldSetId: line.customFieldSetId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(lineEntity)
  })

  snapshot.adjustments.forEach((adjustment, index) => {
    const adjustmentEntity = em.create(SalesOrderAdjustment, {
      id: adjustment.id,
      order,
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      scope: adjustment.scope,
      kind: adjustment.kind as SalesAdjustmentKind,
      code: adjustment.code ?? null,
      label: adjustment.label ?? null,
      calculatorKey: adjustment.calculatorKey ?? null,
      promotionId: adjustment.promotionId ?? null,
      rate: adjustment.rate,
      amountNet: adjustment.amountNet,
      amountGross: adjustment.amountGross,
      currencyCode: adjustment.currencyCode ?? null,
      metadata: adjustment.metadata ? cloneJson(adjustment.metadata) : null,
      position: adjustment.position ?? index,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    adjustmentEntity.orderLine = null
    em.persist(adjustmentEntity)
  })

  addressSnapshots.forEach((entry) => {
    const entity = em.create(SalesDocumentAddress, {
      id: entry.id,
      organizationId: entry.organizationId,
      tenantId: entry.tenantId,
      documentId: order.id,
      documentKind: 'order',
      customerAddressId: entry.customerAddressId ?? null,
      name: entry.name ?? null,
      purpose: entry.purpose ?? null,
      companyName: entry.companyName ?? null,
      addressLine1: entry.addressLine1,
      addressLine2: entry.addressLine2 ?? null,
      city: entry.city ?? null,
      region: entry.region ?? null,
      postalCode: entry.postalCode ?? null,
      country: entry.country ?? null,
      buildingNumber: entry.buildingNumber ?? null,
      flatNumber: entry.flatNumber ?? null,
      latitude: entry.latitude ?? null,
      longitude: entry.longitude ?? null,
      order,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(entity)
  })

  noteSnapshots.forEach((entry) => {
    const entity = em.create(SalesNote, {
      id: entry.id,
      organizationId: entry.organizationId,
      tenantId: entry.tenantId,
      contextType: 'order',
      contextId: order.id,
      order,
      quote: null,
      body: entry.body,
      authorUserId: entry.authorUserId ?? null,
      appearanceIcon: entry.appearanceIcon ?? null,
      appearanceColor: entry.appearanceColor ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(entity)
  })

  tagSnapshots.forEach((entry) => {
    const tag = em.getReference(SalesDocumentTag, entry.tagId)
    const assignment = em.create(SalesDocumentTagAssignment, {
      id: entry.id,
      organizationId: entry.organizationId,
      tenantId: entry.tenantId,
      documentId: order.id,
      documentKind: 'order',
      tag,
      order,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(assignment)
  })

  if (snapshot.order.customFields) {
    await setRecordCustomFields(em, {
      entityId: E.sales.sales_order,
      recordId: order.id,
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      values: normalizeCustomFieldValues(snapshot.order.customFields),
    })
  }
  for (const line of snapshot.lines) {
    if (!line.customFields) continue
    await setRecordCustomFields(em, {
      entityId: E.sales.sales_order_line,
      recordId: line.id,
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      values: normalizeCustomFieldValues(line.customFields),
    })
  }
  for (const adjustment of snapshot.adjustments) {
    if (!adjustment.customFields) continue
    await setRecordCustomFields(em, {
      entityId: E.sales.sales_order_adjustment,
      recordId: adjustment.id,
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      values: normalizeCustomFieldValues(adjustment.customFields),
    })
  }

  for (const shipment of shipmentSnapshots) {
    await restoreShipmentSnapshot(em, shipment)
  }

  for (const payment of paymentSnapshots) {
    await restorePaymentSnapshot(em, payment)
  }

  return order
}

const createQuoteCommand: CommandHandler<QuoteCreateInput, { quoteId: string }> = {
  id: 'sales.quotes.create',
  async execute(rawInput, ctx) {
    const generator = ctx.container.resolve('salesDocumentNumberGenerator') as SalesDocumentNumberGenerator
    const initial = quoteCreateSchema.parse(rawInput ?? {})
    const quoteNumber =
      typeof initial.quoteNumber === 'string' && initial.quoteNumber.trim().length
        ? initial.quoteNumber.trim()
        : (
            await generator.generate({
              kind: 'quote',
              organizationId: initial.organizationId,
              tenantId: initial.tenantId,
            })
          ).number
    const parsed = quoteCreateSchema.parse({ ...initial, quoteNumber })
    const ensuredQuoteNumber = parsed.quoteNumber ?? quoteNumber
    if (!ensuredQuoteNumber) {
      throw new CrudHttpError(400, { error: 'Quote number is required.' })
    }
    ensureQuoteScope(ctx, parsed.organizationId, parsed.tenantId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const {
      customerSnapshot: resolvedCustomerSnapshot,
      billingAddressSnapshot: resolvedBillingSnapshot,
      shippingAddressSnapshot: resolvedShippingSnapshot,
      shippingMethod,
      deliveryWindow,
      paymentMethod,
    } = await resolveDocumentReferences(em, parsed)
    const quoteStatus = await resolveDictionaryEntryValue(em, parsed.statusEntryId ?? null)
    const quote = em.create(SalesQuote, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      quoteNumber: ensuredQuoteNumber,
      statusEntryId: parsed.statusEntryId ?? null,
      status: quoteStatus,
      customerEntityId: parsed.customerEntityId ?? null,
      customerContactId: parsed.customerContactId ?? null,
      customerSnapshot: resolvedCustomerSnapshot ? cloneJson(resolvedCustomerSnapshot) : null,
      billingAddressId: parsed.billingAddressId ?? null,
      shippingAddressId: parsed.shippingAddressId ?? null,
      billingAddressSnapshot: resolvedBillingSnapshot ? cloneJson(resolvedBillingSnapshot) : null,
      shippingAddressSnapshot: resolvedShippingSnapshot ? cloneJson(resolvedShippingSnapshot) : null,
      currencyCode: parsed.currencyCode,
      validFrom: parsed.validFrom ?? null,
      validUntil: parsed.validUntil ?? null,
      comments: parsed.comments ?? null,
      taxInfo: parsed.taxInfo ? cloneJson(parsed.taxInfo) : null,
      shippingMethodId: parsed.shippingMethodId ?? null,
      shippingMethod: shippingMethod ?? null,
      shippingMethodCode: parsed.shippingMethodCode ?? shippingMethod?.code ?? null,
      deliveryWindowId: parsed.deliveryWindowId ?? null,
      deliveryWindow: deliveryWindow ?? null,
      deliveryWindowCode: parsed.deliveryWindowCode ?? deliveryWindow?.code ?? null,
      paymentMethodId: parsed.paymentMethodId ?? null,
      paymentMethod: paymentMethod ?? null,
      paymentMethodCode: parsed.paymentMethodCode ?? paymentMethod?.code ?? null,
      shippingMethodSnapshot: parsed.shippingMethodSnapshot
        ? cloneJson(parsed.shippingMethodSnapshot)
        : shippingMethod
          ? {
              id: shippingMethod.id,
              code: shippingMethod.code,
              name: shippingMethod.name,
              description: shippingMethod.description ?? null,
              carrierCode: shippingMethod.carrierCode ?? null,
              providerKey: shippingMethod.providerKey ?? null,
              serviceLevel: shippingMethod.serviceLevel ?? null,
              estimatedTransitDays: shippingMethod.estimatedTransitDays ?? null,
              baseRateNet: shippingMethod.baseRateNet,
              baseRateGross: shippingMethod.baseRateGross,
              currencyCode: shippingMethod.currencyCode ?? null,
              metadata: shippingMethod.metadata ? cloneJson(shippingMethod.metadata) : null,
              providerSettings:
                shippingMethod.metadata && typeof shippingMethod.metadata === 'object'
                  ? cloneJson(
                      (shippingMethod.metadata as Record<string, unknown>).providerSettings ?? null
                    )
                  : null,
            }
          : null,
      deliveryWindowSnapshot: parsed.deliveryWindowSnapshot
        ? cloneJson(parsed.deliveryWindowSnapshot)
        : deliveryWindow
          ? {
              id: deliveryWindow.id,
              code: deliveryWindow.code,
              name: deliveryWindow.name,
              description: deliveryWindow.description ?? null,
              leadTimeDays: deliveryWindow.leadTimeDays ?? null,
              cutoffTime: deliveryWindow.cutoffTime ?? null,
              timezone: deliveryWindow.timezone ?? null,
            }
          : null,
      paymentMethodSnapshot: parsed.paymentMethodSnapshot
        ? cloneJson(parsed.paymentMethodSnapshot)
        : paymentMethod
          ? {
              id: paymentMethod.id,
              code: paymentMethod.code,
              name: paymentMethod.name,
              description: paymentMethod.description ?? null,
              providerKey: paymentMethod.providerKey ?? null,
              terms: paymentMethod.terms ?? null,
              metadata: paymentMethod.metadata ? cloneJson(paymentMethod.metadata) : null,
              providerSettings:
                paymentMethod.metadata && typeof paymentMethod.metadata === 'object'
                  ? cloneJson(
                      (paymentMethod.metadata as Record<string, unknown>).providerSettings ?? null
                    )
                  : null,
          }
        : null,
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      channelId: parsed.channelId ?? null,
      customFieldSetId: parsed.customFieldSetId ?? null,
      subtotalNetAmount: '0',
      subtotalGrossAmount: '0',
      discountTotalAmount: '0',
      taxTotalAmount: '0',
      grandTotalNetAmount: '0',
      grandTotalGrossAmount: '0',
      lineItemCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(quote)

    const lineInputs = (parsed.lines ?? []).map((line, index) =>
      quoteLineCreateSchema.parse({
        ...line,
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
        quoteId: quote.id,
        lineNumber: line.lineNumber ?? index + 1,
      })
    )
    const adjustmentInputs = parsed.adjustments
      ? parsed.adjustments.map((adj) =>
          quoteAdjustmentCreateSchema.parse({
            ...adj,
            organizationId: parsed.organizationId,
            tenantId: parsed.tenantId,
            quoteId: quote.id,
          })
        )
      : null

    const lineSnapshots: SalesLineSnapshot[] = lineInputs.map((line, index) =>
      createLineSnapshotFromInput(line, line.lineNumber ?? index + 1)
    )
    const adjustmentDrafts: SalesAdjustmentDraft[] = adjustmentInputs
      ? adjustmentInputs.map((adj) => createAdjustmentDraftFromInput(adj))
      : []

    const salesCalculationService = ctx.container.resolve<SalesCalculationService>('salesCalculationService')
    const calculationContext = buildCalculationContext({
      tenantId: quote.tenantId,
      organizationId: quote.organizationId,
      currencyCode: quote.currencyCode,
      shippingSnapshot: quote.shippingMethodSnapshot,
      paymentSnapshot: quote.paymentMethodSnapshot,
      shippingMethodId: quote.shippingMethodId ?? null,
      paymentMethodId: quote.paymentMethodId ?? null,
      shippingMethodCode: quote.shippingMethodCode ?? null,
      paymentMethodCode: quote.paymentMethodCode ?? null,
    })
    const calculation = await salesCalculationService.calculateDocumentTotals({
      documentKind: 'quote',
      lines: lineSnapshots,
      adjustments: adjustmentDrafts,
      context: calculationContext,
    })

    await replaceQuoteLines(em, quote, calculation, lineInputs)
    await replaceQuoteAdjustments(em, quote, calculation, adjustmentInputs)
    applyQuoteTotals(quote, calculation.totals, calculation.lines.length)
    let eventBus: EventBus | null = null
    try {
      eventBus = ctx.container.resolve('eventBus') as EventBus
    } catch {
      eventBus = null
    }
    await emitTotalsCalculated(eventBus, {
      documentKind: 'quote',
      documentId: quote.id,
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      customerId: quote.customerEntityId ?? null,
      totals: calculation.totals,
      lineCount: calculation.lines.length,
    })
    await syncSalesDocumentTags(em, {
      documentId: quote.id,
      kind: 'quote',
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      tagIds: parsed.tags,
    })
    await em.flush()

    // Create notification for users with sales.quotes.manage feature
    try {
      const notificationService = resolveNotificationService(ctx.container)
      const typeDef = notificationTypes.find((type) => type.type === 'sales.quote.created')
      if (typeDef) {
        const totalAmount = quote.grandTotalGrossAmount && quote.currencyCode
          ? `${quote.grandTotalGrossAmount} ${quote.currencyCode}`
          : ''
        const totalDisplay = totalAmount ? ` (${totalAmount})` : ''
        const notificationInput = buildFeatureNotificationFromType(typeDef, {
          requiredFeature: 'sales.quotes.manage',
          bodyVariables: {
            quoteNumber: quote.quoteNumber,
            total: totalDisplay,
            totalAmount,
          },
          sourceEntityType: 'sales:quote',
          sourceEntityId: quote.id,
          linkHref: `/backend/sales/quotes/${quote.id}`,
        })

        await notificationService.createForFeature(notificationInput, {
          tenantId: quote.tenantId,
          organizationId: quote.organizationId ?? null,
        })
      }
    } catch (err) {
      // Notification creation is non-critical, don't fail the command
      console.error('[sales.quotes.create] Failed to create notification:', err)
    }

    // Emit CRUD side effects to trigger workflow event listeners
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: quote,
      identifiers: {
        id: quote.id,
        organizationId: quote.organizationId,
        tenantId: quote.tenantId,
      },
      events: quoteCrudEvents,
      indexer: { entityType: E.sales.sales_quote },
    })

    // Invalidate cache
    const resourceKind = deriveResourceFromCommandId(createQuoteCommand.id) ?? 'sales.quote'
    await invalidateCrudCache(
      ctx.container,
      resourceKind,
      { id: quote.id, organizationId: quote.organizationId, tenantId: quote.tenantId },
      ctx.auth?.tenantId ?? null,
      'created'
    )


    return { quoteId: quote.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadQuoteSnapshot(em, result.quoteId)
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as QuoteGraphSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.quotes.create', 'Create sales quote'),
      resourceKind: 'sales.quote',
      resourceId: result.quoteId,
      tenantId: after.quote.tenantId,
      organizationId: after.quote.organizationId,
      snapshotAfter: after,
      payload: {
        undo: {
          after,
        } satisfies QuoteUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<QuoteUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const quote = await em.findOne(SalesQuote, { id: after.quote.id })
    if (!quote) return
    ensureQuoteScope(ctx, quote.organizationId, quote.tenantId)
    await em.nativeDelete(SalesQuoteAdjustment, { quote: quote.id })
    await em.nativeDelete(SalesQuoteLine, { quote: quote.id })
    em.remove(quote)
    await em.flush()
  },
}

const deleteQuoteCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { quoteId: string }
> = {
  id: 'sales.quotes.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Quote id is required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadQuoteSnapshot(em, id)
    if (snapshot) {
      ensureQuoteScope(ctx, snapshot.quote.organizationId, snapshot.quote.tenantId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Quote id is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const quote = await em.findOne(SalesQuote, { id })
    if (!quote) throw new CrudHttpError(404, { error: 'Sales quote not found' })
    ensureQuoteScope(ctx, quote.organizationId, quote.tenantId)
    const [addresses, notes, tags, adjustments, lines] = await Promise.all([
      em.find(SalesDocumentAddress, { documentId: quote.id, documentKind: 'quote' }),
      em.find(SalesNote, { contextType: 'quote', contextId: quote.id }),
      em.find(SalesDocumentTagAssignment, { documentId: quote.id, documentKind: 'quote' }),
      em.find(SalesQuoteAdjustment, { quote: quote.id }),
      em.find(SalesQuoteLine, { quote: quote.id }),
    ])
    await em.nativeDelete(SalesDocumentAddress, { documentId: quote.id, documentKind: 'quote' })
    await em.nativeDelete(SalesNote, { contextType: 'quote', contextId: quote.id })
    await em.nativeDelete(SalesDocumentTagAssignment, { documentId: quote.id, documentKind: 'quote' })
    await em.nativeDelete(SalesQuoteAdjustment, { quote: quote.id })
    await em.nativeDelete(SalesQuoteLine, { quote: quote.id })
    em.remove(quote)
    await em.flush()
    const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')
    await Promise.all([
      queueDeletionSideEffects(dataEngine, quote, E.sales.sales_quote),
      queueDeletionSideEffects(dataEngine, lines, E.sales.sales_quote_line),
      queueDeletionSideEffects(dataEngine, adjustments, E.sales.sales_quote_adjustment),
      queueDeletionSideEffects(dataEngine, addresses, E.sales.sales_document_address),
      queueDeletionSideEffects(dataEngine, notes, E.sales.sales_note),
      queueDeletionSideEffects(dataEngine, tags, E.sales.sales_document_tag_assignment),
    ])
    return { quoteId: id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as QuoteGraphSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.quotes.delete', 'Delete sales quote'),
      resourceKind: 'sales.quote',
      resourceId: before.quote.id,
      tenantId: before.quote.tenantId,
      organizationId: before.quote.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies QuoteUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<QuoteUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    ensureQuoteScope(ctx, before.quote.organizationId, before.quote.tenantId)
    await restoreQuoteGraph(em, before)
    await em.flush()
  },
}

const updateQuoteCommand: CommandHandler<DocumentUpdateInput, { quote: SalesQuote }> = {
  id: 'sales.quotes.update',
  async prepare(input, ctx) {
    const parsed = documentUpdateSchema.parse(input ?? {})
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadQuoteSnapshot(em, parsed.id)
    if (snapshot) {
      ensureQuoteScope(ctx, snapshot.quote.organizationId, snapshot.quote.tenantId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = documentUpdateSchema.parse(rawInput ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const quote = await em.findOne(SalesQuote, { id: parsed.id, deletedAt: null })
    if (!quote) throw new CrudHttpError(404, { error: 'Sales quote not found' })
    ensureQuoteScope(ctx, quote.organizationId, quote.tenantId)
    const shouldInvalidateSentToken = (quote.status ?? null) === 'sent'
    if (shouldInvalidateSentToken) {
      quote.acceptanceToken = null
      quote.sentAt = null
    }
    const shouldRecalculateTotals =
      parsed.shippingMethodId !== undefined ||
      parsed.shippingMethodSnapshot !== undefined ||
      parsed.shippingMethodCode !== undefined ||
      parsed.paymentMethodId !== undefined ||
      parsed.paymentMethodSnapshot !== undefined ||
      parsed.paymentMethodCode !== undefined ||
      parsed.currencyCode !== undefined
    await applyDocumentUpdate({ kind: 'quote', entity: quote, input: parsed, em })
    await em.flush()
    if (shouldInvalidateSentToken) {
      quote.status = 'draft'
      quote.statusEntryId = await resolveStatusEntryIdByValue(em, {
        tenantId: quote.tenantId,
        organizationId: quote.organizationId,
        value: 'draft',
      })
    }
    if (shouldRecalculateTotals) {
      const [existingLines, adjustments] = await Promise.all([
        em.find(SalesQuoteLine, { quote }, { orderBy: { lineNumber: 'asc' } }),
        em.find(SalesQuoteAdjustment, { quote }, { orderBy: { position: 'asc' } }),
      ])
      const lineSnapshots = existingLines.map(mapQuoteLineEntityToSnapshot)
      const calcLines = lineSnapshots.map((line, index) =>
        createLineSnapshotFromInput(
          {
            ...line,
            organizationId: quote.organizationId,
            tenantId: quote.tenantId,
            quoteId: quote.id,
            lineNumber: line.lineNumber ?? index + 1,
            statusEntryId: (line as any).statusEntryId ?? null,
            catalogSnapshot: (line as any).catalogSnapshot ?? null,
            promotionSnapshot: (line as any).promotionSnapshot ?? null,
          },
          line.lineNumber ?? index + 1
        )
      )
      const adjustmentDrafts = adjustments.map(mapQuoteAdjustmentToDraft)
      const salesCalculationService = ctx.container.resolve<SalesCalculationService>('salesCalculationService')
      const calculationContext = buildCalculationContext({
        tenantId: quote.tenantId,
        organizationId: quote.organizationId,
        currencyCode: quote.currencyCode,
        shippingSnapshot: quote.shippingMethodSnapshot,
        paymentSnapshot: quote.paymentMethodSnapshot,
        shippingMethodId: quote.shippingMethodId ?? null,
        paymentMethodId: quote.paymentMethodId ?? null,
        shippingMethodCode: quote.shippingMethodCode ?? null,
        paymentMethodCode: quote.paymentMethodCode ?? null,
      })
      const calculation = await salesCalculationService.calculateDocumentTotals({
        documentKind: 'quote',
        lines: calcLines,
        adjustments: adjustmentDrafts,
        context: calculationContext,
      })
      const adjustmentInputs = adjustmentDrafts.map((adj, index) => ({
        organizationId: quote.organizationId,
        tenantId: quote.tenantId,
        quoteId: quote.id,
        scope: adj.scope ?? 'order',
        kind: adj.kind ?? 'custom',
        code: adj.code ?? undefined,
        label: adj.label ?? undefined,
        calculatorKey: adj.calculatorKey ?? undefined,
        promotionId: adj.promotionId ?? undefined,
        rate: adj.rate ?? undefined,
        amountNet: adj.amountNet ?? undefined,
        amountGross: adj.amountGross ?? undefined,
        currencyCode: adj.currencyCode ?? quote.currencyCode,
        metadata: adj.metadata ?? undefined,
        position: adj.position ?? index,
      }))
      await replaceQuoteAdjustments(em, quote, calculation, adjustmentInputs)
      applyQuoteTotals(quote, calculation.totals, calculation.lines.length)
      let eventBus: EventBus | null = null
      try {
        eventBus = ctx.container.resolve('eventBus') as EventBus
      } catch {
        eventBus = null
      }
      await emitTotalsCalculated(eventBus, {
        documentKind: 'quote',
        documentId: quote.id,
        organizationId: quote.organizationId,
        tenantId: quote.tenantId,
        customerId: quote.customerEntityId ?? null,
        totals: calculation.totals,
        lineCount: calculation.lines.length,
      })
    }
    quote.updatedAt = new Date()
    await em.flush()
    const resourceKind = deriveResourceFromCommandId(updateQuoteCommand.id) ?? 'sales.quote'
    await invalidateCrudCache(
      ctx.container,
      resourceKind,
      { id: quote.id, organizationId: quote.organizationId, tenantId: quote.tenantId },
      ctx.auth?.tenantId ?? null,
      'updated'
    )
    return { quote }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadQuoteSnapshot(em, result.quote.id)
  },
  buildLog: async ({ input, snapshots, result }) => {
    const parsed = documentUpdateSchema.parse(input ?? {})
    const before = snapshots.before as QuoteGraphSnapshot | undefined
    const after = snapshots.after as QuoteGraphSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    const changes = before
      ? buildChanges(
          before.quote as unknown as Record<string, unknown>,
          after.quote as unknown as Record<string, unknown>,
          buildQuoteUpdateChangeKeys(parsed)
        )
      : {}
    if (parsed.tags !== undefined) {
      const tagChange = buildTagChange(before?.tags, after.tags)
      if (tagChange) changes.tags = tagChange
    }
    return {
      actionLabel: translate('sales.audit.quotes.update', 'Update sales quote'),
      resourceKind: 'sales.quote',
      resourceId: result.quote.id,
      tenantId: after.quote.tenantId,
      organizationId: after.quote.organizationId,
      snapshotBefore: before ?? null,
      snapshotAfter: after,
      changes: Object.keys(changes).length ? changes : null,
      payload: {
        undo: {
          before,
          after,
        } satisfies QuoteUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<QuoteUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    ensureQuoteScope(ctx, before.quote.organizationId, before.quote.tenantId)
    await restoreQuoteGraph(em, before)
    await em.flush()
  },
}

const updateOrderCommand: CommandHandler<DocumentUpdateInput, { order: SalesOrder }> = {
  id: 'sales.orders.update',
  async prepare(input, ctx) {
    const parsed = documentUpdateSchema.parse(input ?? {})
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadOrderSnapshot(em, parsed.id)
    if (snapshot) {
      ensureOrderScope(ctx, snapshot.order.organizationId, snapshot.order.tenantId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = documentUpdateSchema.parse(rawInput ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const order = await em.findOne(SalesOrder, { id: parsed.id, deletedAt: null })
    if (!order) throw new CrudHttpError(404, { error: 'Sales order not found' })
    ensureOrderScope(ctx, order.organizationId, order.tenantId)
    const previousStatus = normalizeStatusValue(order.status)
    let statusChangeNote: SalesNote | null = null
    const shouldRecalculateTotals =
      parsed.shippingMethodId !== undefined ||
      parsed.shippingMethodSnapshot !== undefined ||
      parsed.shippingMethodCode !== undefined ||
      parsed.paymentMethodId !== undefined ||
      parsed.paymentMethodSnapshot !== undefined ||
      parsed.paymentMethodCode !== undefined ||
      parsed.currencyCode !== undefined
    await applyDocumentUpdate({ kind: 'order', entity: order, input: parsed, em })
    await em.flush()
    if (shouldRecalculateTotals) {
      const [existingLines, adjustments] = await Promise.all([
        em.find(SalesOrderLine, { order }, { orderBy: { lineNumber: 'asc' } }),
        em.find(SalesOrderAdjustment, { order }, { orderBy: { position: 'asc' } }),
      ])
      const lineSnapshots = existingLines.map(mapOrderLineEntityToSnapshot)
      const calcLines = lineSnapshots.map((line, index) =>
        createLineSnapshotFromInput(
          {
            ...line,
            organizationId: order.organizationId,
            tenantId: order.tenantId,
            orderId: order.id,
            lineNumber: line.lineNumber ?? index + 1,
            statusEntryId: (line as any).statusEntryId ?? null,
            catalogSnapshot: (line as any).catalogSnapshot ?? null,
            promotionSnapshot: (line as any).promotionSnapshot ?? null,
          },
          line.lineNumber ?? index + 1
        )
      )
      const adjustmentDrafts = adjustments.map(mapOrderAdjustmentToDraft)
      const salesCalculationService = ctx.container.resolve<SalesCalculationService>('salesCalculationService')
      const calculationContext = buildCalculationContext({
        tenantId: order.tenantId,
        organizationId: order.organizationId,
        currencyCode: order.currencyCode,
        shippingSnapshot: order.shippingMethodSnapshot,
        paymentSnapshot: order.paymentMethodSnapshot,
        shippingMethodId: order.shippingMethodId ?? null,
        paymentMethodId: order.paymentMethodId ?? null,
        shippingMethodCode: order.shippingMethodCode ?? null,
        paymentMethodCode: order.paymentMethodCode ?? null,
      })
      const calculation = await salesCalculationService.calculateDocumentTotals({
        documentKind: 'order',
        lines: calcLines,
        adjustments: adjustmentDrafts,
        context: calculationContext,
        existingTotals: resolveExistingPaymentTotals(order),
      })
      const adjustmentInputs = adjustmentDrafts.map((adj, index) => ({
        organizationId: order.organizationId,
        tenantId: order.tenantId,
        orderId: order.id,
        scope: adj.scope ?? 'order',
        kind: adj.kind ?? 'custom',
        code: adj.code ?? undefined,
        label: adj.label ?? undefined,
        calculatorKey: adj.calculatorKey ?? undefined,
        promotionId: adj.promotionId ?? undefined,
        rate: adj.rate ?? undefined,
        amountNet: adj.amountNet ?? undefined,
        amountGross: adj.amountGross ?? undefined,
        currencyCode: adj.currencyCode ?? order.currencyCode,
        metadata: adj.metadata ?? undefined,
        position: adj.position ?? index,
      }))
      await replaceOrderAdjustments(em, order, calculation, adjustmentInputs)
      applyOrderTotals(order, calculation.totals, calculation.lines.length)
      let eventBus: EventBus | null = null
      try {
        eventBus = ctx.container.resolve('eventBus') as EventBus
      } catch {
        eventBus = null
      }
      await emitTotalsCalculated(eventBus, {
        documentKind: 'order',
        documentId: order.id,
        organizationId: order.organizationId,
        tenantId: order.tenantId,
        customerId: order.customerEntityId ?? null,
        totals: calculation.totals,
        lineCount: calculation.lines.length,
      })
    }
    statusChangeNote = await appendOrderStatusChangeNote({
      em,
      order,
      previousStatus,
      auth: ctx.auth ?? null,
    })
    order.updatedAt = new Date()
    await em.flush()
    if (statusChangeNote) {
      const dataEngine = ctx.container.resolve('dataEngine')
      await emitCrudSideEffects({
        dataEngine,
        action: 'created',
        entity: statusChangeNote,
        identifiers: {
          id: statusChangeNote.id,
          organizationId: statusChangeNote.organizationId,
          tenantId: statusChangeNote.tenantId,
        },
        indexer: { entityType: E.sales.sales_note },
      })
    }
    const resourceKind = deriveResourceFromCommandId(updateOrderCommand.id) ?? 'sales.order'
    await invalidateCrudCache(
      ctx.container,
      resourceKind,
      { id: order.id, organizationId: order.organizationId, tenantId: order.tenantId },
      ctx.auth?.tenantId ?? null,
      'updated'
    )
    return { order }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadOrderSnapshot(em, result.order.id)
  },
  buildLog: async ({ input, snapshots, result }) => {
    const parsed = documentUpdateSchema.parse(input ?? {})
    const before = snapshots.before as OrderGraphSnapshot | undefined
    const after = snapshots.after as OrderGraphSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    const changes = before
      ? buildChanges(
          before.order as unknown as Record<string, unknown>,
          after.order as unknown as Record<string, unknown>,
          buildOrderUpdateChangeKeys(parsed)
        )
      : {}
    if (parsed.tags !== undefined) {
      const tagChange = buildTagChange(before?.tags, after.tags)
      if (tagChange) changes.tags = tagChange
    }
    return {
      actionLabel: translate('sales.audit.orders.update', 'Update sales order'),
      resourceKind: 'sales.order',
      resourceId: result.order.id,
      tenantId: after.order.tenantId,
      organizationId: after.order.organizationId,
      snapshotBefore: before ?? null,
      snapshotAfter: after,
      changes: Object.keys(changes).length ? changes : null,
      payload: {
        undo: {
          before,
          after,
        } satisfies OrderUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OrderUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    ensureOrderScope(ctx, before.order.organizationId, before.order.tenantId)
    await restoreOrderGraph(em, before)
    await em.flush()
  },
}

const createOrderCommand: CommandHandler<OrderCreateInput, { orderId: string }> = {
  id: 'sales.orders.create',
  async execute(rawInput, ctx) {
    const generator = ctx.container.resolve('salesDocumentNumberGenerator') as SalesDocumentNumberGenerator
    const initial = orderCreateSchema.parse(rawInput ?? {})
    const orderNumber =
      typeof initial.orderNumber === 'string' && initial.orderNumber.trim().length
        ? initial.orderNumber.trim()
        : (
            await generator.generate({
              kind: 'order',
              organizationId: initial.organizationId,
              tenantId: initial.tenantId,
            })
          ).number
    const parsed = orderCreateSchema.parse({ ...initial, orderNumber })
    const ensuredOrderNumber = parsed.orderNumber ?? orderNumber
    if (!ensuredOrderNumber) {
      throw new CrudHttpError(400, { error: 'Order number is required.' })
    }
    ensureOrderScope(ctx, parsed.organizationId, parsed.tenantId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const [status, fulfillmentStatus, paymentStatus] = await Promise.all([
      resolveDictionaryEntryValue(em, parsed.statusEntryId ?? null),
      resolveDictionaryEntryValue(em, parsed.fulfillmentStatusEntryId ?? null),
      resolveDictionaryEntryValue(em, parsed.paymentStatusEntryId ?? null),
    ])
    const {
      customerSnapshot: resolvedCustomerSnapshot,
      billingAddressSnapshot: resolvedBillingSnapshot,
      shippingAddressSnapshot: resolvedShippingSnapshot,
      shippingMethod,
      deliveryWindow,
      paymentMethod,
    } = await resolveDocumentReferences(em, parsed)

    const order = em.create(SalesOrder, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      orderNumber: ensuredOrderNumber,
      statusEntryId: parsed.statusEntryId ?? null,
      status,
      fulfillmentStatusEntryId: parsed.fulfillmentStatusEntryId ?? null,
      fulfillmentStatus,
      paymentStatusEntryId: parsed.paymentStatusEntryId ?? null,
      paymentStatus,
      customerEntityId: parsed.customerEntityId ?? null,
      customerContactId: parsed.customerContactId ?? null,
      customerSnapshot: resolvedCustomerSnapshot ? cloneJson(resolvedCustomerSnapshot) : null,
      billingAddressId: parsed.billingAddressId ?? null,
      shippingAddressId: parsed.shippingAddressId ?? null,
      billingAddressSnapshot: resolvedBillingSnapshot ? cloneJson(resolvedBillingSnapshot) : null,
      shippingAddressSnapshot: resolvedShippingSnapshot ? cloneJson(resolvedShippingSnapshot) : null,
      currencyCode: parsed.currencyCode,
      exchangeRate:
        typeof parsed.exchangeRate === 'number' ? toNumericString(parsed.exchangeRate) : null,
      taxStrategyKey: parsed.taxStrategyKey ?? null,
      discountStrategyKey: parsed.discountStrategyKey ?? null,
      taxInfo: parsed.taxInfo ? cloneJson(parsed.taxInfo) : null,
      shippingMethodId: parsed.shippingMethodId ?? null,
      shippingMethod: shippingMethod ?? null,
      shippingMethodCode: parsed.shippingMethodCode ?? shippingMethod?.code ?? null,
      deliveryWindowId: parsed.deliveryWindowId ?? null,
      deliveryWindow: deliveryWindow ?? null,
      deliveryWindowCode: parsed.deliveryWindowCode ?? deliveryWindow?.code ?? null,
      paymentMethodId: parsed.paymentMethodId ?? null,
      paymentMethod: paymentMethod ?? null,
      paymentMethodCode: parsed.paymentMethodCode ?? paymentMethod?.code ?? null,
      channelId: parsed.channelId ?? null,
      placedAt: parsed.placedAt ?? null,
      expectedDeliveryAt: parsed.expectedDeliveryAt ?? null,
      dueAt: parsed.dueAt ?? null,
      comments: parsed.comments ?? null,
      internalNotes: parsed.internalNotes ?? null,
      shippingMethodSnapshot: parsed.shippingMethodSnapshot
        ? cloneJson(parsed.shippingMethodSnapshot)
        : shippingMethod
          ? {
              id: shippingMethod.id,
              code: shippingMethod.code,
              name: shippingMethod.name,
              description: shippingMethod.description ?? null,
              carrierCode: shippingMethod.carrierCode ?? null,
              providerKey: shippingMethod.providerKey ?? null,
              serviceLevel: shippingMethod.serviceLevel ?? null,
              estimatedTransitDays: shippingMethod.estimatedTransitDays ?? null,
              baseRateNet: shippingMethod.baseRateNet,
              baseRateGross: shippingMethod.baseRateGross,
              currencyCode: shippingMethod.currencyCode ?? null,
              metadata: shippingMethod.metadata ? cloneJson(shippingMethod.metadata) : null,
              providerSettings:
                shippingMethod.metadata && typeof shippingMethod.metadata === 'object'
                  ? cloneJson(
                      (shippingMethod.metadata as Record<string, unknown>).providerSettings ?? null
                    )
                  : null,
            }
          : null,
      deliveryWindowSnapshot: parsed.deliveryWindowSnapshot
        ? cloneJson(parsed.deliveryWindowSnapshot)
        : deliveryWindow
          ? {
              id: deliveryWindow.id,
              code: deliveryWindow.code,
              name: deliveryWindow.name,
              description: deliveryWindow.description ?? null,
              leadTimeDays: deliveryWindow.leadTimeDays ?? null,
              cutoffTime: deliveryWindow.cutoffTime ?? null,
              timezone: deliveryWindow.timezone ?? null,
            }
          : null,
      paymentMethodSnapshot: parsed.paymentMethodSnapshot
        ? cloneJson(parsed.paymentMethodSnapshot)
        : paymentMethod
          ? {
              id: paymentMethod.id,
              code: paymentMethod.code,
              name: paymentMethod.name,
              description: paymentMethod.description ?? null,
              providerKey: paymentMethod.providerKey ?? null,
              terms: paymentMethod.terms ?? null,
              metadata: paymentMethod.metadata ? cloneJson(paymentMethod.metadata) : null,
              providerSettings:
                paymentMethod.metadata && typeof paymentMethod.metadata === 'object'
                  ? cloneJson(
                      (paymentMethod.metadata as Record<string, unknown>).providerSettings ?? null
                    )
                  : null,
            }
          : null,
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      customFieldSetId: parsed.customFieldSetId ?? null,
      subtotalNetAmount: '0',
      subtotalGrossAmount: '0',
      discountTotalAmount: '0',
      taxTotalAmount: '0',
      shippingNetAmount: '0',
      shippingGrossAmount: '0',
      surchargeTotalAmount: '0',
      grandTotalNetAmount: '0',
      grandTotalGrossAmount: '0',
      paidTotalAmount: '0',
      refundedTotalAmount: '0',
      outstandingAmount: '0',
      lineItemCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(order)

    const lineInputs = (parsed.lines ?? []).map((line, index) =>
      orderLineCreateSchema.parse({
        ...line,
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
        orderId: order.id,
        lineNumber: line.lineNumber ?? index + 1,
      })
    )
    const adjustmentInputs = parsed.adjustments
      ? parsed.adjustments.map((adj) =>
          orderAdjustmentCreateSchema.parse({
            ...adj,
            organizationId: parsed.organizationId,
            tenantId: parsed.tenantId,
            orderId: order.id,
          })
        )
      : null

    const lineSnapshots: SalesLineSnapshot[] = lineInputs.map((line, index) =>
      createLineSnapshotFromInput(line, line.lineNumber ?? index + 1)
    )
    const adjustmentDrafts: SalesAdjustmentDraft[] = adjustmentInputs
      ? adjustmentInputs.map((adj) => createAdjustmentDraftFromInput(adj))
      : []

    const salesCalculationService = ctx.container.resolve<SalesCalculationService>('salesCalculationService')
    const calculationContext = buildCalculationContext({
      tenantId: order.tenantId,
      organizationId: order.organizationId,
      currencyCode: order.currencyCode,
      shippingSnapshot: order.shippingMethodSnapshot,
      paymentSnapshot: order.paymentMethodSnapshot,
      shippingMethodId: order.shippingMethodId ?? null,
      paymentMethodId: order.paymentMethodId ?? null,
      shippingMethodCode: order.shippingMethodCode ?? null,
      paymentMethodCode: order.paymentMethodCode ?? null,
    })
    const calculation = await salesCalculationService.calculateDocumentTotals({
      documentKind: 'order',
      lines: lineSnapshots,
      adjustments: adjustmentDrafts,
      context: calculationContext,
      existingTotals: resolveExistingPaymentTotals(order),
    })

    await replaceOrderLines(em, order, calculation, lineInputs)
    await replaceOrderAdjustments(em, order, calculation, adjustmentInputs)
    applyOrderTotals(order, calculation.totals, calculation.lines.length)
    let eventBus: EventBus | null = null
    try {
      eventBus = ctx.container.resolve('eventBus') as EventBus
    } catch {
      eventBus = null
    }
    await emitTotalsCalculated(eventBus, {
      documentKind: 'order',
      documentId: order.id,
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      customerId: order.customerEntityId ?? null,
      totals: calculation.totals,
      lineCount: calculation.lines.length,
    })
    await syncSalesDocumentTags(em, {
      documentId: order.id,
      kind: 'order',
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      tagIds: parsed.tags,
    })
    await em.flush()

    // Create notification for users with sales.orders.manage feature
    try {
      const notificationService = resolveNotificationService(ctx.container)
      const typeDef = notificationTypes.find((type) => type.type === 'sales.order.created')
      if (typeDef) {
        const totalAmount = order.grandTotalGrossAmount && order.currencyCode
          ? `${order.grandTotalGrossAmount} ${order.currencyCode}`
          : ''
        const totalDisplay = totalAmount ? ` (${totalAmount})` : ''
        const notificationInput = buildFeatureNotificationFromType(typeDef, {
          requiredFeature: 'sales.orders.manage',
          bodyVariables: {
            orderNumber: order.orderNumber,
            total: totalDisplay,
            totalAmount,
          },
          sourceEntityType: 'sales:order',
          sourceEntityId: order.id,
          linkHref: `/backend/sales/orders/${order.id}`,
        })

        await notificationService.createForFeature(notificationInput, {
          tenantId: order.tenantId,
          organizationId: order.organizationId ?? null,
        })
      }
    } catch (err) {
      // Notification creation is non-critical, don't fail the command
      console.error('[sales.orders.create] Failed to create notification:', err)
    }

    // Emit CRUD side effects to trigger workflow event listeners
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: order,
      identifiers: {
        id: order.id,
        organizationId: order.organizationId,
        tenantId: order.tenantId,
      },
      events: orderCrudEvents,
      indexer: { entityType: E.sales.sales_order },
    })

    // Invalidate cache
    const resourceKind = deriveResourceFromCommandId(createOrderCommand.id) ?? 'sales.order'
    await invalidateCrudCache(
      ctx.container,
      resourceKind,
      { id: order.id, organizationId: order.organizationId, tenantId: order.tenantId },
      ctx.auth?.tenantId ?? null,
      'created'
    )

    return { orderId: order.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadOrderSnapshot(em, result.orderId)
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as OrderGraphSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.orders.create', 'Create sales order'),
      resourceKind: 'sales.order',
      resourceId: result.orderId,
      tenantId: after.order.tenantId,
      organizationId: after.order.organizationId,
      snapshotAfter: after,
      payload: {
        undo: {
          after,
        } satisfies OrderUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OrderUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const order = await em.findOne(SalesOrder, { id: after.order.id })
    if (!order) return
    ensureOrderScope(ctx, order.organizationId, order.tenantId)
    await em.nativeDelete(SalesOrderAdjustment, { order: order.id })
    await em.nativeDelete(SalesOrderLine, { order: order.id })
    em.remove(order)
    await em.flush()
  },
}

const deleteOrderCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { orderId: string }
> = {
  id: 'sales.orders.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Order id is required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadOrderSnapshot(em, id)
    if (snapshot) {
      ensureOrderScope(ctx, snapshot.order.organizationId, snapshot.order.tenantId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Order id is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const order = await em.findOne(SalesOrder, { id })
    if (!order) throw new CrudHttpError(404, { error: 'Sales order not found' })
    ensureOrderScope(ctx, order.organizationId, order.tenantId)
    const shipments = await em.find(SalesShipment, { order: order.id })
    const shipmentIds = shipments.map((entry) => entry.id)
    const [shipmentItems, payments, paymentAllocations, addresses, notes, tags, adjustments, lines] = await Promise.all([
      shipmentIds.length ? em.find(SalesShipmentItem, { shipment: { $in: shipmentIds } }) : Promise.resolve([]),
      em.find(SalesPayment, { order: order.id }),
      em.find(SalesPaymentAllocation, { order: order.id }),
      em.find(SalesDocumentAddress, { documentId: order.id, documentKind: 'order' }),
      em.find(SalesNote, { contextType: 'order', contextId: order.id }),
      em.find(SalesDocumentTagAssignment, { documentId: order.id, documentKind: 'order' }),
      em.find(SalesOrderAdjustment, { order: order.id }),
      em.find(SalesOrderLine, { order: order.id }),
    ])
    if (shipmentIds.length) {
      await em.nativeDelete(SalesShipmentItem, { shipment: { $in: shipmentIds } })
      await em.nativeDelete(SalesShipment, { id: { $in: shipmentIds } })
    }
    await em.nativeDelete(SalesPaymentAllocation, { order: order.id })
    await em.nativeDelete(SalesPayment, { order: order.id })
    await em.nativeDelete(SalesDocumentAddress, { documentId: order.id, documentKind: 'order' })
    await em.nativeDelete(SalesNote, { contextType: 'order', contextId: order.id })
    await em.nativeDelete(SalesDocumentTagAssignment, { documentId: order.id, documentKind: 'order' })
    await em.nativeDelete(SalesOrderAdjustment, { order: order.id })
    await em.nativeDelete(SalesOrderLine, { order: order.id })
    em.remove(order)
    await em.flush()
    const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')
    await Promise.all([
      queueDeletionSideEffects(dataEngine, order, E.sales.sales_order),
      queueDeletionSideEffects(dataEngine, lines, E.sales.sales_order_line),
      queueDeletionSideEffects(dataEngine, adjustments, E.sales.sales_order_adjustment),
      queueDeletionSideEffects(dataEngine, shipments, E.sales.sales_shipment),
      queueDeletionSideEffects(dataEngine, shipmentItems, E.sales.sales_shipment_item),
      queueDeletionSideEffects(dataEngine, payments, E.sales.sales_payment),
      queueDeletionSideEffects(dataEngine, paymentAllocations, E.sales.sales_payment_allocation),
      queueDeletionSideEffects(dataEngine, addresses, E.sales.sales_document_address),
      queueDeletionSideEffects(dataEngine, notes, E.sales.sales_note),
      queueDeletionSideEffects(dataEngine, tags, E.sales.sales_document_tag_assignment),
    ])
    return { orderId: id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as OrderGraphSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.orders.delete', 'Delete sales order'),
      resourceKind: 'sales.order',
      resourceId: before.order.id,
      tenantId: before.order.tenantId,
      organizationId: before.order.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies OrderUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OrderUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    ensureOrderScope(ctx, before.order.organizationId, before.order.tenantId)
    await restoreOrderGraph(em, before)
    await em.flush()
  },
}

const quoteConvertToOrderSchema = z.object({
  quoteId: z.string().uuid(),
  orderId: z.string().uuid().optional(),
  orderNumber: z.string().trim().max(191).optional(),
})

const convertQuoteToOrderCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { orderId: string }
> = {
  id: 'sales.quotes.convert_to_order',
  async prepare(input, ctx) {
    const parsed = quoteConvertToOrderSchema.safeParse(input ?? {})
    const quoteId = parsed.success ? parsed.data.quoteId : typeof (input as any)?.quoteId === 'string' ? (input as any).quoteId : null
    if (!quoteId) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadQuoteSnapshot(em, quoteId)
    if (snapshot) ensureQuoteScope(ctx, snapshot.quote.organizationId, snapshot.quote.tenantId)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const payload = quoteConvertToOrderSchema.parse(rawInput ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const quote = await em.findOne(SalesQuote, { id: payload.quoteId, deletedAt: null })
    const { translate } = await resolveTranslations()
    if (!quote) throw new CrudHttpError(404, { error: translate('sales.documents.detail.error', 'Document not found or inaccessible.') })
    ensureQuoteScope(ctx, quote.organizationId, quote.tenantId)
    const snapshot = await loadQuoteSnapshot(em, payload.quoteId)
    if (!snapshot) throw new CrudHttpError(404, { error: translate('sales.documents.detail.error', 'Document not found or inaccessible.') })
    const orderId = payload.orderId ?? quote.id
    const existingOrder = await em.findOne(SalesOrder, { id: orderId, deletedAt: null })
    if (existingOrder) {
      throw new CrudHttpError(409, { error: translate('sales.documents.detail.convertExists', 'Order already exists for this quote.') })
    }

    const generator = ctx.container.resolve('salesDocumentNumberGenerator') as SalesDocumentNumberGenerator
    const generatedNumber =
      snapshot.quote.quoteNumber && snapshot.quote.quoteNumber.trim().length
        ? snapshot.quote.quoteNumber
        : (
            await generator.generate({
              kind: 'order',
              organizationId: snapshot.quote.organizationId,
              tenantId: snapshot.quote.tenantId,
            })
          ).number
    const orderNumber =
      typeof payload.orderNumber === 'string' && payload.orderNumber.trim().length
        ? payload.orderNumber.trim()
        : generatedNumber

    const [quoteCustomFields, quoteLineCustomFields] = await Promise.all([
      loadCustomFieldValues({
        em,
        entityId: E.sales.sales_quote,
        recordIds: [snapshot.quote.id],
        tenantIdByRecord: { [snapshot.quote.id]: snapshot.quote.tenantId },
        organizationIdByRecord: { [snapshot.quote.id]: snapshot.quote.organizationId },
      }),
      snapshot.lines.length
        ? loadCustomFieldValues({
            em,
            entityId: E.sales.sales_quote_line,
            recordIds: snapshot.lines.map((line) => line.id),
            tenantIdByRecord: Object.fromEntries(snapshot.lines.map((line) => [line.id, snapshot.quote.tenantId])),
            organizationIdByRecord: Object.fromEntries(snapshot.lines.map((line) => [line.id, snapshot.quote.organizationId])),
          })
        : Promise.resolve({}),
    ])

    const order = em.create(SalesOrder, {
      id: orderId,
      organizationId: snapshot.quote.organizationId,
      tenantId: snapshot.quote.tenantId,
      orderNumber,
      statusEntryId: snapshot.quote.statusEntryId ?? null,
      status: snapshot.quote.status ?? null,
      fulfillmentStatusEntryId: null,
      fulfillmentStatus: null,
      paymentStatusEntryId: null,
      paymentStatus: null,
      customerEntityId: snapshot.quote.customerEntityId ?? null,
      customerContactId: snapshot.quote.customerContactId ?? null,
      customerSnapshot: snapshot.quote.customerSnapshot ? cloneJson(snapshot.quote.customerSnapshot) : null,
      billingAddressId: snapshot.quote.billingAddressId ?? null,
      shippingAddressId: snapshot.quote.shippingAddressId ?? null,
      billingAddressSnapshot: snapshot.quote.billingAddressSnapshot ? cloneJson(snapshot.quote.billingAddressSnapshot) : null,
      shippingAddressSnapshot: snapshot.quote.shippingAddressSnapshot ? cloneJson(snapshot.quote.shippingAddressSnapshot) : null,
      currencyCode: snapshot.quote.currencyCode,
      exchangeRate: null,
      taxStrategyKey: null,
      discountStrategyKey: null,
      taxInfo: snapshot.quote.taxInfo ? cloneJson(snapshot.quote.taxInfo) : null,
      shippingMethodId: snapshot.quote.shippingMethodId ?? null,
      shippingMethodCode: snapshot.quote.shippingMethodCode ?? null,
      deliveryWindowId: snapshot.quote.deliveryWindowId ?? null,
      deliveryWindowCode: snapshot.quote.deliveryWindowCode ?? null,
      paymentMethodId: snapshot.quote.paymentMethodId ?? null,
      paymentMethodCode: snapshot.quote.paymentMethodCode ?? null,
      channelId: snapshot.quote.channelId ?? null,
      placedAt: snapshot.quote.validFrom ? new Date(snapshot.quote.validFrom) : quote.createdAt,
      expectedDeliveryAt: snapshot.quote.validUntil ? new Date(snapshot.quote.validUntil) : null,
      dueAt: null,
      comments: snapshot.quote.comments ?? null,
      internalNotes: null,
      shippingMethodSnapshot: snapshot.quote.shippingMethodSnapshot ? cloneJson(snapshot.quote.shippingMethodSnapshot) : null,
      deliveryWindowSnapshot: snapshot.quote.deliveryWindowSnapshot ? cloneJson(snapshot.quote.deliveryWindowSnapshot) : null,
      paymentMethodSnapshot: snapshot.quote.paymentMethodSnapshot ? cloneJson(snapshot.quote.paymentMethodSnapshot) : null,
      metadata: snapshot.quote.metadata ? cloneJson(snapshot.quote.metadata) : null,
      customFieldSetId: snapshot.quote.customFieldSetId ?? null,
      subtotalNetAmount: snapshot.quote.subtotalNetAmount,
      subtotalGrossAmount: snapshot.quote.subtotalGrossAmount,
      discountTotalAmount: snapshot.quote.discountTotalAmount,
      taxTotalAmount: snapshot.quote.taxTotalAmount,
      shippingNetAmount: '0',
      shippingGrossAmount: '0',
      surchargeTotalAmount: '0',
      grandTotalNetAmount: snapshot.quote.grandTotalNetAmount,
      grandTotalGrossAmount: snapshot.quote.grandTotalGrossAmount,
      paidTotalAmount: '0',
      refundedTotalAmount: '0',
      outstandingAmount: snapshot.quote.grandTotalGrossAmount,
      totalsSnapshot: snapshot.quote.totalsSnapshot ? cloneJson(snapshot.quote.totalsSnapshot) : null,
      lineItemCount: snapshot.quote.lineItemCount,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(order)

    const orderLineMap = new Map<string, SalesOrderLine>()
    snapshot.lines.forEach((line, index) => {
      const orderLine = em.create(SalesOrderLine, {
        id: line.id,
        order,
        organizationId: snapshot.quote.organizationId,
        tenantId: snapshot.quote.tenantId,
        lineNumber: line.lineNumber ?? index + 1,
        kind: line.kind as SalesLineKind,
        statusEntryId: (line as any).statusEntryId ?? null,
        status: (line as any).status ?? null,
        productId: line.productId ?? null,
        productVariantId: line.productVariantId ?? null,
        catalogSnapshot: line.catalogSnapshot ? cloneJson(line.catalogSnapshot) : null,
        name: line.name ?? null,
        description: line.description ?? null,
        comment: line.comment ?? null,
        quantity: line.quantity,
        quantityUnit: line.quantityUnit ?? null,
        reservedQuantity: '0',
        fulfilledQuantity: '0',
        invoicedQuantity: '0',
        returnedQuantity: '0',
        currencyCode: line.currencyCode,
        unitPriceNet: line.unitPriceNet,
        unitPriceGross: line.unitPriceGross,
        discountAmount: line.discountAmount,
        discountPercent: line.discountPercent,
        taxRate: line.taxRate,
        taxAmount: line.taxAmount,
        totalNetAmount: line.totalNetAmount,
        totalGrossAmount: line.totalGrossAmount,
        configuration: line.configuration ? cloneJson(line.configuration) : null,
        promotionCode: line.promotionCode ?? null,
        promotionSnapshot: line.promotionSnapshot ? cloneJson(line.promotionSnapshot) : null,
        metadata: line.metadata ? cloneJson(line.metadata) : null,
        customFieldSetId: line.customFieldSetId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(orderLine)
      orderLineMap.set(orderLine.id, orderLine)
    })

    snapshot.adjustments.forEach((adj, index) => {
      const orderLineId = adj.quoteLineId ?? null
      const orderLine = orderLineId ? orderLineMap.get(orderLineId) ?? null : null
      const entity = em.create(SalesOrderAdjustment, {
        id: adj.id,
        order,
        orderLine: orderLine ?? null,
        organizationId: snapshot.quote.organizationId,
        tenantId: snapshot.quote.tenantId,
        scope: adj.scope,
        kind: adj.kind as SalesAdjustmentKind,
        code: adj.code ?? null,
        label: adj.label ?? null,
        calculatorKey: adj.calculatorKey ?? null,
        promotionId: adj.promotionId ?? null,
        rate: adj.rate,
        amountNet: adj.amountNet,
        amountGross: adj.amountGross,
        currencyCode: adj.currencyCode ?? null,
        metadata: adj.metadata ? cloneJson(adj.metadata) : null,
        position: adj.position ?? index,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(entity)
    })

    const [addresses, notes, tags] = await Promise.all([
      em.find(SalesDocumentAddress, { documentId: snapshot.quote.id, documentKind: 'quote' }),
      em.find(SalesNote, { contextType: 'quote', contextId: snapshot.quote.id }),
      em.find(SalesDocumentTagAssignment, { documentId: snapshot.quote.id, documentKind: 'quote' }),
    ])
    addresses.forEach((entry) => {
      entry.documentKind = 'order'
      entry.documentId = order.id
      entry.order = order
      entry.quote = null
      entry.updatedAt = new Date()
    })
    notes.forEach((note) => {
      note.contextType = 'order'
      note.contextId = order.id
      note.order = order
      note.quote = null
      note.updatedAt = new Date()
    })
    tags.forEach((assignment) => {
      assignment.documentKind = 'order'
      assignment.documentId = order.id
      assignment.order = order
      assignment.quote = null
      assignment.updatedAt = new Date()
    })

    const documentCustomValues = quoteCustomFields[snapshot.quote.id]
    if (documentCustomValues && Object.keys(documentCustomValues).length) {
      await setRecordCustomFields(em, {
        entityId: E.sales.sales_order,
        recordId: order.id,
        organizationId: snapshot.quote.organizationId,
        tenantId: snapshot.quote.tenantId,
        values: documentCustomValues,
      })
    }
    const lineCustomEntries = quoteLineCustomFields as Record<string, Record<string, unknown>>
    if (lineCustomEntries && Object.keys(lineCustomEntries).length) {
      for (const [lineId, values] of Object.entries(lineCustomEntries)) {
        if (!values || !Object.keys(values).length) continue
        if (!orderLineMap.has(lineId)) continue
        await setRecordCustomFields(em, {
          entityId: E.sales.sales_order_line,
          recordId: lineId,
          organizationId: snapshot.quote.organizationId,
          tenantId: snapshot.quote.tenantId,
          values,
        })
      }
    }

    await em.nativeDelete(SalesQuoteAdjustment, { quote: snapshot.quote.id })
    await em.nativeDelete(SalesQuoteLine, { quote: snapshot.quote.id })
    em.remove(quote)
    await em.flush()

    return { orderId: order.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadOrderSnapshot(em, result.orderId)
  },
  buildLog: async ({ snapshots, result }) => {
    const before = snapshots.before as QuoteGraphSnapshot | undefined
    const after = snapshots.after as OrderGraphSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.quotes.convert', 'Convert quote to order'),
      resourceKind: 'sales.order',
      resourceId: result.orderId,
      tenantId: before.quote.tenantId,
      organizationId: before.quote.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      payload: {
        undo: { quote: before, order: after ?? null } satisfies QuoteConvertUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<QuoteConvertUndoPayload>(logEntry)
    const quoteSnapshot = payload?.quote
    const orderSnapshot = payload?.order
    if (!quoteSnapshot) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    ensureQuoteScope(ctx, quoteSnapshot.quote.organizationId, quoteSnapshot.quote.tenantId)
    if (orderSnapshot) {
      const orderId = orderSnapshot.order.id
      const orderLineIds = orderSnapshot.lines.map((line) => line.id)
      const existingOrder = await em.findOne(SalesOrder, { id: orderId })
      if (existingOrder) {
        const shipments = await em.find(SalesShipment, { order: orderId })
        const shipmentIds = shipments.map((entry) => entry.id)
        if (shipmentIds.length) {
          await em.nativeDelete(SalesShipmentItem, { shipment: { $in: shipmentIds } })
          await em.nativeDelete(SalesShipment, { id: { $in: shipmentIds } })
        }
        await em.nativeDelete(SalesPaymentAllocation, { order: orderId })
        await em.nativeDelete(SalesPayment, { order: orderId })
        await em.nativeDelete(SalesDocumentAddress, { documentId: orderId, documentKind: 'order' })
        await em.nativeDelete(SalesDocumentTagAssignment, { documentId: orderId, documentKind: 'order' })
        await em.nativeDelete(SalesOrderAdjustment, { order: orderId })
        await em.nativeDelete(SalesOrderLine, { order: orderId })
        em.remove(existingOrder)
      }
      await em.nativeDelete(CustomFieldValue, { entityId: E.sales.sales_order, recordId: orderId })
      if (orderLineIds.length) {
        await em.nativeDelete(CustomFieldValue, { entityId: E.sales.sales_order_line, recordId: { $in: orderLineIds } as any })
      }
    }
    const noteIds = quoteSnapshot.notes.map((note) => note.id)
    if (noteIds.length) {
      await em.nativeDelete(SalesNote, { id: { $in: noteIds } })
    }
    await restoreQuoteGraph(em, quoteSnapshot)
    await em.flush()
  },
}

const orderLineUpsertSchema = orderLineCreateSchema.extend({ id: z.string().uuid().optional() })

const orderLineDeleteSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
})

const quoteLineUpsertSchema = quoteLineCreateSchema.extend({ id: z.string().uuid().optional() })

const quoteLineDeleteSchema = z.object({
  id: z.string().uuid(),
  quoteId: z.string().uuid(),
})

const orderAdjustmentUpsertSchema = orderAdjustmentCreateSchema.extend({ id: z.string().uuid().optional() })

const orderAdjustmentDeleteSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
})

const quoteAdjustmentUpsertSchema = quoteAdjustmentCreateSchema.extend({ id: z.string().uuid().optional() })

const quoteAdjustmentDeleteSchema = z.object({
  id: z.string().uuid(),
  quoteId: z.string().uuid(),
})

const orderLineUpsertCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { orderId: string; lineId: string }
> = {
  id: 'sales.orders.lines.upsert',
  async prepare(input, ctx) {
    const raw = (input?.body as Record<string, unknown> | undefined) ?? {}
    const orderId = typeof raw.orderId === 'string' ? raw.orderId : null
    if (!orderId) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadOrderSnapshot(em, orderId)
    if (snapshot) ensureOrderScope(ctx, snapshot.order.organizationId, snapshot.order.tenantId)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const parsed = orderLineUpsertSchema.parse((input?.body as Record<string, unknown> | undefined) ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const order = await em.findOne(SalesOrder, { id: parsed.orderId, deletedAt: null })
    if (!order) throw new CrudHttpError(404, { error: 'Sales order not found' })
    ensureOrderScope(ctx, order.organizationId, order.tenantId)

    const [existingLines, adjustments] = await Promise.all([
      em.find(SalesOrderLine, { order }, { orderBy: { lineNumber: 'asc' } }),
      em.find(SalesOrderAdjustment, { order }, { orderBy: { position: 'asc' } }),
    ])
    const lineSnapshots = existingLines.map(mapOrderLineEntityToSnapshot)
    const existingSnapshot = parsed.id ? lineSnapshots.find((line) => line.id === parsed.id) ?? null : null
    const priceMode = parsed.priceMode === 'gross' ? 'gross' : parsed.priceMode === 'net' ? 'net' : null
    let unitPriceNet = parsed.unitPriceNet ?? existingSnapshot?.unitPriceNet ?? null
    let unitPriceGross = parsed.unitPriceGross ?? existingSnapshot?.unitPriceGross ?? null
    let taxRate = parsed.taxRate ?? existingSnapshot?.taxRate ?? null
    if (priceMode && (unitPriceNet === null || unitPriceGross === null)) {
      let taxService: TaxCalculationService | null = null
      try {
        taxService = ctx.container.resolve('taxCalculationService') as TaxCalculationService
      } catch {
        taxService = null
      }
      if (taxService) {
        const taxResult = await taxService.calculateUnitAmounts({
          amount:
            priceMode === 'gross'
              ? unitPriceGross ?? unitPriceNet ?? 0
              : unitPriceNet ?? unitPriceGross ?? 0,
          mode: priceMode,
          organizationId: parsed.organizationId,
          tenantId: parsed.tenantId,
          taxRateId: parsed.taxRateId ?? undefined,
          taxRate: taxRate ?? undefined,
        })
        unitPriceNet = unitPriceNet ?? taxResult.netAmount
        unitPriceGross = unitPriceGross ?? taxResult.grossAmount
        taxRate = taxResult.taxRate ?? taxRate
      }
    }

    const metadata =
      typeof parsed.metadata === 'object' && parsed.metadata
        ? { ...parsed.metadata }
        : existingSnapshot?.metadata
          ? cloneJson(existingSnapshot.metadata)
          : {}
    if (parsed.priceId) metadata.priceId = parsed.priceId
    if (priceMode) metadata.priceMode = priceMode

    const statusEntryId = parsed.statusEntryId ?? (existingSnapshot as any)?.statusEntryId ?? null
    const lineId = parsed.id ?? existingSnapshot?.id ?? randomUUID()
    const updatedSnapshot: SalesLineSnapshot & { statusEntryId?: string | null; catalogSnapshot?: Record<string, unknown> | null; promotionSnapshot?: Record<string, unknown> | null } = {
      id: lineId,
      lineNumber: parsed.lineNumber ?? existingSnapshot?.lineNumber ?? lineSnapshots.length + 1,
      kind: parsed.kind ?? existingSnapshot?.kind ?? 'product',
      productId: parsed.productId ?? existingSnapshot?.productId ?? null,
      productVariantId: parsed.productVariantId ?? existingSnapshot?.productVariantId ?? null,
      name: parsed.name ?? existingSnapshot?.name ?? null,
      description: parsed.description ?? existingSnapshot?.description ?? null,
      comment: parsed.comment ?? existingSnapshot?.comment ?? null,
      quantity: Number(parsed.quantity ?? existingSnapshot?.quantity ?? 0),
      quantityUnit: parsed.quantityUnit ?? existingSnapshot?.quantityUnit ?? null,
      currencyCode: parsed.currencyCode ?? existingSnapshot?.currencyCode ?? order.currencyCode,
      unitPriceNet: unitPriceNet ?? 0,
      unitPriceGross: unitPriceGross ?? unitPriceNet ?? 0,
      discountAmount: parsed.discountAmount ?? existingSnapshot?.discountAmount ?? 0,
      discountPercent: parsed.discountPercent ?? existingSnapshot?.discountPercent ?? 0,
      taxRate: taxRate ?? 0,
      taxAmount: parsed.taxAmount ?? existingSnapshot?.taxAmount ?? null,
      totalNetAmount: parsed.totalNetAmount ?? existingSnapshot?.totalNetAmount ?? null,
      totalGrossAmount: parsed.totalGrossAmount ?? existingSnapshot?.totalGrossAmount ?? null,
      configuration: parsed.configuration ?? existingSnapshot?.configuration ?? null,
      promotionCode: parsed.promotionCode ?? existingSnapshot?.promotionCode ?? null,
      metadata,
      customFieldSetId: parsed.customFieldSetId ?? existingSnapshot?.customFieldSetId ?? null,
      customFields:
        parsed.customFields && typeof parsed.customFields === 'object'
          ? cloneJson(parsed.customFields)
          : (existingSnapshot as any)?.customFields ?? null,
    }
    ;(updatedSnapshot as any).statusEntryId = statusEntryId
    ;(updatedSnapshot as any).catalogSnapshot =
      parsed.catalogSnapshot ?? (existingSnapshot as any)?.catalogSnapshot ?? null
    ;(updatedSnapshot as any).promotionSnapshot =
      parsed.promotionSnapshot ?? (existingSnapshot as any)?.promotionSnapshot ?? null

    let nextLines = parsed.id
      ? lineSnapshots.map((line) => (line.id === parsed.id ? updatedSnapshot : line))
      : [...lineSnapshots, updatedSnapshot]
    nextLines = nextLines
      .sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0))
      .map((line, index) => ({ ...line, lineNumber: index + 1 }))

    const sourceInputs = nextLines.map((line, index) => ({
      ...line,
      statusEntryId: (line as any).statusEntryId ?? null,
      catalogSnapshot: (line as any).catalogSnapshot ?? null,
      promotionSnapshot: (line as any).promotionSnapshot ?? null,
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      orderId: order.id,
      lineNumber: line.lineNumber ?? index + 1,
    }))
    const calcLines: SalesLineSnapshot[] = sourceInputs.map((line, index) =>
      createLineSnapshotFromInput(line, line.lineNumber ?? index + 1)
    )
    const adjustmentDrafts = adjustments.map(mapOrderAdjustmentToDraft)
    const salesCalculationService = ctx.container.resolve<SalesCalculationService>('salesCalculationService')
    const calculationContext = buildCalculationContext({
      tenantId: order.tenantId,
      organizationId: order.organizationId,
      currencyCode: order.currencyCode,
      shippingSnapshot: order.shippingMethodSnapshot,
      paymentSnapshot: order.paymentMethodSnapshot,
      shippingMethodId: order.shippingMethodId ?? null,
      paymentMethodId: order.paymentMethodId ?? null,
      shippingMethodCode: order.shippingMethodCode ?? null,
      paymentMethodCode: order.paymentMethodCode ?? null,
    })
    const calculation = await salesCalculationService.calculateDocumentTotals({
      documentKind: 'order',
      lines: calcLines,
      adjustments: adjustmentDrafts,
      context: calculationContext,
      existingTotals: resolveExistingPaymentTotals(order),
    })
    await applyOrderLineResults({
      em,
      order,
      calculation,
      sourceLines: sourceInputs,
      existingLines,
    })
    applyOrderTotals(order, calculation.totals, calculation.lines.length)
    let eventBus: EventBus | null = null
    try {
      eventBus = ctx.container.resolve('eventBus') as EventBus
    } catch {
      eventBus = null
    }
    await emitTotalsCalculated(eventBus, {
      documentKind: 'order',
      documentId: order.id,
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      customerId: order.customerEntityId ?? null,
      totals: calculation.totals,
      lineCount: calculation.lines.length,
    })
    await em.flush()
    return { orderId: order.id, lineId }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadOrderSnapshot(em, result.orderId)
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as OrderGraphSnapshot | undefined
    const after = snapshots.after as OrderGraphSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.orders.lines.upsert', 'Upsert order line'),
      resourceKind: 'sales.order',
      resourceId: result.orderId,
      tenantId: after.order.tenantId,
      organizationId: after.order.organizationId,
      snapshotBefore: before ?? null,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies OrderUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OrderUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    ensureOrderScope(ctx, before.order.organizationId, before.order.tenantId)
    await restoreOrderGraph(em, before)
    await em.flush()
  },
}

const orderLineDeleteCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { orderId: string; lineId: string }
> = {
  id: 'sales.orders.lines.delete',
  async prepare(input, ctx) {
    const raw = (input?.body as Record<string, unknown> | undefined) ?? {}
    const orderId = typeof raw.orderId === 'string' ? raw.orderId : null
    if (!orderId) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadOrderSnapshot(em, orderId)
    if (snapshot) ensureOrderScope(ctx, snapshot.order.organizationId, snapshot.order.tenantId)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const { translate } = await resolveTranslations()
    const parsed = orderLineDeleteSchema.parse((input?.body as Record<string, unknown> | undefined) ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const order = await em.findOne(SalesOrder, { id: parsed.orderId, deletedAt: null })
    if (!order) throw new CrudHttpError(404, { error: translate('sales.documents.detail.error', 'Document not found or inaccessible.') })
    ensureOrderScope(ctx, order.organizationId, order.tenantId)
    const shipmentCount = await em.count(SalesShipmentItem, {
      orderLine: parsed.id,
      shipment: { deletedAt: null },
    })
    if (shipmentCount > 0) {
      throw new CrudHttpError(409, {
        error: translate(
          'sales.documents.items.errorDeleteShipped',
          'Cannot delete a line that has shipped items.'
        ),
      })
    }
    const existingLines = await em.find(SalesOrderLine, { order }, { orderBy: { lineNumber: 'asc' } })
    const adjustments = await em.find(SalesOrderAdjustment, { order }, { orderBy: { position: 'asc' } })
    const filtered = existingLines.filter((line) => line.id !== parsed.id)
    if (filtered.length === existingLines.length) {
      throw new CrudHttpError(404, { error: translate('sales.documents.detail.error', 'Document not found or inaccessible.') })
    }
    const sourceInputs = filtered.map((line, index) => ({
      ...mapOrderLineEntityToSnapshot(line),
      statusEntryId: line.statusEntryId ?? null,
      catalogSnapshot: line.catalogSnapshot ? cloneJson(line.catalogSnapshot) : null,
      promotionSnapshot: line.promotionSnapshot ? cloneJson(line.promotionSnapshot) : null,
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      orderId: order.id,
      lineNumber: index + 1,
    }))
    const calcLines = sourceInputs.map((line, index) =>
      createLineSnapshotFromInput(line, line.lineNumber ?? index + 1)
    )
    const adjustmentDrafts = adjustments.map(mapOrderAdjustmentToDraft)
    const salesCalculationService = ctx.container.resolve<SalesCalculationService>('salesCalculationService')
    const calculationContext = buildCalculationContext({
      tenantId: order.tenantId,
      organizationId: order.organizationId,
      currencyCode: order.currencyCode,
      shippingSnapshot: order.shippingMethodSnapshot,
      paymentSnapshot: order.paymentMethodSnapshot,
      shippingMethodId: order.shippingMethodId ?? null,
      paymentMethodId: order.paymentMethodId ?? null,
      shippingMethodCode: order.shippingMethodCode ?? null,
      paymentMethodCode: order.paymentMethodCode ?? null,
    })
    const calculation = await salesCalculationService.calculateDocumentTotals({
      documentKind: 'order',
      lines: calcLines,
      adjustments: adjustmentDrafts,
      context: calculationContext,
      existingTotals: resolveExistingPaymentTotals(order),
    })
    await applyOrderLineResults({
      em,
      order,
      calculation,
      sourceLines: sourceInputs,
      existingLines,
    })
    applyOrderTotals(order, calculation.totals, calculation.lines.length)
    let eventBus: EventBus | null = null
    try {
      eventBus = ctx.container.resolve('eventBus') as EventBus
    } catch {
      eventBus = null
    }
    await emitTotalsCalculated(eventBus, {
      documentKind: 'order',
      documentId: order.id,
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      customerId: order.customerEntityId ?? null,
      totals: calculation.totals,
      lineCount: calculation.lines.length,
    })
    await em.flush()
    return { orderId: order.id, lineId: parsed.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadOrderSnapshot(em, result.orderId)
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as OrderGraphSnapshot | undefined
    const after = snapshots.after as OrderGraphSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.orders.lines.delete', 'Delete order line'),
      resourceKind: 'sales.order',
      resourceId: result.orderId,
      tenantId: after.order.tenantId,
      organizationId: after.order.organizationId,
      snapshotBefore: before ?? null,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies OrderUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OrderUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    ensureOrderScope(ctx, before.order.organizationId, before.order.tenantId)
    await restoreOrderGraph(em, before)
    await em.flush()
  },
}

const quoteLineUpsertCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { quoteId: string; lineId: string }
> = {
  id: 'sales.quotes.lines.upsert',
  async prepare(input, ctx) {
    const raw = (input?.body as Record<string, unknown> | undefined) ?? {}
    const quoteId = typeof raw.quoteId === 'string' ? raw.quoteId : null
    if (!quoteId) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadQuoteSnapshot(em, quoteId)
    if (snapshot) ensureQuoteScope(ctx, snapshot.quote.organizationId, snapshot.quote.tenantId)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const parsed = quoteLineUpsertSchema.parse((input?.body as Record<string, unknown> | undefined) ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const quote = await em.findOne(SalesQuote, { id: parsed.quoteId, deletedAt: null })
    if (!quote) throw new CrudHttpError(404, { error: 'Sales quote not found' })
    ensureQuoteScope(ctx, quote.organizationId, quote.tenantId)
    const [existingLines, adjustments] = await Promise.all([
      em.find(SalesQuoteLine, { quote }, { orderBy: { lineNumber: 'asc' } }),
      em.find(SalesQuoteAdjustment, { quote }, { orderBy: { position: 'asc' } }),
    ])
    const lineSnapshots = existingLines.map(mapQuoteLineEntityToSnapshot)
    const existingSnapshot = parsed.id ? lineSnapshots.find((line) => line.id === parsed.id) ?? null : null
    const priceMode = parsed.priceMode === 'gross' ? 'gross' : parsed.priceMode === 'net' ? 'net' : null
    let unitPriceNet = parsed.unitPriceNet ?? existingSnapshot?.unitPriceNet ?? null
    let unitPriceGross = parsed.unitPriceGross ?? existingSnapshot?.unitPriceGross ?? null
    let taxRate = parsed.taxRate ?? existingSnapshot?.taxRate ?? null
    if (priceMode && (unitPriceNet === null || unitPriceGross === null)) {
      let taxService: TaxCalculationService | null = null
      try {
        taxService = ctx.container.resolve('taxCalculationService') as TaxCalculationService
      } catch {
        taxService = null
      }
      if (taxService) {
        const taxResult = await taxService.calculateUnitAmounts({
          amount:
            priceMode === 'gross'
              ? unitPriceGross ?? unitPriceNet ?? 0
              : unitPriceNet ?? unitPriceGross ?? 0,
          mode: priceMode,
          organizationId: parsed.organizationId,
          tenantId: parsed.tenantId,
          taxRateId: parsed.taxRateId ?? undefined,
          taxRate: taxRate ?? undefined,
        })
        unitPriceNet = unitPriceNet ?? taxResult.netAmount
        unitPriceGross = unitPriceGross ?? taxResult.grossAmount
        taxRate = taxResult.taxRate ?? taxRate
      }
    }
    const metadata =
      typeof parsed.metadata === 'object' && parsed.metadata
        ? { ...parsed.metadata }
        : existingSnapshot?.metadata
          ? cloneJson(existingSnapshot.metadata)
          : {}
    if (parsed.priceId) metadata.priceId = parsed.priceId
    if (priceMode) metadata.priceMode = priceMode

    const statusEntryId = parsed.statusEntryId ?? (existingSnapshot as any)?.statusEntryId ?? null
    const lineId = parsed.id ?? existingSnapshot?.id ?? randomUUID()
    const updatedSnapshot: SalesLineSnapshot & { statusEntryId?: string | null; catalogSnapshot?: Record<string, unknown> | null; promotionSnapshot?: Record<string, unknown> | null } = {
      id: lineId,
      lineNumber: parsed.lineNumber ?? existingSnapshot?.lineNumber ?? lineSnapshots.length + 1,
      kind: parsed.kind ?? existingSnapshot?.kind ?? 'product',
      productId: parsed.productId ?? existingSnapshot?.productId ?? null,
      productVariantId: parsed.productVariantId ?? existingSnapshot?.productVariantId ?? null,
      name: parsed.name ?? existingSnapshot?.name ?? null,
      description: parsed.description ?? existingSnapshot?.description ?? null,
      comment: parsed.comment ?? existingSnapshot?.comment ?? null,
      quantity: Number(parsed.quantity ?? existingSnapshot?.quantity ?? 0),
      quantityUnit: parsed.quantityUnit ?? existingSnapshot?.quantityUnit ?? null,
      currencyCode: parsed.currencyCode ?? existingSnapshot?.currencyCode ?? quote.currencyCode,
      unitPriceNet: unitPriceNet ?? 0,
      unitPriceGross: unitPriceGross ?? unitPriceNet ?? 0,
      discountAmount: parsed.discountAmount ?? existingSnapshot?.discountAmount ?? 0,
      discountPercent: parsed.discountPercent ?? existingSnapshot?.discountPercent ?? 0,
      taxRate: taxRate ?? 0,
      taxAmount: parsed.taxAmount ?? existingSnapshot?.taxAmount ?? null,
      totalNetAmount: parsed.totalNetAmount ?? existingSnapshot?.totalNetAmount ?? null,
      totalGrossAmount: parsed.totalGrossAmount ?? existingSnapshot?.totalGrossAmount ?? null,
      configuration: parsed.configuration ?? existingSnapshot?.configuration ?? null,
      promotionCode: parsed.promotionCode ?? existingSnapshot?.promotionCode ?? null,
      metadata,
      customFieldSetId: parsed.customFieldSetId ?? existingSnapshot?.customFieldSetId ?? null,
      customFields:
        parsed.customFields && typeof parsed.customFields === 'object'
          ? cloneJson(parsed.customFields)
          : (existingSnapshot as any)?.customFields ?? null,
    }
    ;(updatedSnapshot as any).statusEntryId = statusEntryId
    ;(updatedSnapshot as any).catalogSnapshot =
      parsed.catalogSnapshot ?? (existingSnapshot as any)?.catalogSnapshot ?? null
    ;(updatedSnapshot as any).promotionSnapshot =
      parsed.promotionSnapshot ?? (existingSnapshot as any)?.promotionSnapshot ?? null

    let nextLines = parsed.id
      ? lineSnapshots.map((line) => (line.id === parsed.id ? updatedSnapshot : line))
      : [...lineSnapshots, updatedSnapshot]
    nextLines = nextLines
      .sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0))
      .map((line, index) => ({ ...line, lineNumber: index + 1 }))

    const sourceInputs = nextLines.map((line, index) => ({
      ...line,
      statusEntryId: (line as any).statusEntryId ?? null,
      catalogSnapshot: (line as any).catalogSnapshot ?? null,
      promotionSnapshot: (line as any).promotionSnapshot ?? null,
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      quoteId: quote.id,
      lineNumber: line.lineNumber ?? index + 1,
    }))
    const calcLines: SalesLineSnapshot[] = sourceInputs.map((line, index) =>
      createLineSnapshotFromInput(line, line.lineNumber ?? index + 1)
    )
    const adjustmentDrafts = adjustments.map(mapQuoteAdjustmentToDraft)
    const salesCalculationService = ctx.container.resolve<SalesCalculationService>('salesCalculationService')
    const calculationContext = buildCalculationContext({
      tenantId: quote.tenantId,
      organizationId: quote.organizationId,
      currencyCode: quote.currencyCode,
      shippingSnapshot: quote.shippingMethodSnapshot,
      paymentSnapshot: quote.paymentMethodSnapshot,
      shippingMethodId: quote.shippingMethodId ?? null,
      paymentMethodId: quote.paymentMethodId ?? null,
      shippingMethodCode: quote.shippingMethodCode ?? null,
      paymentMethodCode: quote.paymentMethodCode ?? null,
    })
    const calculation = await salesCalculationService.calculateDocumentTotals({
      documentKind: 'quote',
      lines: calcLines,
      adjustments: adjustmentDrafts,
      context: calculationContext,
    })
    await applyQuoteLineResults({
      em,
      quote,
      calculation,
      sourceLines: sourceInputs,
      existingLines,
    })
    applyQuoteTotals(quote, calculation.totals, calculation.lines.length)
    let eventBus: EventBus | null = null
    try {
      eventBus = ctx.container.resolve('eventBus') as EventBus
    } catch {
      eventBus = null
    }
    await emitTotalsCalculated(eventBus, {
      documentKind: 'quote',
      documentId: quote.id,
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      customerId: quote.customerEntityId ?? null,
      totals: calculation.totals,
      lineCount: calculation.lines.length,
    })
    await em.flush()
    return { quoteId: quote.id, lineId }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadQuoteSnapshot(em, result.quoteId)
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as QuoteGraphSnapshot | undefined
    const after = snapshots.after as QuoteGraphSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.quotes.lines.upsert', 'Upsert quote line'),
      resourceKind: 'sales.quote',
      resourceId: result.quoteId,
      tenantId: after.quote.tenantId,
      organizationId: after.quote.organizationId,
      snapshotBefore: before ?? null,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies QuoteUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<QuoteUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    ensureQuoteScope(ctx, before.quote.organizationId, before.quote.tenantId)
    await restoreQuoteGraph(em, before)
    await em.flush()
  },
}

const quoteLineDeleteCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { quoteId: string; lineId: string }
> = {
  id: 'sales.quotes.lines.delete',
  async prepare(input, ctx) {
    const raw = (input?.body as Record<string, unknown> | undefined) ?? {}
    const quoteId = typeof raw.quoteId === 'string' ? raw.quoteId : null
    if (!quoteId) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadQuoteSnapshot(em, quoteId)
    if (snapshot) ensureQuoteScope(ctx, snapshot.quote.organizationId, snapshot.quote.tenantId)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const parsed = quoteLineDeleteSchema.parse((input?.body as Record<string, unknown> | undefined) ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const quote = await em.findOne(SalesQuote, { id: parsed.quoteId, deletedAt: null })
    if (!quote) throw new CrudHttpError(404, { error: 'Sales quote not found' })
    ensureQuoteScope(ctx, quote.organizationId, quote.tenantId)
    const existingLines = await em.find(SalesQuoteLine, { quote }, { orderBy: { lineNumber: 'asc' } })
    const adjustments = await em.find(SalesQuoteAdjustment, { quote }, { orderBy: { position: 'asc' } })
    const filtered = existingLines.filter((line) => line.id !== parsed.id)
    if (filtered.length === existingLines.length) {
      throw new CrudHttpError(404, { error: 'Quote line not found' })
    }
    const sourceInputs = filtered.map((line, index) => ({
      ...mapQuoteLineEntityToSnapshot(line),
      statusEntryId: line.statusEntryId ?? null,
      catalogSnapshot: line.catalogSnapshot ? cloneJson(line.catalogSnapshot) : null,
      promotionSnapshot: line.promotionSnapshot ? cloneJson(line.promotionSnapshot) : null,
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      quoteId: quote.id,
      lineNumber: index + 1,
    }))
    const calcLines = sourceInputs.map((line, index) =>
      createLineSnapshotFromInput(line, line.lineNumber ?? index + 1)
    )
    const adjustmentDrafts = adjustments.map(mapQuoteAdjustmentToDraft)
    const salesCalculationService = ctx.container.resolve<SalesCalculationService>('salesCalculationService')
    const calculationContext = buildCalculationContext({
      tenantId: quote.tenantId,
      organizationId: quote.organizationId,
      currencyCode: quote.currencyCode,
      shippingSnapshot: quote.shippingMethodSnapshot,
      paymentSnapshot: quote.paymentMethodSnapshot,
      shippingMethodId: quote.shippingMethodId ?? null,
      paymentMethodId: quote.paymentMethodId ?? null,
      shippingMethodCode: quote.shippingMethodCode ?? null,
      paymentMethodCode: quote.paymentMethodCode ?? null,
    })
    const calculation = await salesCalculationService.calculateDocumentTotals({
      documentKind: 'quote',
      lines: calcLines,
      adjustments: adjustmentDrafts,
      context: calculationContext,
    })
    await applyQuoteLineResults({
      em,
      quote,
      calculation,
      sourceLines: sourceInputs,
      existingLines,
    })
    applyQuoteTotals(quote, calculation.totals, calculation.lines.length)
    let eventBus: EventBus | null = null
    try {
      eventBus = ctx.container.resolve('eventBus') as EventBus
    } catch {
      eventBus = null
    }
    await emitTotalsCalculated(eventBus, {
      documentKind: 'quote',
      documentId: quote.id,
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      customerId: quote.customerEntityId ?? null,
      totals: calculation.totals,
      lineCount: calculation.lines.length,
    })
    await em.flush()
    return { quoteId: quote.id, lineId: parsed.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadQuoteSnapshot(em, result.quoteId)
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as QuoteGraphSnapshot | undefined
    const after = snapshots.after as QuoteGraphSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.quotes.lines.delete', 'Delete quote line'),
      resourceKind: 'sales.quote',
      resourceId: result.quoteId,
      tenantId: after.quote.tenantId,
      organizationId: after.quote.organizationId,
      snapshotBefore: before ?? null,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies QuoteUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<QuoteUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    ensureQuoteScope(ctx, before.quote.organizationId, before.quote.tenantId)
    await restoreQuoteGraph(em, before)
    await em.flush()
  },
}

const orderAdjustmentUpsertCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { orderId: string; adjustmentId: string }
> = {
  id: 'sales.orders.adjustments.upsert',
  async prepare(input, ctx) {
    const raw = (input?.body as Record<string, unknown> | undefined) ?? {}
    const orderId = typeof raw.orderId === 'string' ? raw.orderId : null
    if (!orderId) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadOrderSnapshot(em, orderId)
    if (snapshot) ensureOrderScope(ctx, snapshot.order.organizationId, snapshot.order.tenantId)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const parsed = orderAdjustmentUpsertSchema.parse((input?.body as Record<string, unknown> | undefined) ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const order = await em.findOne(SalesOrder, { id: parsed.orderId, deletedAt: null })
    if (!order) throw new CrudHttpError(404, { error: 'Sales order not found' })
    ensureOrderScope(ctx, order.organizationId, order.tenantId)
    if (parsed.scope === 'line') {
      throw new CrudHttpError(400, { error: 'Line-scoped adjustments are not supported yet.' })
    }

    const [existingLines, existingAdjustments] = await Promise.all([
      em.find(SalesOrderLine, { order }, { orderBy: { lineNumber: 'asc' } }),
      em.find(SalesOrderAdjustment, { order }, { orderBy: { position: 'asc' } }),
    ])
    const lineSnapshots = existingLines.map(mapOrderLineEntityToSnapshot)
    const adjustmentDrafts = existingAdjustments.map(mapOrderAdjustmentToDraft)
    const existingSnapshot = parsed.id ? adjustmentDrafts.find((adj) => adj.id === parsed.id) ?? null : null
    const adjustmentId = parsed.id ?? existingSnapshot?.id ?? randomUUID()
    let metadata =
      typeof parsed.metadata === 'object' && parsed.metadata
        ? cloneJson(parsed.metadata)
        : existingSnapshot?.metadata
          ? cloneJson(existingSnapshot.metadata)
          : null
    const calculatorKey = parsed.calculatorKey ?? existingSnapshot?.calculatorKey ?? null
    if (
      parsed.id &&
      calculatorKey &&
      (calculatorKey.startsWith('shipping-provider:') || calculatorKey.startsWith('payment-provider:'))
    ) {
      metadata = { ...(metadata ?? {}), manualOverride: true }
    }
    let nextAdjustments = parsed.id
      ? adjustmentDrafts.map((adj) =>
          adj.id === parsed.id
            ? {
                ...adj,
                id: adjustmentId,
                scope: parsed.scope ?? adj.scope ?? 'order',
                kind: parsed.kind ?? adj.kind ?? 'custom',
                code: parsed.code ?? adj.code ?? null,
                label: parsed.label ?? adj.label ?? null,
                calculatorKey: parsed.calculatorKey ?? adj.calculatorKey ?? null,
                promotionId: parsed.promotionId ?? adj.promotionId ?? null,
                rate: parsed.rate ?? adj.rate ?? null,
                amountNet: parsed.amountNet ?? adj.amountNet ?? null,
                amountGross: parsed.amountGross ?? adj.amountGross ?? null,
                currencyCode: parsed.currencyCode ?? adj.currencyCode ?? order.currencyCode,
                metadata,
                customFields:
                  parsed.customFields !== undefined
                    ? parsed.customFields
                    : (adj as any).customFields ?? null,
                position: parsed.position ?? adj.position ?? adjustmentDrafts.length,
              }
            : adj
        )
      : [
          ...adjustmentDrafts,
          {
            id: adjustmentId,
            scope: parsed.scope ?? 'order',
            kind: parsed.kind ?? 'custom',
            code: parsed.code ?? null,
            label: parsed.label ?? null,
            calculatorKey: parsed.calculatorKey ?? null,
            promotionId: parsed.promotionId ?? null,
            rate: parsed.rate ?? null,
            amountNet: parsed.amountNet ?? null,
            amountGross: parsed.amountGross ?? null,
            currencyCode: parsed.currencyCode ?? order.currencyCode,
            metadata,
            customFields: parsed.customFields ?? null,
            position: parsed.position ?? adjustmentDrafts.length,
          },
        ]

    nextAdjustments = nextAdjustments
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((adj, index) => ({ ...adj, position: adj.position ?? index }))

    const sourceLines = lineSnapshots.map((line, index) => ({
      ...line,
      statusEntryId: (line as any).statusEntryId ?? null,
      catalogSnapshot: (line as any).catalogSnapshot ?? null,
      promotionSnapshot: (line as any).promotionSnapshot ?? null,
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      orderId: order.id,
      lineNumber: line.lineNumber ?? index + 1,
    }))
    const calcLines = sourceLines.map((line, index) =>
      createLineSnapshotFromInput(line, line.lineNumber ?? index + 1)
    )
    const salesCalculationService = ctx.container.resolve<SalesCalculationService>('salesCalculationService')
    const calculationContext = buildCalculationContext({
      tenantId: order.tenantId,
      organizationId: order.organizationId,
      currencyCode: order.currencyCode,
      shippingSnapshot: order.shippingMethodSnapshot,
      paymentSnapshot: order.paymentMethodSnapshot,
      shippingMethodId: order.shippingMethodId ?? null,
      paymentMethodId: order.paymentMethodId ?? null,
      shippingMethodCode: order.shippingMethodCode ?? null,
      paymentMethodCode: order.paymentMethodCode ?? null,
    })
    const calculation = await salesCalculationService.calculateDocumentTotals({
      documentKind: 'order',
      lines: calcLines,
      adjustments: nextAdjustments,
      context: calculationContext,
      existingTotals: resolveExistingPaymentTotals(order),
    })
    const adjustmentInputs = nextAdjustments.map((adj, index) => ({
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      orderId: order.id,
      scope: adj.scope ?? 'order',
      kind: adj.kind ?? 'custom',
      code: adj.code ?? undefined,
      label: adj.label ?? undefined,
      calculatorKey: adj.calculatorKey ?? undefined,
      promotionId: adj.promotionId ?? undefined,
      rate: adj.rate ?? undefined,
      amountNet: adj.amountNet ?? undefined,
      amountGross: adj.amountGross ?? undefined,
      currencyCode: adj.currencyCode ?? order.currencyCode,
      metadata: adj.metadata ?? undefined,
      customFields: (adj as any).customFields ?? undefined,
      position: adj.position ?? index,
    }))
    await replaceOrderAdjustments(em, order, calculation, adjustmentInputs)
    applyOrderTotals(order, calculation.totals, calculation.lines.length)
    order.updatedAt = new Date()
    let eventBus: EventBus | null = null
    try {
      eventBus = ctx.container.resolve('eventBus') as EventBus
    } catch {
      eventBus = null
    }
    await emitTotalsCalculated(eventBus, {
      documentKind: 'order',
      documentId: order.id,
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      customerId: order.customerEntityId ?? null,
      totals: calculation.totals,
      lineCount: calculation.lines.length,
    })
    await em.flush()
    return { orderId: order.id, adjustmentId }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadOrderSnapshot(em, result.orderId)
  },
  buildLog: async ({ snapshots, result }) => {
    const before = snapshots.before as OrderGraphSnapshot | undefined
    const after = snapshots.after as OrderGraphSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.orders.adjustments.upsert', 'Upsert order adjustment'),
      resourceKind: 'sales.order',
      resourceId: result.orderId,
      tenantId: after.order.tenantId,
      organizationId: after.order.organizationId,
      snapshotBefore: before ?? null,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies OrderUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OrderUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    ensureOrderScope(ctx, before.order.organizationId, before.order.tenantId)
    await restoreOrderGraph(em, before)
    await em.flush()
  },
}

const orderAdjustmentDeleteCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { orderId: string; adjustmentId: string }
> = {
  id: 'sales.orders.adjustments.delete',
  async prepare(input, ctx) {
    const raw = (input?.body as Record<string, unknown> | undefined) ?? {}
    const orderId = typeof raw.orderId === 'string' ? raw.orderId : null
    if (!orderId) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadOrderSnapshot(em, orderId)
    if (snapshot) ensureOrderScope(ctx, snapshot.order.organizationId, snapshot.order.tenantId)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const parsed = orderAdjustmentDeleteSchema.parse((input?.body as Record<string, unknown> | undefined) ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const order = await em.findOne(SalesOrder, { id: parsed.orderId, deletedAt: null })
    if (!order) throw new CrudHttpError(404, { error: 'Sales order not found' })
    ensureOrderScope(ctx, order.organizationId, order.tenantId)

    const [existingLines, adjustments] = await Promise.all([
      em.find(SalesOrderLine, { order }, { orderBy: { lineNumber: 'asc' } }),
      em.find(SalesOrderAdjustment, { order }, { orderBy: { position: 'asc' } }),
    ])
    const filtered = adjustments.filter((adj) => adj.id !== parsed.id)
    if (filtered.length === adjustments.length) {
      throw new CrudHttpError(404, { error: 'Adjustment not found' })
    }
    const lineSnapshots = existingLines.map(mapOrderLineEntityToSnapshot)
    const calcLines = lineSnapshots.map((line, index) =>
      createLineSnapshotFromInput(
        {
          ...line,
          organizationId: order.organizationId,
          tenantId: order.tenantId,
          orderId: order.id,
          lineNumber: line.lineNumber ?? index + 1,
          statusEntryId: (line as any).statusEntryId ?? null,
          catalogSnapshot: (line as any).catalogSnapshot ?? null,
          promotionSnapshot: (line as any).promotionSnapshot ?? null,
        },
        line.lineNumber ?? index + 1
      )
    )
    const adjustmentDrafts = filtered.map(mapOrderAdjustmentToDraft)
    const salesCalculationService = ctx.container.resolve<SalesCalculationService>('salesCalculationService')
    const calculationContext = buildCalculationContext({
      tenantId: order.tenantId,
      organizationId: order.organizationId,
      currencyCode: order.currencyCode,
      shippingSnapshot: order.shippingMethodSnapshot,
      paymentSnapshot: order.paymentMethodSnapshot,
      shippingMethodId: order.shippingMethodId ?? null,
      paymentMethodId: order.paymentMethodId ?? null,
      shippingMethodCode: order.shippingMethodCode ?? null,
      paymentMethodCode: order.paymentMethodCode ?? null,
    })
    const calculation = await salesCalculationService.calculateDocumentTotals({
      documentKind: 'order',
      lines: calcLines,
      adjustments: adjustmentDrafts,
      context: calculationContext,
      existingTotals: resolveExistingPaymentTotals(order),
    })
    const adjustmentInputs = adjustmentDrafts.map((adj, index) => ({
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      orderId: order.id,
      scope: adj.scope ?? 'order',
      kind: adj.kind ?? 'custom',
      code: adj.code ?? undefined,
      label: adj.label ?? undefined,
      calculatorKey: adj.calculatorKey ?? undefined,
      promotionId: adj.promotionId ?? undefined,
      rate: adj.rate ?? undefined,
      amountNet: adj.amountNet ?? undefined,
      amountGross: adj.amountGross ?? undefined,
      currencyCode: adj.currencyCode ?? order.currencyCode,
      metadata: adj.metadata ?? undefined,
      position: adj.position ?? index,
    }))
    await replaceOrderAdjustments(em, order, calculation, adjustmentInputs)
    applyOrderTotals(order, calculation.totals, calculation.lines.length)
    order.updatedAt = new Date()
    let eventBus: EventBus | null = null
    try {
      eventBus = ctx.container.resolve('eventBus') as EventBus
    } catch {
      eventBus = null
    }
    await emitTotalsCalculated(eventBus, {
      documentKind: 'order',
      documentId: order.id,
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      customerId: order.customerEntityId ?? null,
      totals: calculation.totals,
      lineCount: calculation.lines.length,
    })
    await em.flush()
    return { orderId: order.id, adjustmentId: parsed.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadOrderSnapshot(em, result.orderId)
  },
  buildLog: async ({ snapshots, result }) => {
    const before = snapshots.before as OrderGraphSnapshot | undefined
    const after = snapshots.after as OrderGraphSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.orders.adjustments.delete', 'Delete order adjustment'),
      resourceKind: 'sales.order',
      resourceId: result.orderId,
      tenantId: after.order.tenantId,
      organizationId: after.order.organizationId,
      snapshotBefore: before ?? null,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies OrderUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OrderUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    ensureOrderScope(ctx, before.order.organizationId, before.order.tenantId)
    await restoreOrderGraph(em, before)
    await em.flush()
  },
}

const quoteAdjustmentUpsertCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { quoteId: string; adjustmentId: string }
> = {
  id: 'sales.quotes.adjustments.upsert',
  async prepare(input, ctx) {
    const raw = (input?.body as Record<string, unknown> | undefined) ?? {}
    const quoteId = typeof raw.quoteId === 'string' ? raw.quoteId : null
    if (!quoteId) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadQuoteSnapshot(em, quoteId)
    if (snapshot) ensureQuoteScope(ctx, snapshot.quote.organizationId, snapshot.quote.tenantId)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const parsed = quoteAdjustmentUpsertSchema.parse((input?.body as Record<string, unknown> | undefined) ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const quote = await em.findOne(SalesQuote, { id: parsed.quoteId, deletedAt: null })
    if (!quote) throw new CrudHttpError(404, { error: 'Sales quote not found' })
    ensureQuoteScope(ctx, quote.organizationId, quote.tenantId)
    if (parsed.scope === 'line') {
      throw new CrudHttpError(400, { error: 'Line-scoped adjustments are not supported yet.' })
    }

    const [existingLines, existingAdjustments] = await Promise.all([
      em.find(SalesQuoteLine, { quote }, { orderBy: { lineNumber: 'asc' } }),
      em.find(SalesQuoteAdjustment, { quote }, { orderBy: { position: 'asc' } }),
    ])
    const lineSnapshots = existingLines.map(mapQuoteLineEntityToSnapshot)
    const adjustmentDrafts = existingAdjustments.map(mapQuoteAdjustmentToDraft)
    const existingSnapshot = parsed.id ? adjustmentDrafts.find((adj) => adj.id === parsed.id) ?? null : null
    const adjustmentId = parsed.id ?? existingSnapshot?.id ?? randomUUID()
    let metadata =
      typeof parsed.metadata === 'object' && parsed.metadata
        ? cloneJson(parsed.metadata)
        : existingSnapshot?.metadata
          ? cloneJson(existingSnapshot.metadata)
          : null
    const calculatorKey = parsed.calculatorKey ?? existingSnapshot?.calculatorKey ?? null
    if (
      parsed.id &&
      calculatorKey &&
      (calculatorKey.startsWith('shipping-provider:') || calculatorKey.startsWith('payment-provider:'))
    ) {
      metadata = { ...(metadata ?? {}), manualOverride: true }
    }
    let nextAdjustments = parsed.id
      ? adjustmentDrafts.map((adj) =>
          adj.id === parsed.id
            ? {
                ...adj,
                id: adjustmentId,
                scope: parsed.scope ?? adj.scope ?? 'order',
                kind: parsed.kind ?? adj.kind ?? 'custom',
                code: parsed.code ?? adj.code ?? null,
                label: parsed.label ?? adj.label ?? null,
                calculatorKey: parsed.calculatorKey ?? adj.calculatorKey ?? null,
                promotionId: parsed.promotionId ?? adj.promotionId ?? null,
                rate: parsed.rate ?? adj.rate ?? null,
                amountNet: parsed.amountNet ?? adj.amountNet ?? null,
                amountGross: parsed.amountGross ?? adj.amountGross ?? null,
                currencyCode: parsed.currencyCode ?? adj.currencyCode ?? quote.currencyCode,
                metadata,
                customFields:
                  parsed.customFields !== undefined
                    ? parsed.customFields
                    : (adj as any).customFields ?? null,
                position: parsed.position ?? adj.position ?? adjustmentDrafts.length,
              }
            : adj
        )
      : [
          ...adjustmentDrafts,
          {
            id: adjustmentId,
            scope: parsed.scope ?? 'order',
            kind: parsed.kind ?? 'custom',
            code: parsed.code ?? null,
            label: parsed.label ?? null,
            calculatorKey: parsed.calculatorKey ?? null,
            promotionId: parsed.promotionId ?? null,
            rate: parsed.rate ?? null,
            amountNet: parsed.amountNet ?? null,
            amountGross: parsed.amountGross ?? null,
            currencyCode: parsed.currencyCode ?? quote.currencyCode,
            metadata,
            customFields: parsed.customFields ?? null,
            position: parsed.position ?? adjustmentDrafts.length,
          },
        ]

    nextAdjustments = nextAdjustments
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((adj, index) => ({ ...adj, position: adj.position ?? index }))

    const sourceLines = lineSnapshots.map((line, index) => ({
      ...line,
      statusEntryId: (line as any).statusEntryId ?? null,
      catalogSnapshot: (line as any).catalogSnapshot ?? null,
      promotionSnapshot: (line as any).promotionSnapshot ?? null,
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      quoteId: quote.id,
      lineNumber: line.lineNumber ?? index + 1,
    }))
    const calcLines = sourceLines.map((line, index) =>
      createLineSnapshotFromInput(line, line.lineNumber ?? index + 1)
    )
    const salesCalculationService = ctx.container.resolve<SalesCalculationService>('salesCalculationService')
    const calculationContext = buildCalculationContext({
      tenantId: quote.tenantId,
      organizationId: quote.organizationId,
      currencyCode: quote.currencyCode,
      shippingSnapshot: quote.shippingMethodSnapshot,
      paymentSnapshot: quote.paymentMethodSnapshot,
      shippingMethodId: quote.shippingMethodId ?? null,
      paymentMethodId: quote.paymentMethodId ?? null,
      shippingMethodCode: quote.shippingMethodCode ?? null,
      paymentMethodCode: quote.paymentMethodCode ?? null,
    })
    const calculation = await salesCalculationService.calculateDocumentTotals({
      documentKind: 'quote',
      lines: calcLines,
      adjustments: nextAdjustments,
      context: calculationContext,
    })
    const adjustmentInputs = nextAdjustments.map((adj, index) => ({
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      quoteId: quote.id,
      scope: adj.scope ?? 'order',
      kind: adj.kind ?? 'custom',
      code: adj.code ?? undefined,
      label: adj.label ?? undefined,
      calculatorKey: adj.calculatorKey ?? undefined,
      promotionId: adj.promotionId ?? undefined,
      rate: adj.rate ?? undefined,
      amountNet: adj.amountNet ?? undefined,
      amountGross: adj.amountGross ?? undefined,
      currencyCode: adj.currencyCode ?? quote.currencyCode,
      metadata: adj.metadata ?? undefined,
      customFields: (adj as any).customFields ?? undefined,
      position: adj.position ?? index,
    }))
    await replaceQuoteAdjustments(em, quote, calculation, adjustmentInputs)
    applyQuoteTotals(quote, calculation.totals, calculation.lines.length)
    quote.updatedAt = new Date()
    let eventBus: EventBus | null = null
    try {
      eventBus = ctx.container.resolve('eventBus') as EventBus
    } catch {
      eventBus = null
    }
    await emitTotalsCalculated(eventBus, {
      documentKind: 'quote',
      documentId: quote.id,
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      customerId: quote.customerEntityId ?? null,
      totals: calculation.totals,
      lineCount: calculation.lines.length,
    })
    await em.flush()
    return { quoteId: quote.id, adjustmentId }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadQuoteSnapshot(em, result.quoteId)
  },
  buildLog: async ({ snapshots, result }) => {
    const before = snapshots.before as QuoteGraphSnapshot | undefined
    const after = snapshots.after as QuoteGraphSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.quotes.adjustments.upsert', 'Upsert quote adjustment'),
      resourceKind: 'sales.quote',
      resourceId: result.quoteId,
      tenantId: after.quote.tenantId,
      organizationId: after.quote.organizationId,
      snapshotBefore: before ?? null,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies QuoteUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<QuoteUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    ensureQuoteScope(ctx, before.quote.organizationId, before.quote.tenantId)
    await restoreQuoteGraph(em, before)
    await em.flush()
  },
}

const quoteAdjustmentDeleteCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { quoteId: string; adjustmentId: string }
> = {
  id: 'sales.quotes.adjustments.delete',
  async prepare(input, ctx) {
    const raw = (input?.body as Record<string, unknown> | undefined) ?? {}
    const quoteId = typeof raw.quoteId === 'string' ? raw.quoteId : null
    if (!quoteId) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadQuoteSnapshot(em, quoteId)
    if (snapshot) ensureQuoteScope(ctx, snapshot.quote.organizationId, snapshot.quote.tenantId)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const parsed = quoteAdjustmentDeleteSchema.parse((input?.body as Record<string, unknown> | undefined) ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const quote = await em.findOne(SalesQuote, { id: parsed.quoteId, deletedAt: null })
    if (!quote) throw new CrudHttpError(404, { error: 'Sales quote not found' })
    ensureQuoteScope(ctx, quote.organizationId, quote.tenantId)

    const [existingLines, adjustments] = await Promise.all([
      em.find(SalesQuoteLine, { quote }, { orderBy: { lineNumber: 'asc' } }),
      em.find(SalesQuoteAdjustment, { quote }, { orderBy: { position: 'asc' } }),
    ])
    const filtered = adjustments.filter((adj) => adj.id !== parsed.id)
    if (filtered.length === adjustments.length) {
      throw new CrudHttpError(404, { error: 'Adjustment not found' })
    }
    const lineSnapshots = existingLines.map(mapQuoteLineEntityToSnapshot)
    const calcLines = lineSnapshots.map((line, index) =>
      createLineSnapshotFromInput(
        {
          ...line,
          organizationId: quote.organizationId,
          tenantId: quote.tenantId,
          quoteId: quote.id,
          lineNumber: line.lineNumber ?? index + 1,
          statusEntryId: (line as any).statusEntryId ?? null,
          catalogSnapshot: (line as any).catalogSnapshot ?? null,
          promotionSnapshot: (line as any).promotionSnapshot ?? null,
        },
        line.lineNumber ?? index + 1
      )
    )
    const adjustmentDrafts = filtered.map(mapQuoteAdjustmentToDraft)
    const salesCalculationService = ctx.container.resolve<SalesCalculationService>('salesCalculationService')
    const calculationContext = buildCalculationContext({
      tenantId: quote.tenantId,
      organizationId: quote.organizationId,
      currencyCode: quote.currencyCode,
      shippingSnapshot: quote.shippingMethodSnapshot,
      paymentSnapshot: quote.paymentMethodSnapshot,
      shippingMethodId: quote.shippingMethodId ?? null,
      paymentMethodId: quote.paymentMethodId ?? null,
      shippingMethodCode: quote.shippingMethodCode ?? null,
      paymentMethodCode: quote.paymentMethodCode ?? null,
    })
    const calculation = await salesCalculationService.calculateDocumentTotals({
      documentKind: 'quote',
      lines: calcLines,
      adjustments: adjustmentDrafts,
      context: calculationContext,
    })
    const adjustmentInputs = adjustmentDrafts.map((adj, index) => ({
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      quoteId: quote.id,
      scope: adj.scope ?? 'order',
      kind: adj.kind ?? 'custom',
      code: adj.code ?? undefined,
      label: adj.label ?? undefined,
      calculatorKey: adj.calculatorKey ?? undefined,
      promotionId: adj.promotionId ?? undefined,
      rate: adj.rate ?? undefined,
      amountNet: adj.amountNet ?? undefined,
      amountGross: adj.amountGross ?? undefined,
      currencyCode: adj.currencyCode ?? quote.currencyCode,
      metadata: adj.metadata ?? undefined,
      position: adj.position ?? index,
    }))
    await replaceQuoteAdjustments(em, quote, calculation, adjustmentInputs)
    applyQuoteTotals(quote, calculation.totals, calculation.lines.length)
    quote.updatedAt = new Date()
    let eventBus: EventBus | null = null
    try {
      eventBus = ctx.container.resolve('eventBus') as EventBus
    } catch {
      eventBus = null
    }
    await emitTotalsCalculated(eventBus, {
      documentKind: 'quote',
      documentId: quote.id,
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      customerId: quote.customerEntityId ?? null,
      totals: calculation.totals,
      lineCount: calculation.lines.length,
    })
    await em.flush()
    return { quoteId: quote.id, adjustmentId: parsed.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadQuoteSnapshot(em, result.quoteId)
  },
  buildLog: async ({ snapshots, result }) => {
    const before = snapshots.before as QuoteGraphSnapshot | undefined
    const after = snapshots.after as QuoteGraphSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('sales.audit.quotes.adjustments.delete', 'Delete quote adjustment'),
      resourceKind: 'sales.quote',
      resourceId: result.quoteId,
      tenantId: after.quote.tenantId,
      organizationId: after.quote.organizationId,
      snapshotBefore: before ?? null,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies QuoteUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<QuoteUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    ensureQuoteScope(ctx, before.quote.organizationId, before.quote.tenantId)
    await restoreQuoteGraph(em, before)
    await em.flush()
  },
}

registerCommand(updateQuoteCommand)
registerCommand(createQuoteCommand)
registerCommand(deleteQuoteCommand)
registerCommand(convertQuoteToOrderCommand)
registerCommand(updateOrderCommand)
registerCommand(createOrderCommand)
registerCommand(deleteOrderCommand)
registerCommand(orderLineUpsertCommand)
registerCommand(orderLineDeleteCommand)
registerCommand(quoteLineUpsertCommand)
registerCommand(quoteLineDeleteCommand)
registerCommand(orderAdjustmentUpsertCommand)
registerCommand(orderAdjustmentDeleteCommand)
registerCommand(quoteAdjustmentUpsertCommand)
registerCommand(quoteAdjustmentDeleteCommand)
