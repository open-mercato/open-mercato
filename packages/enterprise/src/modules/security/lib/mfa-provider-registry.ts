import type { MfaProviderSetup } from './mfa-provider-interface'

export class MfaProviderRegistry {
  private readonly providers = new Map<string, MfaProviderSetup>()

  register(provider: MfaProviderSetup): void {
    if (this.providers.has(provider.type)) {
      throw new Error(`MFA provider '${provider.type}' is already registered`)
    }
    this.providers.set(provider.type, provider)
  }

  get(type: string): MfaProviderSetup | undefined {
    return this.providers.get(type)
  }

  listAll(): MfaProviderSetup[] {
    return Array.from(this.providers.values())
  }

  listAvailable(allowedMethods?: string[] | null): MfaProviderSetup[] {
    if (!allowedMethods?.length) return this.listAll()
    return this.listAll().filter((provider) => allowedMethods.includes(provider.type))
  }
}
