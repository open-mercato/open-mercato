import type { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import {
  CatalogProduct,
  CatalogOffer,
  CatalogProductOption,
  CatalogProductOptionValue,
  CatalogProductVariant,
  CatalogAttributeSchemaTemplate,
  CatalogOptionSchemaTemplate,
} from '../data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

type UndoEnvelope<T> = {
  undo?: T
  value?: { undo?: T }
  __redoInput?: unknown
  [key: string]: unknown
}

export function ensureTenantScope(ctx: CommandRuntimeContext, tenantId: string): void {
  const currentTenant = ctx.auth?.tenantId ?? null
  if (currentTenant && currentTenant !== tenantId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

export function ensureOrganizationScope(ctx: CommandRuntimeContext, organizationId: string): void {
  const currentOrg = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (currentOrg && currentOrg !== organizationId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

export function ensureSameScope(
  entity: Pick<{ organizationId: string; tenantId: string }, 'organizationId' | 'tenantId'>,
  organizationId: string,
  tenantId: string
): void {
  if (entity.organizationId !== organizationId || entity.tenantId !== tenantId) {
    throw new CrudHttpError(403, { error: 'Cross-tenant relation forbidden' })
  }
}

export function assertFound<T>(value: T | null | undefined, message: string): T {
  if (!value) throw new CrudHttpError(404, { error: message })
  return value
}

export function extractUndoPayload<T>(logEntry: ActionLog | null | undefined): T | null {
  if (!logEntry) return null
  const payload = logEntry.commandPayload as UndoEnvelope<T> | undefined
  if (!payload || typeof payload !== 'object') return null
  if (payload.undo) return payload.undo
  if (payload.value && typeof payload.value === 'object' && payload.value.undo) {
    return payload.value.undo as T
  }
  for (const [key, value] of Object.entries(payload)) {
    if (key === '__redoInput') continue
    if (value && typeof value === 'object' && 'undo' in value) {
      return (value as { undo?: T }).undo ?? null
    }
  }
  return null
}

export function cloneJson<T>(value: T): T {
  if (value === null || value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function toNumericString(value: number | null | undefined): string | null {
  if (value === undefined || value === null) return null
  return value.toString()
}

export async function requireProduct(
  em: EntityManager,
  id: string,
  message = 'Catalog product not found'
): Promise<CatalogProduct> {
  const product = await em.findOne(CatalogProduct, { id, deletedAt: null })
  if (!product) throw new CrudHttpError(404, { error: message })
  return product
}

export async function requireVariant(
  em: EntityManager,
  id: string,
  message = 'Catalog variant not found'
): Promise<CatalogProductVariant> {
  const variant = await em.findOne(CatalogProductVariant, { id, deletedAt: null })
  if (!variant) throw new CrudHttpError(404, { error: message })
  return variant
}

export async function requireOption(
  em: EntityManager,
  id: string,
  message = 'Catalog option not found'
): Promise<CatalogProductOption> {
  const option = await em.findOne(CatalogProductOption, { id })
  if (!option) throw new CrudHttpError(404, { error: message })
  return option
}

export async function requireOptionValue(
  em: EntityManager,
  id: string,
  message = 'Catalog option value not found'
): Promise<CatalogProductOptionValue> {
  const value = await em.findOne(CatalogProductOptionValue, { id })
  if (!value) throw new CrudHttpError(404, { error: message })
  return value
}

export async function requireOffer(
  em: EntityManager,
  id: string,
  message = 'Catalog offer not found'
): Promise<CatalogOffer> {
  const offer = await em.findOne(CatalogOffer, { id })
  if (!offer) throw new CrudHttpError(404, { error: message })
  return offer
}

export async function requireAttributeSchemaTemplate(
  em: EntityManager,
  id: string,
  message = 'Attribute schema not found'
): Promise<CatalogAttributeSchemaTemplate> {
  const schema = await em.findOne(CatalogAttributeSchemaTemplate, { id, deletedAt: null })
  if (!schema) throw new CrudHttpError(404, { error: message })
  return schema
}

export async function requireOptionSchemaTemplate(
  em: EntityManager,
  id: string,
  message = 'Option schema not found'
): Promise<CatalogOptionSchemaTemplate> {
  const schema = await em.findOne(CatalogOptionSchemaTemplate, { id, deletedAt: null })
  if (!schema) throw new CrudHttpError(404, { error: message })
  return schema
}
