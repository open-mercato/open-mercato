import type { ComponentType } from 'react'
import type { EmbeddedPaymentGatewayClientSession } from './types'

export type EmbeddedPaymentGatewayRendererProps = {
  providerKey: string
  transactionId: string
  gatewayTransactionId?: string | null
  session: EmbeddedPaymentGatewayClientSession
  disabled?: boolean
  onComplete: () => void
  onError: (message: string) => void
}

export type EmbeddedPaymentGatewayRendererRegistration = {
  providerKey: string
  rendererKey: string
  Component: ComponentType<EmbeddedPaymentGatewayRendererProps>
}

const EMBEDDED_RENDERER_REGISTRY_KEY = '__openMercatoEmbeddedPaymentGatewayRenderers__'

function getRegistry(): Map<string, ComponentType<EmbeddedPaymentGatewayRendererProps>> {
  const globalState = globalThis as typeof globalThis & {
    [EMBEDDED_RENDERER_REGISTRY_KEY]?: Map<string, ComponentType<EmbeddedPaymentGatewayRendererProps>>
  }
  if (!globalState[EMBEDDED_RENDERER_REGISTRY_KEY]) {
    globalState[EMBEDDED_RENDERER_REGISTRY_KEY] = new Map<string, ComponentType<EmbeddedPaymentGatewayRendererProps>>()
  }
  return globalState[EMBEDDED_RENDERER_REGISTRY_KEY]
}

function toRegistryKey(providerKey: string, rendererKey: string): string {
  return `${providerKey}:${rendererKey}`
}

export function registerEmbeddedPaymentGatewayRenderer(
  registration: EmbeddedPaymentGatewayRendererRegistration,
): () => void {
  const registry = getRegistry()
  const key = toRegistryKey(registration.providerKey, registration.rendererKey)
  registry.set(key, registration.Component)
  return () => {
    registry.delete(key)
  }
}

export function getEmbeddedPaymentGatewayRenderer(
  providerKey: string,
  rendererKey: string,
): ComponentType<EmbeddedPaymentGatewayRendererProps> | undefined {
  return getRegistry().get(toRegistryKey(providerKey, rendererKey))
}

export function clearEmbeddedPaymentGatewayRenderers(): void {
  getRegistry().clear()
}
