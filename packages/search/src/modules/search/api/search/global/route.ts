import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import type { SearchService } from '@open-mercato/search'
import type { EmbeddingService } from '../../../../../vector'
import { resolveEmbeddingConfig } from '../../../lib/embedding-config'
import { resolveGlobalSearchStrategies } from '../../../lib/global-search-config'
import {
  filterSearchResultsByEntityAccess,
  resolveReadableEntityTypes,
  type SearchEntityConfigLookup,
} from '../../../lib/entity-access'
import { searchDebug, searchError } from '../../../../../lib/debug'
import { globalSearchOpenApi } from '../../openapi'

/**
 * `search.global` — the same feature the topbar gates the Cmd+K palette on
 * (`BackendHeaderChrome`). It used to be `search.view`, which is the
 * search-administration feature guarding the settings endpoints; the two gates
 * could disagree in either direction, so a role holding only one of them either
 * saw a search box that 403'd on every keystroke or could query the endpoint with
 * no UI. `search.view` stays on `api/settings/**`, where it belongs.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['search.global'] },
}

type RbacLike = {
  loadAcl: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<{ isSuperAdmin: boolean; features: string[]; organizations: string[] | null }>
}

function parseLimit(value: string | null): number {
  if (!value) return 50
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed <= 0) return 50
  return Math.min(parsed, 100)
}

function parseEntityTypes(value: string | null): string[] | undefined {
  if (!value) return undefined
  const entityTypes = value.split(',').map((s) => s.trim()).filter(Boolean)
  return entityTypes.length > 0 ? entityTypes : undefined
}

/**
 * Global search endpoint for Cmd+K.
 * Always uses saved global search settings - does NOT accept strategies from URL.
 */
export async function GET(req: Request) {
  const { t } = await resolveTranslations()
  const url = new URL(req.url)
  const query = (url.searchParams.get('q') || '').trim()
  const limit = parseLimit(url.searchParams.get('limit'))
  const entityTypes = parseEntityTypes(url.searchParams.get('entityTypes'))

  if (!query) {
    return NextResponse.json(
      { error: t('search.api.errors.missingQuery', 'Missing query') },
      { status: 400 }
    )
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json(
      { error: t('api.errors.unauthorized', 'Unauthorized') },
      { status: 401 }
    )
  }

  const container = await createRequestContainer()
  try {
    const searchService = container.resolve('searchService') as SearchService | undefined
    if (!searchService) {
      return NextResponse.json(
        { error: t('search.api.errors.serviceUnavailable', 'Search service unavailable') },
        { status: 503 }
      )
    }

    // Fail closed: without the RBAC service or the entity registry there is no way
    // to tell which entity types this caller may read, so refuse rather than search.
    if (!container.hasRegistration('rbacService') || !container.hasRegistration('searchIndexer')) {
      searchError('search.api.global', 'entity-acl-unavailable', {
        rbacService: container.hasRegistration('rbacService'),
        searchIndexer: container.hasRegistration('searchIndexer'),
      })
      return NextResponse.json(
        { error: t('search.api.errors.serviceUnavailable', 'Search service unavailable') },
        { status: 503 }
      )
    }
    const rbac = container.resolve('rbacService') as RbacLike
    const searchIndexer = container.resolve('searchIndexer') as SearchEntityConfigLookup

    // Fetch saved global search strategies (per-tenant; falls back to the instance default)
    const strategies = await resolveGlobalSearchStrategies(container, { scope: { tenantId: auth.tenantId } })

    // Load embedding config for vector strategy (only if vector is enabled)
    if (strategies.includes('vector')) {
      try {
        const embeddingConfig = await resolveEmbeddingConfig(container, { defaultValue: null })
        if (embeddingConfig) {
          const embeddingService = container.resolve<EmbeddingService>('vectorEmbeddingService')
          embeddingService.updateConfig(embeddingConfig)
        }
      } catch {
        // Embedding config not available, vector strategy may not work
      }
    }

    const startTime = Date.now()

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    if (Array.isArray(scope.filterIds) && scope.filterIds.length === 0) {
      return NextResponse.json({
        results: [],
        strategiesUsed: [],
        strategiesEnabled: strategies,
        timing: 0,
        query,
        limit,
      })
    }

    const scopeFilter = resolveOrganizationScopeFilter(scope, auth)
    const organizationId =
      typeof scope.selectedId === 'string' && scope.selectedId.trim().length > 0 ? scope.selectedId.trim() : undefined

    // `search.global` authorizes using the palette, not reading every indexed
    // record. Narrow the query to the entity types this caller may read so the
    // result budget is not spent on records that would only be filtered out.
    const acl = await rbac.loadAcl(auth.sub, {
      tenantId: scope.tenantId ?? auth.tenantId ?? null,
      organizationId: organizationId ?? null,
    })
    const subject = { grantedFeatures: acl.features, isSuperAdmin: acl.isSuperAdmin }
    const readableEntityTypes = resolveReadableEntityTypes(searchIndexer, subject, entityTypes)
    if (readableEntityTypes && readableEntityTypes.length === 0) {
      return NextResponse.json({
        results: [],
        strategiesUsed: [],
        strategiesEnabled: strategies,
        timing: Date.now() - startTime,
        query,
        limit,
      })
    }

    const searchOptions = {
      tenantId: auth.tenantId,
      organizationId,
      organizationIds: scopeFilter.organizationIds,
      limit,
      strategies,
      entityTypes: readableEntityTypes,
    }

    const rawResults = await searchService.search(query, searchOptions)

    // Defense in depth: a strategy that ignores `entityTypes` must still not leak
    // a presenter title, subtitle or deep link past the per-entity gate.
    const results = filterSearchResultsByEntityAccess(
      rawResults,
      searchIndexer,
      { grantedFeatures: acl.features, isSuperAdmin: acl.isSuperAdmin },
      {
        onDeny: (deniedEntityId, reason) => {
          searchDebug('search.api.global', 'entity-filtered', { entityId: deniedEntityId, reason })
        },
      },
    )

    const timing = Date.now() - startTime

    // Collect unique strategies that returned results
    const strategiesUsed = [...new Set(results.map((r) => r.source))]

    return NextResponse.json({
      results,
      strategiesUsed,
      strategiesEnabled: strategies,
      timing,
      query,
      limit,
    })
  } catch (error: unknown) {
    searchError('search.api.global', 'failed', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      { error: t('search.api.errors.searchFailed', 'Search failed. Please try again.') },
      { status: 500 }
    )
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}

export const openApi = globalSearchOpenApi
