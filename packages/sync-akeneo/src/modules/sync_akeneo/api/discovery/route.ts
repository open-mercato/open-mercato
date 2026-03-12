import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { CatalogPriceKind } from '@open-mercato/core/modules/catalog/data/entities'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import { createAkeneoClient } from '../../lib/client'
import { akeneoDiscoveryQuerySchema, akeneoDiscoveryResponseSchema } from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['data_sync.configure'] },
}

export const openApi = {
  tags: ['Akeneo'],
  summary: 'Load Akeneo discovery metadata for field mapping',
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  }

  const parsed = akeneoDiscoveryQuerySchema.safeParse({
    refresh: new URL(req.url).searchParams.get('refresh') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Invalid query' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
  const em = container.resolve('em') as EntityManager
  const [localChannels, priceKinds] = await Promise.all([
    findWithDecryption(em, SalesChannel, {
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      deletedAt: null,
      isActive: true,
    }, {
      fields: ['code', 'name'],
      orderBy: { name: 'asc' },
    }, {
      organizationId: auth.orgId as string,
      tenantId: auth.tenantId,
    }),
    findWithDecryption(em, CatalogPriceKind, {
      tenantId: auth.tenantId,
      deletedAt: null,
      isActive: true,
    }, {
      fields: ['code', 'title', 'displayMode'],
      orderBy: { title: 'asc' },
    }, {
      organizationId: auth.orgId as string,
      tenantId: auth.tenantId,
    }),
  ])
  const credentials = await credentialsService.resolve('sync_akeneo', {
    organizationId: auth.orgId as string,
    tenantId: auth.tenantId,
  })

  if (!credentials) {
    const payload = akeneoDiscoveryResponseSchema.parse({
      ok: false,
      locales: [],
      channels: [],
      attributes: [],
      families: [],
      familyVariants: [],
      localChannels: localChannels
        .filter((channel) => typeof channel.code === 'string' && channel.code.trim().length > 0)
        .map((channel) => ({ code: String(channel.code), name: channel.name })),
      priceKinds: priceKinds.map((priceKind) => ({
        code: priceKind.code,
        title: priceKind.title,
        displayMode: priceKind.displayMode,
      })),
      message: 'Save Akeneo credentials before loading remote fields.',
    })
    return NextResponse.json(payload, { status: 200 })
  }

  try {
    const client = createAkeneoClient(credentials)
    const discovery = await client.collectDiscoveryData()
    const payload = akeneoDiscoveryResponseSchema.parse({
      ok: true,
      locales: discovery.locales,
      channels: discovery.channels,
      attributes: discovery.attributes,
      families: discovery.families,
      familyVariants: discovery.familyVariants,
      localChannels: localChannels
        .filter((channel) => typeof channel.code === 'string' && channel.code.trim().length > 0)
        .map((channel) => ({ code: String(channel.code), name: channel.name })),
      priceKinds: priceKinds.map((priceKind) => ({
        code: priceKind.code,
        title: priceKind.title,
        displayMode: priceKind.displayMode,
      })),
      message: discovery.version ? `Akeneo ${discovery.version}` : undefined,
    })
    return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load Akeneo metadata'
    const payload = akeneoDiscoveryResponseSchema.parse({
      ok: false,
      locales: [],
      channels: [],
      attributes: [],
      families: [],
      familyVariants: [],
      localChannels: localChannels
        .filter((channel) => typeof channel.code === 'string' && channel.code.trim().length > 0)
        .map((channel) => ({ code: String(channel.code), name: channel.name })),
      priceKinds: priceKinds.map((priceKind) => ({
        code: priceKind.code,
        title: priceKind.title,
        displayMode: priceKind.displayMode,
      })),
      message,
    })
    return NextResponse.json(payload, { status: 200 })
  }
}
