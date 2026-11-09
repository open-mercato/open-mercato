import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { StoreBrandingUpdateInput, StoreBrandingUpdateResult } from '../../../../commands/stores'
import { ecommerceStoreBrandingSchema, type EcommerceStoreBranding } from '../../../../data/validators'
import {
  BRANDING_MANAGE_FEATURE,
  resolveBrandingRouteContext,
  resolveGrantedFeatures,
  storeIdParamSchema,
} from '../../../../lib/storeBrandingRoute'
import {
  parseBrandingInput,
  STORE_BRANDING_RESOURCE_KIND,
  STORE_BRANDING_UPDATE_COMMAND_ID,
} from '../../../../lib/storeBranding'
import { ecommerceInternalErrorBody } from '../../../../lib/crudSupport'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: [BRANDING_MANAGE_FEATURE] },
}

const logger = createLogger('ecommerce').child({ component: 'store-branding-route' })

type RouteParams = { params?: { id?: string } | Promise<{ id?: string }> }

async function readStoreId(ctx: RouteParams): Promise<string | null> {
  const params = await ctx.params
  const parsed = storeIdParamSchema.safeParse(params?.id)
  return parsed.success ? parsed.data : null
}

async function readJsonBody(req: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  const text = await req.text()
  if (text.trim().length === 0) return { ok: true, body: {} }
  try {
    return { ok: true, body: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

function invalidBranding(fieldErrors: Record<string, string>) {
  const [message] = Object.values(fieldErrors)
  return NextResponse.json({ error: message, fieldErrors }, { status: 400 })
}

export async function PUT(req: Request, ctx: RouteParams) {
  try {
    const context = await resolveBrandingRouteContext(req)
    const { translate } = await resolveTranslations()
    const storeId = await readStoreId(ctx)
    if (!storeId) return NextResponse.json({ error: translate('ecommerce.errors.storeNotFound', 'The selected store does not exist in this organization.') }, { status: 404 })

    const raw = await readJsonBody(req)
    if (!raw.ok) {
      return NextResponse.json(
        { error: translate('ecommerce.errors.invalidJsonBody', 'The request body is not valid JSON.') },
        { status: 400 },
      )
    }
    const parsed = parseBrandingInput(raw.body, translate)
    if (!parsed.ok) return invalidBranding(parsed.fieldErrors)
    let branding: EcommerceStoreBranding = parsed.branding

    const legacyGuard = bridgeLegacyGuard(context.container)
    const guards: MutationGuard[] = [...getAllMutationGuardInstances()]
    if (legacyGuard) guards.push(legacyGuard)
    const guardInput = {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userId: context.auth.sub ?? '',
      resourceKind: STORE_BRANDING_RESOURCE_KIND,
      resourceId: storeId,
      operation: 'update' as const,
      requestMethod: req.method,
      requestHeaders: req.headers,
    }
    const guardResult = await runMutationGuards(
      guards,
      { ...guardInput, mutationPayload: { ...branding } },
      { userFeatures: await resolveGrantedFeatures(context) },
    )
    if (!guardResult.ok) {
      const blocked = guardResult.errorBody ?? {
        error: translate('ecommerce.errors.operationBlocked', 'This change was blocked. Review the store and try again.'),
      }
      return NextResponse.json(blocked, {
        status: guardResult.errorStatus ?? 422,
      })
    }
    if (guardResult.modifiedPayload) {
      const merged = parseBrandingInput({ ...branding, ...guardResult.modifiedPayload }, translate)
      if (!merged.ok) return invalidBranding(merged.fieldErrors)
      branding = merged.branding
    }

    const commandBus = context.container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<StoreBrandingUpdateInput, StoreBrandingUpdateResult>(
      STORE_BRANDING_UPDATE_COMMAND_ID,
      {
        input: { id: storeId, tenantId: context.tenantId, organizationId: context.organizationId, branding },
        ctx: context.commandCtx,
      },
    )

    for (const callback of guardResult.afterSuccessCallbacks) {
      if (!callback.guard.afterSuccess) continue
      try {
        await callback.guard.afterSuccess({ ...guardInput, metadata: callback.metadata ?? null })
      } catch (callbackError) {
        logger.error('Mutation guard afterSuccess callback failed', {
          guardId: callback.guard.id,
          err: callbackError,
        })
      }
    }

    const response = NextResponse.json({ id: result.id, updatedAt: result.updatedAt, branding: result.branding })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? STORE_BRANDING_RESOURCE_KIND,
          resourceId: logEntry.resourceId ?? result.id,
          executedAt:
            logEntry.createdAt instanceof Date
              ? logEntry.createdAt.toISOString()
              : typeof logEntry.createdAt === 'string'
                ? logEntry.createdAt
                : new Date().toISOString(),
        }),
      )
    }
    return response
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    logger.error('ecommerce.stores.branding.PUT failed', { err })
    return NextResponse.json(await ecommerceInternalErrorBody(), { status: 500 })
  }
}

const brandingResponseSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string().describe('The store updated_at after the write; send it as the expected version of the next save.'),
  branding: ecommerceStoreBrandingSchema,
})

const errorSchema = z.object({ error: z.string() }).passthrough()

const fieldErrorsSchema = z.object({
  error: z.string(),
  fieldErrors: z.record(z.string(), z.string()),
})

const conflictSchema = z.object({
  error: z.string(),
  code: z.string(),
  currentUpdatedAt: z.string(),
  expectedUpdatedAt: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Ecommerce',
  summary: 'Store branding',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    PUT: {
      summary: 'Replace the branding of a store',
      description:
        'Command route behind the Branding tab. Replaces settings.branding with the validated body (omitted or empty keys are cleared) and merges it into the stored settings server-side, so contact, display and SEO values are never touched. Requires ecommerce.branding.manage. Runs the mutation guard registry as an update, honours the x-om-ext-optimistic-lock-expected-updated-at header against the store updated_at (409 on a stale version), is undoable, and emits ecommerce.store.branding_updated, which evicts the storefront caches of the store.',
      tags: ['Ecommerce'],
      requestBody: { schema: ecommerceStoreBrandingSchema },
      responses: [{ status: 200, description: 'Branding saved', schema: brandingResponseSchema }],
      errors: [
        { status: 400, description: 'A branding value is invalid; fieldErrors maps each rejected key to a message', schema: fieldErrorsSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing ecommerce.branding.manage', schema: errorSchema },
        { status: 404, description: 'The store does not exist in the selected organization', schema: errorSchema },
        { status: 409, description: 'The store changed since it was loaded (optimistic lock)', schema: conflictSchema },
        { status: 422, description: 'Blocked by a mutation guard', schema: errorSchema },
      ],
    },
  },
}
