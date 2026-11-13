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
  organizationIdOrIds: string | readonly string[] | undefined,
): Promise<string | null> {
  const organizationIds = [...new Set(
    (Array.isArray(organizationIdOrIds) ? organizationIdOrIds : [organizationIdOrIds])
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  )]
  if (organizationIds.length === 0) return null

  let resolver: BaseCurrencyResolver
  try {
    resolver = container.resolve<BaseCurrencyResolver>('baseCurrencyService')
  } catch {
    return null
  }

  try {
    const result = await resolver.resolveBaseCurrency({ tenantId, organizationIds })
    return result.status === 'resolved' ? result.code : null
  } catch {
    return null
  }
}
