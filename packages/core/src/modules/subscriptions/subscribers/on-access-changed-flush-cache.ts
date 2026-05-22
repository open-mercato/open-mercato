type AccessChangedPayload = {
  tenantId: string
  organizationId: string
  subscriptionId: string
  externalAccountId: string
  accessState: 'pending' | 'granted' | 'grace' | 'blocked'
  providerStatus: string
}

type Ctx = {
  resolve?: <T = unknown>(name: string) => T
  container?: { resolve: <T = unknown>(name: string) => T }
}

function getResolver(ctx: Ctx | undefined): (<T>(name: string) => T) | null {
  if (!ctx) return null
  if (typeof ctx.resolve === 'function') return ctx.resolve as <T>(name: string) => T
  if (ctx.container && typeof ctx.container.resolve === 'function') return ctx.container.resolve.bind(ctx.container) as <T>(name: string) => T
  return null
}

export const metadata = {
  event: 'subscriptions.access.changed',
  persistent: false,
  id: 'subscriptions.on-access-changed-flush-cache',
}

export default async function handler(payload: AccessChangedPayload, ctx: Ctx): Promise<void> {
  const resolve = getResolver(ctx)
  if (!resolve) return
  let cache: { invalidateTag?: (tag: string) => Promise<void> } | null = null
  try {
    cache = resolve<{ invalidateTag?: (tag: string) => Promise<void> }>('cache')
  } catch {
    cache = null
  }
  if (!cache?.invalidateTag) return
  const tags = [
    `subscription:${payload.subscriptionId}`,
    `external_account:${payload.externalAccountId}`,
    `subscriptions:account:${payload.tenantId}:${payload.externalAccountId}`,
  ]
  await Promise.all(tags.map((tag) => cache!.invalidateTag!(tag).catch((err) => {
    console.warn('[subscriptions.cache] invalidateTag failed', tag, err)
  })))
}
