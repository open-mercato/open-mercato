import type { InterceptorContext } from '@open-mercato/shared/lib/crud/api-interceptor'
import { runApiInterceptorsBefore } from '@open-mercato/shared/lib/crud/interceptor-runner'
import { widgetDataRequestSchema } from '../api/widgets/data/schema'
import type { WidgetDataRequest } from '../services/widgetDataService'

export async function runWidgetDataBeforeInterceptors(
  req: Request,
  body: WidgetDataRequest,
  context: Omit<InterceptorContext, 'metadata'>,
) {
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    headers[key] = value
  })
  const url = new URL(req.url)
  if (url.pathname.endsWith('/batch')) url.pathname = url.pathname.slice(0, -'/batch'.length)
  const result = await runApiInterceptorsBefore({
    routePath: 'dashboards/widgets/data',
    method: 'POST',
    request: { method: 'POST', url: url.href, headers, body: { ...body } },
    context,
  })
  if (!result.ok) return result

  const parsed = widgetDataRequestSchema.safeParse(result.request.body ?? body)
  if (!parsed.success || parsed.data.entityType !== body.entityType) {
    return { ok: false as const, statusCode: 400, body: { error: 'Invalid widget data request' } }
  }
  return { ok: true as const, request: parsed.data }
}
