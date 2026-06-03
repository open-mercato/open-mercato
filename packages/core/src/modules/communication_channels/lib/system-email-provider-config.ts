type SystemEmailProviderConfigContext = {
  fromAddress: string
}

export type SystemEmailProviderConfigResolver = {
  providerKey: string
  isConfigured: () => boolean
  resolveCredentials: (ctx: SystemEmailProviderConfigContext) => Record<string, unknown>
}

const SYSTEM_EMAIL_PROVIDER_CONFIG_REGISTRY = Symbol.for(
  'open-mercato.communication-channels.system-email-provider-config',
)

type RegistryGlobal = typeof globalThis & {
  [SYSTEM_EMAIL_PROVIDER_CONFIG_REGISTRY]?: Map<string, SystemEmailProviderConfigResolver>
}

function getRegistry(): Map<string, SystemEmailProviderConfigResolver> {
  const root = globalThis as RegistryGlobal
  if (!root[SYSTEM_EMAIL_PROVIDER_CONFIG_REGISTRY]) {
    root[SYSTEM_EMAIL_PROVIDER_CONFIG_REGISTRY] = new Map()
  }
  return root[SYSTEM_EMAIL_PROVIDER_CONFIG_REGISTRY]
}

export function registerSystemEmailProviderConfigResolver(resolver: SystemEmailProviderConfigResolver): void {
  getRegistry().set(resolver.providerKey, resolver)
}

export function getSystemEmailProviderConfigResolver(
  providerKey: string,
): SystemEmailProviderConfigResolver | undefined {
  return getRegistry().get(providerKey)
}
