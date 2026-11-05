export const PORTAL_BRIDGE_STATUS_DOM_NAME = 'om:portal-bridge:status'

export type PortalBridgeStatusDetail = {
  healthy: boolean
}

type PortalBridgeWindow = Window & {
  __portalBridgeHealthy?: boolean
}

export function readPortalBridgeHealth(): boolean | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as PortalBridgeWindow).__portalBridgeHealthy
}

export function publishPortalBridgeHealth(healthy: boolean): void {
  if (typeof window === 'undefined') return
  ;(window as PortalBridgeWindow).__portalBridgeHealthy = healthy
  window.dispatchEvent(
    new CustomEvent<PortalBridgeStatusDetail>(PORTAL_BRIDGE_STATUS_DOM_NAME, {
      detail: { healthy },
    }),
  )
}

export function clearPortalBridgeHealth(): void {
  if (typeof window === 'undefined') return
  delete (window as PortalBridgeWindow).__portalBridgeHealthy
}
