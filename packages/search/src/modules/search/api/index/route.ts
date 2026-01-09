import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import type { VectorIndexService } from '../../../../vector'
import { recordIndexerLog } from '@/lib/indexers/status-log'
import { writeCoverageCounts } from '@open-mercato/core/modules/query_index/lib/coverage'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['search.view'] },
  DELETE: { requireAuth: true, requireFeatures: ['search.embeddings.manage'] },
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
    return NextResponse.json({ error: t('search.api.errors.indexUnavailable', 'Vector index unavailable') }, { status: 503 })
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
  } catch (error: unknown) {
    const err = error as { status?: number; statusCode?: number }
    const status = typeof err?.status === 'number'
      ? err.status
      : (typeof err?.statusCode === 'number' ? err.statusCode : 500)
    // Log full error details server-side only
    console.error('[search.index.list] failed', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    })
    // Return generic message to client - don't expose internal error details
    return NextResponse.json(
      { error: t('search.api.errors.indexFetchFailed', 'Failed to fetch vector index. Please try again.') },
      { status: status >= 400 ? status : 500 }
    )
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
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
  const confirmAll = url.searchParams.get('confirmAll') === 'true'

  // Require explicit confirmation when purging ALL entities (dangerous operation)
  if (!entityIdParam && !confirmAll) {
    return NextResponse.json(
      { error: t('search.api.errors.confirmAllRequired', 'Purging all entities requires confirmAll=true parameter.') },
      { status: 400 }
    )
  }

  const container = await createRequestContainer()
  let service: VectorIndexService
  try {
    service = (container.resolve('vectorIndexService') as VectorIndexService)
  } catch {
    return NextResponse.json({ error: t('search.api.errors.indexUnavailable', 'Vector index unavailable') }, { status: 503 })
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
        handler: 'api:search.index.purge',
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
        console.warn('[search.index.purge] Failed to reset coverage after purge', coverageError)
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
        handler: 'api:search.index.purge',
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
  } catch (error: unknown) {
    const err = error as { status?: number; statusCode?: number }
    const status = typeof err?.status === 'number'
      ? err.status
      : (typeof err?.statusCode === 'number' ? err.statusCode : 500)
    const errorMessage = error instanceof Error ? error.message : String(error)
    // Log full error details server-side only
    console.error('[search.index.purge] failed', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    })
    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'vector',
        handler: 'api:search.index.purge',
        level: 'warn',
        message: entityIdParam
          ? `Vector purge failed for ${entityIdParam}`
          : 'Vector purge failed for all entities',
        entityType: entityIdParam ?? null,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        details: { error: errorMessage, entityIds },
      },
    ).catch(() => undefined)
    // Return generic message to client - don't expose internal error details
    return NextResponse.json(
      { error: t('search.api.errors.purgeFailed', 'Vector index purge failed. Please try again.') },
      { status: status >= 400 ? status : 500 }
    )
  }
}
