import type { MfaProviderInterface } from './mfa-provider-interface'

export class MfaProviderRegistry {
  private readonly providers = new Map<string, MfaProviderInterface>()

  register(provider: MfaProviderInterface): void {
    if (this.providers.has(provider.type)) {
      throw new Error(`MFA provider '${provider.type}' is already registered`)
    }
    this.providers.set(provider.type, provider)
  }

  get(type: string): MfaProviderInterface | undefined {
    return this.providers.get(type)
  }

  listAll(): MfaProviderInterface[] {
    return Array.from(this.providers.values())
  }

  listAvailable(allowedMethods?: string[] | null): MfaProviderInterface[] {
    if (!allowedMethods?.length) return this.listAll()
    return this.listAll().filter((provider) => allowedMethods.includes(provider.type))
  }
}
