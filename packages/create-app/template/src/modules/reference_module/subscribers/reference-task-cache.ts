import { invalidateReferenceTaskCache } from '../lib/task-cache'

export const metadata = {
  event: 'reference_module.*',
  persistent: false,
  id: 'reference_module:reference-task-cache',
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
  eventName?: string
  tenantId?: string | null
  organizationId?: string | null
}

export default async function handle(_payload: unknown, ctx: SubscriberContext): Promise<void> {
  if (!ctx.eventName?.startsWith('reference_module.')) return
  if (!ctx.tenantId || !ctx.organizationId) return
  await invalidateReferenceTaskCache(
    { resolve: ctx.resolve.bind(ctx) } as Parameters<typeof invalidateReferenceTaskCache>[0],
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )
}
