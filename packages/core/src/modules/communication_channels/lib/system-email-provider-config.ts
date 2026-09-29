import { normalizeEnvString } from '@open-mercato/shared/lib/email/config'

type SystemEmailProviderConfigContext = {
  fromAddress: string
}

export const DEFAULT_SYSTEM_EMAIL_PROVIDER = 'resend'

/**
 * The provider key `sendSystemEmail` resolves channels and credentials against.
 *
 * Lives here rather than in `system-email.ts` so a provider package's `setup.ts` can read it without
 * importing the send path — that module pulls the ORM and the React renderer in behind it, and a
 * preset that runs at tenant seeding has no business loading either.
 */
export function resolveSystemEmailProvider(): string {
  return normalizeEnvString(process.env.SYSTEM_EMAIL_PROVIDER) ?? DEFAULT_SYSTEM_EMAIL_PROVIDER
}

/**
 * Whether a provider package's env preset should seed anything for this instance.
 *
 * Only the selected provider seeds. Without this gate a preset fires off whatever env variables
 * happen to be present, and `AWS_REGION` in particular is a general-purpose variable this repo
 * already ships uncommented for vector search — so an instance sending through Resend would get an
 * `isEnabled: true` SES integration and a `status: 'connected'` SES channel it never configured.
 */
export function isSelectedSystemEmailProvider(providerKey: string): boolean {
  return resolveSystemEmailProvider() === providerKey
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
