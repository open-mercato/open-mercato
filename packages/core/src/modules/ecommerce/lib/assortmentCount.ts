import type { AwilixContainer } from 'awilix'
import type { AssortmentScope, EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { QueryEngine, Where } from '@open-mercato/shared/lib/query/types'
import { PRODUCT_SCOPE_KEYS_DOC_KEY } from '@open-mercato/core/modules/catalog/lib/productScopeKeys'
import { E } from '#generated/entities.ids.generated'
import { ecommerceAssortmentScopeSchema } from '../data/validators'
import { resolveAnonymousAssortmentScope } from './buyerContext'
import type { Translate } from './crudSupport'
import { buildStorefrontProductScope, composeStorefrontProductFilters } from './storefrontProductScope'

const logger = createLogger('ecommerce').child({ component: 'assortment-count' })

export type AssortmentCountScopeSource = 'saved' | 'draft'

export type AssortmentCountResponse = {
  count: number
  scopeSource: AssortmentCountScopeSource
  requireAuthentication: boolean
  reducedByAuthentication: boolean
  countWithoutAuthentication: number
  unindexedCount: number
}

export type AssortmentCountDraft = {
  scope?: AssortmentScope | null
  requireAuthentication?: boolean
}

export type AssortmentCountDraftResult =
  | { ok: true; draft: AssortmentCountDraft }
  | { ok: false; fieldErrors: Record<string, string> }

export const DRAFT_SCOPE_PARAM = 'draftScope'
export const DRAFT_REQUIRE_AUTHENTICATION_PARAM = 'draftRequireAuthentication'

function readSingleParam(searchParams: URLSearchParams, name: string): string | null | 'duplicate' {
  const values = searchParams.getAll(name)
  if (values.length === 0) return null
  if (values.length > 1) return 'duplicate'
  return values[0]
}

/**
 * Parses the unsaved Channels-tab state a count request may carry. `draftScope` is a JSON-encoded
 * `assortment_scope` validated with the schema the channel binding write path uses, so `allOf` and
 * any unknown key are rejected exactly as they are on save; `draftRequireAuthentication` is a
 * boolean token. Absent parameters fall back to the saved binding.
 */
export function parseAssortmentCountDraft(searchParams: URLSearchParams, translate: Translate): AssortmentCountDraftResult {
  const fieldErrors: Record<string, string> = {}
  const draft: AssortmentCountDraft = {}

  const rawScope = readSingleParam(searchParams, DRAFT_SCOPE_PARAM)
  if (rawScope !== null) {
    const invalidJson = translate(
      'ecommerce.validation.draftScopeJsonInvalid',
      'The draft scope must be a JSON-encoded assortment scope.',
    )
    if (rawScope === 'duplicate') {
      fieldErrors[DRAFT_SCOPE_PARAM] = invalidJson
    } else {
      let decoded: unknown
      let decodable = true
      try {
        decoded = JSON.parse(rawScope)
      } catch {
        decodable = false
        fieldErrors[DRAFT_SCOPE_PARAM] = invalidJson
      }
      if (decodable) {
        const parsed = ecommerceAssortmentScopeSchema.safeParse(decoded)
        if (parsed.success) {
          draft.scope = parsed.data
        } else {
          fieldErrors[DRAFT_SCOPE_PARAM] = translate(
            'ecommerce.validation.draftScopeInvalid',
            'The draft scope may only contain category, tag and excluded product, category and tag ids.',
          )
        }
      }
    }
  }

  const rawRequireAuthentication = readSingleParam(searchParams, DRAFT_REQUIRE_AUTHENTICATION_PARAM)
  if (rawRequireAuthentication !== null) {
    const parsed = rawRequireAuthentication === 'duplicate' ? null : parseBooleanToken(rawRequireAuthentication)
    if (parsed === null) {
      fieldErrors[DRAFT_REQUIRE_AUTHENTICATION_PARAM] = translate(
        'ecommerce.validation.draftRequireAuthenticationInvalid',
        'The draft require-authentication value must be true or false.',
      )
    } else {
      draft.requireAuthentication = parsed
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors }
  return { ok: true, draft }
}

type CountScope = { tenantId: string; organizationId: string }

async function countStorefrontProducts(
  queryEngine: QueryEngine,
  scope: CountScope,
  assortmentScope: EffectiveAssortmentScope,
  extra?: Where,
): Promise<number> {
  if (Array.isArray(assortmentScope) && assortmentScope.length === 0) return 0
  const productScope = buildStorefrontProductScope({ ...scope, buyer: { assortmentScope } })
  const result = await queryEngine.query(E.catalog.catalog_product, {
    tenantId: productScope.tenantId,
    organizationId: productScope.organizationId,
    withDeleted: productScope.withDeleted,
    filters: composeStorefrontProductFilters(productScope, extra),
    fields: ['id'],
    page: { page: 1, pageSize: 1 },
  })
  return result.total
}

/**
 * Live product count behind the Channels tab (SPEC-029 §9.2, §10a US-E1): how many products the
 * channel would show an anonymous buyer. The effective assortment comes from the storefront's own
 * buyer resolution (`resolveAnonymousAssortmentScope`) and is counted through the same
 * `buildStorefrontProductScope` + `composeStorefrontProductFilters` query the listing composes, so
 * the admin number cannot drift from the storefront's total.
 *
 * `count` is the anonymous figure — `0` while `requireAuthentication` is on — and
 * `countWithoutAuthentication` is what the same scope would show with the gate off, so the form can
 * say how many products the toggle hides. `unindexedCount` reports active products with no
 * `scope_keys` document yet: they fail closed under any restricted scope, so a non-zero value
 * explains a count that looks too low.
 */
export async function countChannelAssortment(
  container: AwilixContainer,
  input: {
    tenantId: string
    organizationId: string
    channelAssortmentScope: AssortmentScope | null
    requireAuthentication: boolean
    scopeSource: AssortmentCountScopeSource
  },
): Promise<AssortmentCountResponse> {
  const queryEngine = container.resolve('queryEngine') as QueryEngine
  const scope: CountScope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const openScope = await resolveAnonymousAssortmentScope(container, {
    tenantId: input.tenantId,
    channelAssortmentScope: input.channelAssortmentScope,
    requireAuthentication: false,
  })
  const countWithoutAuthentication = await countStorefrontProducts(queryEngine, scope, openScope)
  const count = input.requireAuthentication ? 0 : countWithoutAuthentication
  const restricted = openScope !== null && openScope.length > 0
  const unindexedCount = restricted
    ? await countStorefrontProducts(queryEngine, scope, null, { [PRODUCT_SCOPE_KEYS_DOC_KEY]: { $exists: false } })
    : 0
  if (unindexedCount > 0) {
    logger.info('Active products without a scope index fail closed under a restricted assortment scope', {
      organizationId: input.organizationId,
      scopeSource: input.scopeSource,
      unindexedCount,
    })
  }
  return {
    count,
    scopeSource: input.scopeSource,
    requireAuthentication: input.requireAuthentication,
    reducedByAuthentication: input.requireAuthentication && countWithoutAuthentication > 0,
    countWithoutAuthentication,
    unindexedCount,
  }
}
