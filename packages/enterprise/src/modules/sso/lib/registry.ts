import type { SsoProtocolProvider } from './types'

export class SsoProviderRegistry {
  private providers = new Map<string, SsoProtocolProvider>()

  register(provider: SsoProtocolProvider): void {
    this.providers.set(provider.protocol, provider)
  }

  resolve(protocol: string): SsoProtocolProvider | undefined {
    return this.providers.get(protocol)
  }
}
