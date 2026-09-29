import type { AppContainer } from '@open-mercato/shared/lib/di/container'

type BaseCurrencyResolution =
  | { status: 'resolved'; code: string }
  | { status: 'missing' | 'ambiguous' | 'unavailable' }

type BaseCurrencyResolver = {
  resolveBaseCurrency(scope: {
    tenantId: string
    organizationIds: string[]
  }): Promise<BaseCurrencyResolution>
}

export async function resolveOptionalBaseCurrencyCode(
  container: AppContainer,
  tenantId: string,
  organizationId: string | undefined,
): Promise<string | null> {
  if (!organizationId) return null

  let resolver: BaseCurrencyResolver
  try {
    resolver = container.resolve<BaseCurrencyResolver>('baseCurrencyService')
  } catch {
    return null
  }

  try {
    const result = await resolver.resolveBaseCurrency({ tenantId, organizationIds: [organizationId] })
    return result.status === 'resolved' ? result.code : null
  } catch {
    return null
  }
}
