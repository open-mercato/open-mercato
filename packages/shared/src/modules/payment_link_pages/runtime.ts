const PAY_BY_LINKS_RUNTIME_KEY = '__openMercatoPayByLinksRuntime__'

export type PaymentLinkTemplateData = {
  branding: unknown
  metadata: unknown
  customFields: unknown
  customFieldsetCode: string | null | undefined
  defaultTitle: string | null | undefined
  defaultDescription: string | null | undefined
  customerCapture: unknown
}

export type PaymentLinkTemplateResolver = (
  em: unknown,
  templateId: string,
  organizationId: string,
  tenantId: string,
) => Promise<PaymentLinkTemplateData | null>

type PayByLinksRuntimeState = {
  enabled: boolean
  templateResolver: PaymentLinkTemplateResolver | null
}

function getRuntimeState(): PayByLinksRuntimeState {
  const globalState = globalThis as typeof globalThis & {
    [PAY_BY_LINKS_RUNTIME_KEY]?: PayByLinksRuntimeState
  }

  if (!globalState[PAY_BY_LINKS_RUNTIME_KEY]) {
    globalState[PAY_BY_LINKS_RUNTIME_KEY] = { enabled: false, templateResolver: null }
  }

  return globalState[PAY_BY_LINKS_RUNTIME_KEY]
}

export function registerPayByLinksRuntime(): void {
  getRuntimeState().enabled = true
}

export function registerPayByLinksTemplateResolver(resolver: PaymentLinkTemplateResolver): void {
  getRuntimeState().templateResolver = resolver
}

export function isPayByLinksRuntimeEnabled(): boolean {
  return getRuntimeState().enabled === true
}

export async function resolvePaymentLinkTemplate(
  em: unknown,
  templateId: string,
  organizationId: string,
  tenantId: string,
): Promise<PaymentLinkTemplateData | null> {
  const state = getRuntimeState()
  if (!state.enabled || !state.templateResolver) return null
  return state.templateResolver(em, templateId, organizationId, tenantId)
}
