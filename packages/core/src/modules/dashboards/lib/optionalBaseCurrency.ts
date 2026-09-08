import type { AppContainer } from '@open-mercato/shared/lib/di/container'

export type BaseCurrencyResolution =
  | { status: 'resolved'; code: string }
  | { status: 'missing' | 'ambiguous' | 'unavailable' }

export type BaseCurrencyResolver = {
  resolveBaseCurrency(scope: {
    tenantId: string
    organizationIds: string[]
  }): Promise<BaseCurrencyResolution>
}

export function resolveOptionalBaseCurrencyResolver(
  container: AppContainer,
): BaseCurrencyResolver | undefined {
  try {
    return container.resolve<BaseCurrencyResolver>('baseCurrencyService')
  } catch {
    return undefined
  }
}
