/**
 * `customers.list_addresses` + `customers.list_tags` (Phase 1 WS-C, Step 3.9).
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { CustomerAddress, CustomerTag } from '../data/entities'
import { assertTenantScope, type CustomersAiToolDefinition, type CustomersToolContext } from './types'

function resolveEm(ctx: CustomersToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function buildScope(ctx: CustomersToolContext, tenantId: string) {
  return { tenantId, organizationId: ctx.organizationId }
}

const listAddressesInput = z.object({
  entityType: z.enum(['person', 'company']).describe('Parent entity kind.'),
  entityId: z.string().uuid().describe('Parent person/company entity id.'),
  limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 100).'),
  offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
})

const listAddressesTool: CustomersAiToolDefinition = {
  name: 'customers.list_addresses',
  displayName: 'List addresses',
  description:
    'List addresses attached to a person or company (tenant + organization scoped). `entityType` is informational; the actual filter is by `entityId`.',
  inputSchema: listAddressesInput,
  // Addresses share the same route-level guard as activities in the existing
  // route handler (`customers.activities.view`).
  requiredFeatures: ['customers.activities.view'],
  tags: ['read', 'customers'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listAddressesInput.parse(rawInput)
    const em = resolveEm(ctx)
    const limit = input.limit ?? 100
    const offset = input.offset ?? 0
    const where: Record<string, unknown> = { tenantId, entity: input.entityId }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    const [rows, total] = await Promise.all([
      findWithDecryption<CustomerAddress>(
        em,
        CustomerAddress,
        where as any,
        { limit, offset, orderBy: { isPrimary: 'desc', createdAt: 'desc' } as any } as any,
        buildScope(ctx, tenantId),
      ),
      em.count(CustomerAddress, where as any),
    ])
    const filtered = rows.filter((row) => row.tenantId === tenantId)
    return {
      entityType: input.entityType,
      entityId: input.entityId,
      items: filtered.map((row) => ({
        id: row.id,
        name: row.name ?? null,
        purpose: row.purpose ?? null,
        companyName: row.companyName ?? null,
        addressLine1: row.addressLine1,
        addressLine2: row.addressLine2 ?? null,
        buildingNumber: row.buildingNumber ?? null,
        flatNumber: row.flatNumber ?? null,
        city: row.city ?? null,
        region: row.region ?? null,
        postalCode: row.postalCode ?? null,
        country: row.country ?? null,
        latitude: row.latitude ?? null,
        longitude: row.longitude ?? null,
        isPrimary: !!row.isPrimary,
        organizationId: row.organizationId ?? null,
        tenantId: row.tenantId ?? null,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      })),
      total,
      limit,
      offset,
    }
  },
}

const listTagsInput = z
  .object({
    q: z.string().trim().min(1).optional().describe('Fuzzy search against tag label / slug.'),
    limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 100).'),
    offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
  })
  .passthrough()

const listTagsTool: CustomersAiToolDefinition = {
  name: 'customers.list_tags',
  displayName: 'List tags',
  description:
    'List available customer tags (slug, label, color, description) scoped to tenant + organization.',
  inputSchema: listTagsInput,
  // Tag administration routes require `customers.activities.*` in the
  // existing codebase; keep the same least-privilege view feature here.
  requiredFeatures: ['customers.activities.view'],
  tags: ['read', 'customers'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listTagsInput.parse(rawInput)
    const em = resolveEm(ctx)
    const limit = input.limit ?? 100
    const offset = input.offset ?? 0
    const where: Record<string, unknown> = { tenantId }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    if (input.q) {
      const pattern = `%${escapeLikePattern(input.q)}%`
      where.$or = [{ label: { $ilike: pattern } }, { slug: { $ilike: pattern } }]
    }
    const [rows, total] = await Promise.all([
      findWithDecryption<CustomerTag>(
        em,
        CustomerTag,
        where as any,
        { limit, offset, orderBy: { label: 'asc' } as any } as any,
        buildScope(ctx, tenantId),
      ),
      em.count(CustomerTag, where as any),
    ])
    const filtered = rows.filter((row) => row.tenantId === tenantId)
    return {
      items: filtered.map((row) => ({
        id: row.id,
        slug: row.slug,
        label: row.label,
        color: row.color ?? null,
        description: row.description ?? null,
        organizationId: row.organizationId ?? null,
        tenantId: row.tenantId ?? null,
      })),
      total,
      limit,
      offset,
    }
  },
}

export const addressesTagsAiTools: CustomersAiToolDefinition[] = [listAddressesTool, listTagsTool]

export default addressesTagsAiTools
