import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerAddress } from '@open-mercato/core/modules/customers/data/entities'
import type { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import {
  addressCustomValuesSchema,
  applyAddressCustomValues,
  copyAddressCustomValues,
  filterAddressCustomValues,
  loadAddressCustomFieldDefinitions,
  readAddressCustomValues,
  sealAddressCustomValues,
} from '@open-mercato/core/modules/entities/lib/addressCustomFields'
import { E } from '#generated/entities.ids.generated'
import type { SalesOrder, SalesQuote } from '../data/entities'

type AddressValues = Record<string, unknown>
type Scope = { tenantId: string; organizationId: string }
type Slot = 'billing' | 'shipping'
type PrimaryAddressValues = Partial<Record<Slot, AddressValues>>
type DocumentAddressInput = {
  billingAddressId?: string | null
  shippingAddressId?: string | null
  billingAddressSnapshot?: Record<string, unknown> | null
  shippingAddressSnapshot?: Record<string, unknown> | null
  billingAddressCustomValues?: AddressValues
  shippingAddressCustomValues?: AddressValues
  copyBillingAddressCustomValues?: boolean
  copyShippingAddressCustomValues?: boolean
}

const primaryAddressValuesSchema = z.object({
  billing: addressCustomValuesSchema.optional(),
  shipping: addressCustomValuesSchema.optional(),
})

export function readPrimaryAddressValues(value: unknown): PrimaryAddressValues | null {
  if (value == null) return null
  const parsed = primaryAddressValuesSchema.safeParse(value)
  if (!parsed.success) {
    throw new CrudHttpError(503, { code: 'address_custom_values_unavailable' })
  }
  return parsed.data
}

export function hasPrimaryAddressCustomEdit(input: DocumentAddressInput): boolean {
  return input.billingAddressCustomValues !== undefined ||
    input.shippingAddressCustomValues !== undefined ||
    input.copyBillingAddressCustomValues === true ||
    input.copyShippingAddressCustomValues === true
}

function addressIdChanged(previousId?: string | null, nextId?: string | null): boolean {
  return (previousId?.toLowerCase() ?? null) !== (nextId?.toLowerCase() ?? null)
}

export async function readCopiedAddressValues(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  scope: Scope,
  customerId: string | null | undefined,
  sourceId: string | null | undefined,
  targetDefinitions?: ReadonlyMap<string, CustomFieldDef>,
): Promise<AddressValues | null> {
  const { translate } = await resolveTranslations()
  const missingSource = () => new CrudHttpError(404, {
    error: translate('sales.documents.detail.error', 'Document not found or inaccessible.'),
  })
  if (!customerId || !sourceId) throw missingSource()
  const userId = ctx.auth?.sub
  const rbac = ctx.container.resolve<RbacService>('rbacService', { allowUnregistered: true })
  if (!userId || !rbac || !await rbac.userHasAllFeatures(userId, ['customers.activities.view'], scope)) {
    throw new CrudHttpError(403, { error: translate('api.errors.forbidden', 'Forbidden') })
  }
  const source = await findOneWithDecryption(
    em, CustomerAddress, { id: sourceId, entity: customerId, ...scope }, { fields: ['id', 'tenantId', 'organizationId', 'customValues'] }, scope,
  )
  if (!source) throw missingSource()
  return copyAddressCustomValues(em, { ...scope, sourceValues: readAddressCustomValues(source.customValues), targetDefinitions })
}

type PrimaryAddressContext = Scope & {
  kind: 'order' | 'quote'
  customerId?: string | null
  customerChanged?: boolean
  previous?: Pick<SalesOrder | SalesQuote, 'billingAddressId' | 'shippingAddressId' | 'billingAddressSnapshot' | 'shippingAddressSnapshot' | 'addressCustomValues'>
  current: Pick<SalesOrder | SalesQuote, 'billingAddressId' | 'shippingAddressId' | 'billingAddressSnapshot' | 'shippingAddressSnapshot'>
  input: DocumentAddressInput
}

export async function resolvePrimaryAddressValues(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  { kind, customerId, customerChanged, previous, current, input, tenantId, organizationId }: PrimaryAddressContext,
): Promise<AddressValues | string | null | undefined> {
  const slots = [
    {
      name: 'billing' as const, sourceId: input.billingAddressId,
      idChanged: addressIdChanged(previous?.billingAddressId, current.billingAddressId),
      present: Boolean(current.billingAddressSnapshot),
      cleared: input.billingAddressSnapshot === null || (previous?.billingAddressSnapshot != null && current.billingAddressSnapshot == null),
      patch: input.billingAddressCustomValues, copy: input.copyBillingAddressCustomValues === true,
    },
    {
      name: 'shipping' as const, sourceId: input.shippingAddressId,
      idChanged: addressIdChanged(previous?.shippingAddressId, current.shippingAddressId),
      present: Boolean(current.shippingAddressSnapshot),
      cleared: input.shippingAddressSnapshot === null || (previous?.shippingAddressSnapshot != null && current.shippingAddressSnapshot == null),
      patch: input.shippingAddressCustomValues, copy: input.copyShippingAddressCustomValues === true,
    },
  ]
  const hasEdit = hasPrimaryAddressCustomEdit(input)
  if (!hasEdit && (previous?.addressCustomValues == null ||
    (!customerChanged && slots.every(({ idChanged, cleared }) => !idChanged && !cleared)))) return undefined

  const scope = { tenantId, organizationId }
  const host = { ...scope, entityId: E.sales.sales_document_address }
  const definitions = hasEdit ? await loadAddressCustomFieldDefinitions(em, host) : undefined
  const existing = readPrimaryAddressValues(previous?.addressCustomValues)
  const next: PrimaryAddressValues = {}
  for (const { name, sourceId, idChanged, present, cleared, patch, copy } of slots) {
    const copied = copy ? await readCopiedAddressValues(em, ctx, scope, customerId, sourceId, definitions) : null
    if ((copy || (patch && Object.keys(patch).length)) && !present) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(400, {
        error: translate('entities.customFields.address.invalidValue', 'Enter a valid address field value.'),
      })
    }
    const base = copy ? copied : customerChanged || idChanged || cleared ? null : existing?.[name]
    try {
      const values = await applyAddressCustomValues(em, { ...host, previous: base, patch: copy ? patch ?? {} : patch, definitions })
      if (values) next[name] = values
    } catch (error) {
      if (!isCrudHttpError(error) || !error.body.fieldErrors) throw error
      const fieldErrors = Object.fromEntries(Object.entries(error.body.fieldErrors).map(([key, message]) => [
        `${name}AddressCustomValues.${key.replace(/^cf[_:]/, '')}`,
        message,
      ]))
      throw new CrudHttpError(error.status, { ...error.body, fieldErrors })
    }
  }
  return sealPrimaryAddressValues(em, ctx, kind, scope, Object.keys(next).length ? next : null)
}

export function sealPrimaryAddressValues(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  kind: 'order' | 'quote',
  scope: Scope,
  values: PrimaryAddressValues | null,
) {
  return sealAddressCustomValues(ctx.container, {
    ...scope,
    entityId: kind === 'order' ? E.sales.sales_order : E.sales.sales_quote,
    column: 'addressCustomValues',
    values,
    em,
  })
}

export function serializePrimaryAddressValues(value: unknown, definitions: ReadonlyMap<string, unknown>): Partial<{
  billingAddressCustomValues: AddressValues
  shippingAddressCustomValues: AddressValues
}> {
  const primary = readPrimaryAddressValues(value)
  const billing = filterAddressCustomValues(primary?.billing, definitions)
  const shipping = filterAddressCustomValues(primary?.shipping, definitions)
  return {
    ...(billing ? { billingAddressCustomValues: billing } : {}),
    ...(shipping ? { shippingAddressCustomValues: shipping } : {}),
  }
}
