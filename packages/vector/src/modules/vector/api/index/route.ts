import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import type { VectorIndexService } from '@open-mercato/vector'
import { recordIndexerLog } from '@/lib/indexers/status-log'
import { writeCoverageCounts } from '@open-mercato/core/modules/query_index/lib/coverage'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['vector.search'] },
  DELETE: { requireAuth: true, requireFeatures: ['vector.manage'] },
}

function parseLimit(value: string | null): number {
  if (!value) return 50
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed <= 0) return 50
  return Math.min(parsed, 200)
}

function parseOffset(value: string | null): number {
  if (!value) return 0
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 0) return 0
  return parsed
}

export async function GET(req: Request) {
  const { t } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }

  const url = new URL(req.url)
  const entityIdParam = url.searchParams.get('entityId')
  const limit = parseLimit(url.searchParams.get('limit'))
  const offset = parseOffset(url.searchParams.get('offset'))

  const container = await createRequestContainer()
  let service: VectorIndexService
  try {
    service = (container.resolve('vectorIndexService') as VectorIndexService)
  } catch {
    return NextResponse.json({ error: t('vector.api.errors.indexUnavailable', 'Vector index unavailable') }, { status: 503 })
  }

  try {
    const entries = await service.listIndexEntries({
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
      entityId: entityIdParam ?? undefined,
      limit,
      offset,
    })
    return NextResponse.json({ entries, limit, offset })
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : t('vector.api.errors.indexFetchFailed', 'Vector index fetch failed')
    const status = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : undefined)
    console.error('[vector.index.list] failed', error)
    return NextResponse.json({ error: message }, { status: status && status >= 400 ? status : 500 })
  }
}

export async function DELETE(req: Request) {
  const { t } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }

  const url = new URL(req.url)
  const entityIdParam = url.searchParams.get('entityId')

  const container = await createRequestContainer()
  let service: VectorIndexService
  try {
    service = (container.resolve('vectorIndexService') as VectorIndexService)
  } catch {
    return NextResponse.json({ error: t('vector.api.errors.indexUnavailable', 'Vector index unavailable') }, { status: 503 })
  }

  let em: any | null = null
  try {
    em = container.resolve('em')
  } catch {}
  let eventBus: { emitEvent(event: string, payload: any, options?: any): Promise<void> } | null = null
  try {
    eventBus = container.resolve('eventBus')
  } catch {
    eventBus = null
  }

  const entityIds = entityIdParam ? [entityIdParam] : service.listEnabledEntities()
  const scopes = new Set<string>()
  const registerScope = (org: string | null) => {
    const key = org ?? '__null__'
    if (!scopes.has(key)) scopes.add(key)
  }
  registerScope(null)
  if (auth.orgId) registerScope(auth.orgId)

  try {
    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'vector',
        handler: 'api:vector.index.purge',
        message: entityIdParam
          ? `Vector purge requested for ${entityIdParam}`
          : 'Vector purge requested for all entities',
        entityType: entityIdParam ?? null,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        details: { entityIds },
      },
    ).catch(() => undefined)
    await service.purgeIndex({
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
      entityId: entityIdParam ?? undefined,
    })
    if (em) {
      try {
        for (const entityId of entityIds) {
          for (const scope of scopes) {
            const orgValue = scope === '__null__' ? null : scope
            await writeCoverageCounts(
              em,
              {
                entityType: entityId,
                tenantId: auth.tenantId,
                organizationId: orgValue,
                withDeleted: false,
              },
              { vectorCount: 0 },
            )
          }
        }
      } catch (coverageError) {
        console.warn('[vector.index.purge] Failed to reset coverage after purge', coverageError)
      }
    }
    if (eventBus) {
      await Promise.all(
        entityIds.flatMap((entityId) =>
          Array.from(scopes).map((scope) => {
            const orgValue = scope === '__null__' ? null : scope
            return eventBus!
              .emitEvent(
                'query_index.coverage.refresh',
                {
                  entityType: entityId,
                  tenantId: auth.tenantId,
                  organizationId: orgValue,
                  delayMs: 0,
                },
              )
              .catch(() => undefined)
          }),
        ),
      )
    }
    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'vector',
        handler: 'api:vector.index.purge',
        message: entityIdParam
          ? `Vector purge completed for ${entityIdParam}`
          : 'Vector purge completed for all entities',
        entityType: entityIdParam ?? null,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        details: { entityIds },
      },
    ).catch(() => undefined)
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : t('vector.api.errors.purgeFailed', 'Vector index purge failed')
    const status = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : undefined)
    console.error('[vector.index.purge] failed', error)
    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'vector',
        handler: 'api:vector.index.purge',
        level: 'warn',
        message: entityIdParam
          ? `Vector purge failed for ${entityIdParam}`
          : 'Vector purge failed for all entities',
        entityType: entityIdParam ?? null,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        details: { error: message, entityIds },
      },
    ).catch(() => undefined)
    return NextResponse.json({ error: message }, { status: status && status >= 400 ? status : 500 })
  }
}
