import type { ComponentType } from 'react'
import type { EmbeddedPaymentGatewayClientSession } from './types'

export type PaymentGatewayRendererProps = {
  providerKey: string
  transactionId: string
  gatewayTransactionId?: string | null
  session: EmbeddedPaymentGatewayClientSession
  disabled?: boolean
  onComplete: () => void
  onError: (message: string) => void
}

export type PaymentGatewayRendererRegistration = {
  providerKey: string
  rendererKey: string
  Component: ComponentType<PaymentGatewayRendererProps>
}

const EMBEDDED_RENDERER_REGISTRY_KEY = '__openMercatoEmbeddedPaymentGatewayRenderers__'

function getRegistry(): Map<string, ComponentType<PaymentGatewayRendererProps>> {
  const globalState = globalThis as typeof globalThis & {
    [EMBEDDED_RENDERER_REGISTRY_KEY]?: Map<string, ComponentType<PaymentGatewayRendererProps>>
  }
  if (!globalState[EMBEDDED_RENDERER_REGISTRY_KEY]) {
    globalState[EMBEDDED_RENDERER_REGISTRY_KEY] = new Map<string, ComponentType<PaymentGatewayRendererProps>>()
  }
  return globalState[EMBEDDED_RENDERER_REGISTRY_KEY]
}

function toRegistryKey(providerKey: string, rendererKey: string): string {
  return `${providerKey}:${rendererKey}`
}

export function registerPaymentGatewayRenderer(
  registration: PaymentGatewayRendererRegistration,
): () => void {
  const registry = getRegistry()
  const key = toRegistryKey(registration.providerKey, registration.rendererKey)
  registry.set(key, registration.Component)
  return () => {
    registry.delete(key)
  }
}

export function getPaymentGatewayRenderer(
  providerKey: string,
  rendererKey: string,
): ComponentType<PaymentGatewayRendererProps> | undefined {
  return getRegistry().get(toRegistryKey(providerKey, rendererKey))
}

export function clearPaymentGatewayRenderers(): void {
  getRegistry().clear()
}

export type EmbeddedPaymentGatewayRendererProps = PaymentGatewayRendererProps
export type EmbeddedPaymentGatewayRendererRegistration = PaymentGatewayRendererRegistration
export const registerEmbeddedPaymentGatewayRenderer = registerPaymentGatewayRenderer
export const getEmbeddedPaymentGatewayRenderer = getPaymentGatewayRenderer
export const clearEmbeddedPaymentGatewayRenderers = clearPaymentGatewayRenderers
