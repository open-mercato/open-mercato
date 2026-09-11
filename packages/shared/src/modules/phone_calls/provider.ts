import type {
  FetchPhoneCallsInput,
  NormalizedPhoneCallBatch,
  ProviderValidationResult,
  ValidatePhoneCallProviderInput,
} from './types'

export interface PhoneCallProviderAdapter {
  readonly providerKey: string
  readonly displayName: string

  validateConnection(input: ValidatePhoneCallProviderInput): Promise<ProviderValidationResult>
  fetchCalls(input: FetchPhoneCallsInput): Promise<NormalizedPhoneCallBatch>
}

const PROVIDER_REGISTRY_KEY = '__openMercatoPhoneCallProviders__'

function getRegistry(): Map<string, PhoneCallProviderAdapter> {
  const globalState = globalThis as typeof globalThis & {
    [PROVIDER_REGISTRY_KEY]?: Map<string, PhoneCallProviderAdapter>
  }
  if (!globalState[PROVIDER_REGISTRY_KEY]) {
    globalState[PROVIDER_REGISTRY_KEY] = new Map<string, PhoneCallProviderAdapter>()
  }
  return globalState[PROVIDER_REGISTRY_KEY]
}

export function registerPhoneCallProvider(adapter: PhoneCallProviderAdapter): () => void {
  const registry = getRegistry()
  registry.set(adapter.providerKey, adapter)
  return () => {
    if (registry.get(adapter.providerKey) === adapter) {
      registry.delete(adapter.providerKey)
    }
  }
}

export function getPhoneCallProvider(providerKey: string): PhoneCallProviderAdapter | undefined {
  return getRegistry().get(providerKey)
}

export function listPhoneCallProviders(): PhoneCallProviderAdapter[] {
  return Array.from(getRegistry().values()).sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  )
}

export function clearPhoneCallProviders(): void {
  getRegistry().clear()
}
