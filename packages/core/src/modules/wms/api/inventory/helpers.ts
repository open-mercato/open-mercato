import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { runCustomRouteAfterInterceptors } from '@open-mercato/shared/lib/crud/custom-route-interceptor'

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
    const parsed = options.inputSchema.parse(body)
    const resource = options.describeResource(parsed)
    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId,
      organizationId: ctx.selectedOrganizationId,
      userId: auth.sub,
      resourceKind: resource.resourceKind,
      resourceId: resource.resourceId,
      operation: 'custom',
      requestMethod: options.request.method,
      requestHeaders: options.request.headers,
      mutationPayload: parsed as Record<string, unknown>,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }
    const commandBus = container.resolve('commandBus') as CommandBus
    const execution = await commandBus.execute<TInput, TResult>(options.commandId, {
      input: parsed,
      ctx,
    })
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId: ctx.selectedOrganizationId,
        userId: auth.sub,
        resourceKind: resource.resourceKind,
        resourceId: resource.resourceId,
        operation: 'custom',
        requestMethod: options.request.method,
        requestHeaders: options.request.headers,
        metadata: guardResult.metadata ?? null,
      })
    }
    const responseBody = options.mapSuccess(execution.result)
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
    console.error('[wms.inventory] custom route failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
