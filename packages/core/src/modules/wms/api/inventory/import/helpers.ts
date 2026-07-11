import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { runCustomRouteAfterInterceptors } from '@open-mercato/shared/lib/crud/custom-route-interceptor'
import { parseInventoryImportCsv } from '../../../lib/inventoryImportCsv'
import { applyInventoryImport, validateInventoryImport } from '../../../lib/inventoryImportService'
import {
  inventoryImportApplySchema,
  inventoryImportValidateSchema,
} from '../../../data/validators'

type ImportRouteOptions = {
  request: Request
  routePath: string
  mode: 'validate' | 'apply'
}

/**
 * Fail-closed scope guard for inventory import payloads. Unlike the shared
 * `ensureOrganizationScope` (which short-circuits for tenant-wide admins with
 * `allowedIds === null`), this rejects payloads whose `organizationId`/`tenantId`
 * fall outside the caller's actively selected scope so cross-organization imports
 * cannot be smuggled through the request body.
 */
function assertImportScope(
  ctx: CommandRuntimeContext,
  input: { organizationId: string; tenantId: string },
  translate: (key: string, fallback?: string) => string,
): void {
  const forbidden = () =>
    new CrudHttpError(403, { error: translate('wms.errors.forbidden', 'Forbidden') })
  if (ctx.auth?.isSuperAdmin === true) return

  const actorTenantId = ctx.auth?.tenantId ?? null
  if (!actorTenantId || actorTenantId !== input.tenantId) {
    throw forbidden()
  }

  const allowedIds = ctx.organizationScope?.allowedIds ?? null
  if (Array.isArray(allowedIds)) {
    if (!allowedIds.includes(input.organizationId)) throw forbidden()
    return
  }

  const selectedOrganizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!selectedOrganizationId || selectedOrganizationId !== input.organizationId) {
    throw forbidden()
  }
}

async function buildImportContext(request: Request): Promise<CommandRuntimeContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('wms.errors.unauthorized', 'Unauthorized') })
  }
  const organizationScope = await resolveOrganizationScopeForRequest({
    container,
    auth,
    request,
  })
  return {
    container,
    auth,
    organizationScope,
    selectedOrganizationId: organizationScope?.selectedId ?? auth.orgId ?? null,
    organizationIds: organizationScope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request,
  }
}

async function parseValidatePayload(request: Request): Promise<z.infer<typeof inventoryImportValidateSchema>> {
  const { translate } = await resolveTranslations()
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const organizationId = String(formData.get('organizationId') ?? '').trim()
    const tenantId = String(formData.get('tenantId') ?? '').trim()
    const importBatchIdRaw = String(formData.get('importBatchId') ?? '').trim()
    const skipDuplicatesRaw = String(formData.get('skipDuplicates') ?? '').trim()
    const modeRaw = String(formData.get('mode') ?? '').trim()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      throw new CrudHttpError(400, {
        error: translate('wms.backend.inventory.import.errors.csvFileRequired', 'CSV file is required.'),
      })
    }
    const csvText = await file.text()
    const rows = parseInventoryImportCsv(csvText)
    return inventoryImportValidateSchema.parse({
      organizationId,
      tenantId,
      ...(importBatchIdRaw ? { importBatchId: importBatchIdRaw } : {}),
      ...(skipDuplicatesRaw ? { skipDuplicates: skipDuplicatesRaw === 'true' } : {}),
      ...(modeRaw ? { mode: modeRaw } : {}),
      rows,
    })
  }

  const body = (await readJsonSafe<Record<string, unknown>>(request, {})) ?? {}
  if (typeof body.csv === 'string' && body.csv.trim().length > 0) {
    const rows = parseInventoryImportCsv(body.csv)
    return inventoryImportValidateSchema.parse({
      ...body,
      rows,
    })
  }
  return inventoryImportValidateSchema.parse(body)
}

export async function executeWmsInventoryImportRoute(options: ImportRouteOptions) {
  const { translate } = await resolveTranslations()
  try {
    const ctx = await buildImportContext(options.request)
    const auth = ctx.auth
    if (!auth?.tenantId || !auth.sub) {
      throw new CrudHttpError(401, { error: translate('wms.errors.unauthorized', 'Unauthorized') })
    }

    if (options.mode === 'validate') {
      const parsed = await parseValidatePayload(options.request)
      assertImportScope(ctx, parsed, translate)
      const result = await validateInventoryImport(ctx, parsed)
      return NextResponse.json(result)
    }

    const parsed = inventoryImportApplySchema.parse(
      (await readJsonSafe<Record<string, unknown>>(options.request, {})) ?? {},
    )
    assertImportScope(ctx, parsed, translate)
    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId: auth.tenantId,
      organizationId: ctx.selectedOrganizationId,
      userId: auth.sub,
      resourceKind: 'wms.inventory',
      resourceId: parsed.importBatchId,
      operation: 'custom',
      requestMethod: options.request.method,
      requestHeaders: options.request.headers,
      mutationPayload: parsed as Record<string, unknown>,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const result = await applyInventoryImport(ctx, {
      ...parsed,
      performedBy: auth.sub,
    })
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId: auth.tenantId,
        organizationId: ctx.selectedOrganizationId,
        userId: auth.sub,
        resourceKind: 'wms.inventory',
        resourceId: parsed.importBatchId,
        operation: 'custom',
        requestMethod: options.request.method,
        requestHeaders: options.request.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    const intercepted = await runCustomRouteAfterInterceptors({
      routePath: options.routePath,
      method: 'POST',
      request: {
        method: 'POST',
        url: options.request.url,
        body: parsed as Record<string, unknown>,
        headers: Object.fromEntries(options.request.headers.entries()),
      },
      response: {
        statusCode: 200,
        body: result as Record<string, unknown>,
        headers: {},
      },
      context: {
        em: ctx.container.resolve('em'),
        container: ctx.container,
        userId: auth.sub,
        organizationId: ctx.selectedOrganizationId,
        tenantId: auth.tenantId,
      },
    })
    if (!intercepted.ok) {
      return NextResponse.json(intercepted.body, { status: intercepted.statusCode })
    }
    return NextResponse.json(intercepted.body, { status: intercepted.statusCode })
  } catch (error) {
    if (error instanceof CrudHttpError) {
      return NextResponse.json(error.body, { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: translate('wms.backend.inventory.import.errors.validationFailed', 'Validation failed.'),
          details: error.issues,
        },
        { status: 400 },
      )
    }
    console.error('[wms.inventory.import] route failed', error)
    return NextResponse.json(
      { error: translate('wms.errors.internalServerError', 'Internal server error') },
      { status: 500 },
    )
  }
}
