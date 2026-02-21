import type { StoreContext } from './storeContext'

export const STOREFRONT_NOT_READY_ERROR = 'Storefront sales channel is not configured'

export function isStorefrontReady(storeCtx: StoreContext): boolean {
  return Boolean(storeCtx.channelBinding?.salesChannelId)
}

