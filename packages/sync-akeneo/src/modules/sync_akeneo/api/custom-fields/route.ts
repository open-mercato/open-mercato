import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { createAkeneoClient } from '../../lib/client'
import { createAkeneoImporter } from '../../lib/catalog-importer'
import { normalizeAkeneoMapping } from '../../lib/shared'
import { loadAkeneoMapping } from '../../lib/mapping'

const PRODUCT_ENTITY_ID = 'catalog:catalog_product'
const VARIANT_ENTITY_ID = 'catalog:catalog_product_variant'

const requestSchema = z.object({
  mapping: z.record(z.string(), z.unknown()).optional(),
})

const responseSchema = z.object({
  ok: z.boolean(),
  productKeys: z.array(z.string()).default([]),
  variantKeys: z.array(z.string()).default([]),
  createdKeys: z.array(z.string()).default([]),
  message: z.string().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['data_sync.configure'] },
  POST: { requireAuth: true, requireFeatures: ['data_sync.configure'] },
}

export const openApi = {
  tags: ['Akeneo'],
  summary: 'Inspect and create Akeneo-backed custom fields',
}

async function loadActiveKeys(auth: { orgId?: string | null; tenantId?: string | null }, em: EntityManager) {
  const defs = await findWithDecryption(em, CustomFieldDef, {
    entityId: { $in: [PRODUCT_ENTITY_ID, VARIANT_ENTITY_ID] },
    organizationId: auth.orgId ?? undefined,
    tenantId: auth.tenantId ?? undefined,
    deletedAt: null,
    isActive: true,
  }, {
    fields: ['entityId', 'key'],
    orderBy: { key: 'asc' },
  }, {
    organizationId: auth.orgId ?? undefined,
    tenantId: auth.tenantId ?? undefined,
  })

  const productKeys = new Set<string>()
  const variantKeys = new Set<string>()
  for (const def of defs as Array<{ entityId: string; key: string }>) {
    if (def.entityId === PRODUCT_ENTITY_ID) productKeys.add(def.key)
    if (def.entityId === VARIANT_ENTITY_ID) variantKeys.add(def.key)
  }

  return {
    productKeys: Array.from(productKeys).sort(),
    variantKeys: Array.from(variantKeys).sort(),
  }
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ ok: false, productKeys: [], variantKeys: [], message: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const keys = await loadActiveKeys(auth, em)
  return NextResponse.json(responseSchema.parse({
    ok: true,
    ...keys,
  }))
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ ok: false, productKeys: [], variantKeys: [], message: 'Unauthorized' }, { status: 401 })
  }

  const parsedBody = requestSchema.safeParse(await readJsonSafe(req))
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, productKeys: [], variantKeys: [], message: 'Invalid payload' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
  const em = container.resolve('em') as EntityManager
  const scope = {
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
  }

  const credentials = await credentialsService.resolve('sync_akeneo', scope)
  if (!credentials) {
    return NextResponse.json(responseSchema.parse({
      ok: false,
      productKeys: [],
      variantKeys: [],
      message: 'Save Akeneo credentials before creating custom fields.',
    }), { status: 400 })
  }

  const before = await loadActiveKeys(auth, em)
  const baseMapping = parsedBody.data.mapping
    ? normalizeAkeneoMapping('products', parsedBody.data.mapping)
    : await loadAkeneoMapping(em, 'products', scope)
  const client = createAkeneoClient(credentials)
  const importer = await createAkeneoImporter(client, scope)
  await importer.syncMappedCustomFields(baseMapping, baseMapping.settings?.products?.locale ?? 'en_US')
  const after = await loadActiveKeys(auth, em)

  const createdKeys = [
    ...after.productKeys
      .filter((key) => !before.productKeys.includes(key))
      .map((key) => `${PRODUCT_ENTITY_ID}:${key}`),
    ...after.variantKeys
      .filter((key) => !before.variantKeys.includes(key))
      .map((key) => `${VARIANT_ENTITY_ID}:${key}`),
  ]

  return NextResponse.json(responseSchema.parse({
    ok: true,
    productKeys: after.productKeys,
    variantKeys: after.variantKeys,
    createdKeys,
    message: createdKeys.length > 0
      ? `Created ${createdKeys.length} custom field definition${createdKeys.length === 1 ? '' : 's'}.`
      : 'All mapped Akeneo custom fields already exist.',
  }))
}
