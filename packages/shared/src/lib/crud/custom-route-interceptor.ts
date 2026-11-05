import type { InterceptorContext, InterceptorRequest, InterceptorResponse, ApiInterceptorMethod } from './api-interceptor'
import { runApiInterceptorsAfter, type RunInterceptorsAfterResult } from './interceptor-runner'

export type CustomRouteAfterInterceptorContext = {
  em: InterceptorContext['em']
  container: InterceptorContext['container']
  userId?: string | null
  organizationId?: string | null
  tenantId?: string | null
  userFeatures?: string[]
  extensionHeaders?: InterceptorContext['extensionHeaders']
}

type RunCustomRouteAfterInterceptorsArgs = {
  routePath: string
  method: ApiInterceptorMethod
  request: InterceptorRequest
  response: InterceptorResponse
  context: CustomRouteAfterInterceptorContext
  metadataByInterceptor?: Record<string, Record<string, unknown> | undefined>
}

function normalizeIdentity(value: string | null | undefined): string {
  if (!value) return ''
  return value
}

export async function runCustomRouteAfterInterceptors(
  args: RunCustomRouteAfterInterceptorsArgs,
): Promise<RunInterceptorsAfterResult> {
  return runApiInterceptorsAfter({
    routePath: args.routePath,
    method: args.method,
    request: args.request,
    response: args.response,
    context: {
      em: args.context.em,
      container: args.context.container,
      userId: normalizeIdentity(args.context.userId),
      organizationId: normalizeIdentity(args.context.organizationId),
      tenantId: normalizeIdentity(args.context.tenantId),
      userFeatures: args.context.userFeatures ?? [],
      extensionHeaders: args.context.extensionHeaders,
    },
    metadataByInterceptor: args.metadataByInterceptor,
  })
}
