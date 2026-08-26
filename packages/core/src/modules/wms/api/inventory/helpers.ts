import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { runCustomRouteAfterInterceptors } from '@open-mercato/shared/lib/crud/custom-route-interceptor'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('wms')

type ResourceDescriptor = {
  resourceKind: string
  resourceId: string
}

type ExecuteWmsCustomPostRouteOptions<TInput, TResult> = {
  request: Request
  routePath: string
  inputSchema: z.ZodType<TInput>
  commandId: string
  describeResource: (input: TInput) => ResourceDescriptor
  mapSuccess: (result: TResult) => Record<string, unknown>
}

export async function executeWmsCustomPostRoute<TInput, TResult>(
  options: ExecuteWmsCustomPostRouteOptions<TInput, TResult>,
) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(options.request)
    const { translate } = await resolveTranslations()
    if (!auth || !auth.tenantId) {
      throw new CrudHttpError(401, { error: translate('wms.errors.unauthorized', 'Unauthorized') })
    }
    const organizationScope = await resolveOrganizationScopeForRequest({
      container,
      auth,
      request: options.request,
    })
    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope,
      selectedOrganizationId: organizationScope?.selectedId ?? auth.orgId ?? null,
      organizationIds: organizationScope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: options.request,
    }
    const body = await readJsonSafe<Record<string, unknown>>(options.request, {})
    const organizationId = ctx.selectedOrganizationId ?? auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, { error: 'organization_scope_required' })
    }
    // Scope tenant/org from auth/session — never trust body organizationId/tenantId
    // (same contract as scan/receive and resolve-location/lot).
    const scopedBody = {
      ...body,
      tenantId: auth.tenantId,
      organizationId,
    }
    const parsed = options.inputSchema.parse(scopedBody)
    const resource = options.describeResource(parsed)
    const guardResult = await runRouteMutationGuards({
      container,
      req: options.request,
      auth: {
        userId: auth.sub,
        tenantId: auth.tenantId,
        organizationId: ctx.selectedOrganizationId,
      },
      input: {
        resourceKind: resource.resourceKind,
        resourceId: resource.resourceId,
        operation: 'custom',
        mutationPayload: parsed as Record<string, unknown>,
      },
    })
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody, { status: guardResult.errorStatus })
    }
    const commandInput = (guardResult.modifiedPayload as TInput | undefined) ?? parsed
    const commandBus = container.resolve('commandBus') as CommandBus
    const execution = await commandBus.execute<TInput, TResult>(options.commandId, {
      input: commandInput,
      ctx,
    })
    await guardResult.runAfterSuccess()
    const responseBody = options.mapSuccess(execution.result)
    const intercepted = await runCustomRouteAfterInterceptors({
      routePath: options.routePath,
      method: 'POST',
      request: {
        method: 'POST',
        url: options.request.url,
        body: commandInput as Record<string, unknown>,
        headers: Object.fromEntries(options.request.headers.entries()),
      },
      response: {
        statusCode: 200,
        body: responseBody,
        headers: {},
      },
      context: {
        em: container.resolve('em'),
        container,
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
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 })
    }
    logger.error('custom route failed', { routePath: options.routePath, commandId: options.commandId, err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
