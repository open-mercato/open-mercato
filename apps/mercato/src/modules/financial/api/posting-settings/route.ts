import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  readPostingSettingsRecord,
  writePostingSettings,
  type PostingSettingsRecord,
} from '../../lib/postingSettings'

const logger = createLogger('financial')

export const metadata = {
  path: '/financial/posting-settings',
  GET: { requireAuth: true, requireFeatures: ['financial.read'] },
  PUT: { requireAuth: true, requireFeatures: ['financial.admin'] },
}

const RESOURCE_KIND = 'financial.posting_settings'
const RESOURCE_ID = 'posting'
const MANAGE_FEATURE = 'financial.admin'

const accountCode = z.string().trim().max(20).regex(/^[A-Za-z0-9_-]+$/).optional().nullable()

const postingSettingsInputSchema = z.object({
  receivableAccountCode: accountCode,
  revenueAccountCode: accountCode,
  outputVatAccountCode: accountCode,
  payableAccountCode: accountCode,
  inputVatAccountCode: accountCode,
  cashAccountCode: accountCode,
  bankAccountCode: accountCode,
})

type SettingsContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  tenantId: string
  organizationId: string | null
  actorId: string
  canManage: boolean
}

async function resolveContext(req: Request): Promise<SettingsContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
  }
  const actorId = (typeof auth.sub === 'string' && auth.sub.trim().length > 0 && auth.sub) || 'system'
  const rbac = container.resolve<RbacService>('rbacService')
  const featureContext = await resolveFeatureCheckContext({ container, auth, request: req })
  const canManage = await rbac.userHasAllFeatures(auth.sub, [MANAGE_FEATURE], {
    tenantId: featureContext.scope.tenantId ?? auth.tenantId ?? null,
    organizationId: featureContext.organizationId,
  })
  return {
    container,
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
    actorId,
    canManage,
  }
}

function configService(context: SettingsContext): ModuleConfigService {
  return context.container.resolve('moduleConfigService') as ModuleConfigService
}

function toResponse(record: PostingSettingsRecord, canManage: boolean) {
  return { ...record.settings, canManage, updatedAt: record.updatedAt }
}

async function GET(req: Request) {
  try {
    const context = await resolveContext(req)
    const record = await readPostingSettingsRecord(configService(context), { tenantId: context.tenantId })
    return NextResponse.json(toResponse(record, context.canManage))
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('financial.posting_settings.GET failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function PUT(req: Request) {
  try {
    const context = await resolveContext(req)
    const raw = await readJsonSafe(req, null)
    const input = postingSettingsInputSchema.parse(raw ?? {})

    const guardResult = await validateCrudMutationGuard(context.container, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userId: context.actorId,
      resourceKind: RESOURCE_KIND,
      resourceId: RESOURCE_ID,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: input,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const existing = await readPostingSettingsRecord(configService(context), { tenantId: context.tenantId })
    await enforceCommandOptimisticLockWithGuards(context.container, {
      resourceKind: RESOURCE_KIND,
      resourceId: RESOURCE_ID,
      current: existing.updatedAt,
      request: req,
    })

    const record = await writePostingSettings(
      configService(context),
      { tenantId: context.tenantId },
      input,
    )

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(context.container, {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        userId: context.actorId,
        resourceKind: RESOURCE_KIND,
        resourceId: RESOURCE_ID,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json(toResponse(record, true))
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      const { translate } = await resolveTranslations()
      return NextResponse.json(
        { error: translate('financial.errors.invalid_posting_settings', 'Invalid posting settings'), details: err.issues },
        { status: 400 },
      )
    }
    logger.error('financial.posting_settings.PUT failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const responseSchema = z.object({
  receivableAccountCode: z.string().nullable().optional(),
  revenueAccountCode: z.string().nullable().optional(),
  outputVatAccountCode: z.string().nullable().optional(),
  payableAccountCode: z.string().nullable().optional(),
  inputVatAccountCode: z.string().nullable().optional(),
  cashAccountCode: z.string().nullable().optional(),
  bankAccountCode: z.string().nullable().optional(),
  canManage: z.boolean(),
  updatedAt: z.string().nullable(),
})

const getDoc: OpenApiMethodDoc = {
  summary: 'Read the automatic posting account mapping',
  responses: [{ status: 200, description: 'Posting settings', schema: responseSchema }],
}

const putDoc: OpenApiMethodDoc = {
  summary: 'Replace the automatic posting account mapping',
  requestBody: { contentType: 'application/json', schema: postingSettingsInputSchema },
  responses: [{ status: 200, description: 'Posting settings', schema: responseSchema }],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Automatic posting account mapping',
  methods: { GET: getDoc, PUT: putDoc },
}

export { GET, PUT }
