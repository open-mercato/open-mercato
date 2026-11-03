import type { ResolvedEmailPayload } from './send'

export type EmailTransport = {
  id: string
  send: (payload: ResolvedEmailPayload) => Promise<void>
  isConfigured?: () => boolean
}

const EMAIL_TRANSPORT_REGISTRY = Symbol.for('open-mercato.email.transport')

type EmailTransportRegistryGlobal = typeof globalThis & {
  [EMAIL_TRANSPORT_REGISTRY]?: EmailTransport | null
}

function emailTransportRoot(): EmailTransportRegistryGlobal {
  return globalThis as EmailTransportRegistryGlobal
}

export function registerEmailTransport(transport: EmailTransport): void {
  emailTransportRoot()[EMAIL_TRANSPORT_REGISTRY] = transport
}

export function getRegisteredEmailTransport(): EmailTransport | null {
  return emailTransportRoot()[EMAIL_TRANSPORT_REGISTRY] ?? null
}

export function clearRegisteredEmailTransportForTests(): void {
  emailTransportRoot()[EMAIL_TRANSPORT_REGISTRY] = null
}
