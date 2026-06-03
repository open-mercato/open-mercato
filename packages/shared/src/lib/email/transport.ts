import type { ResolvedEmailPayload } from './send'

export type EmailTransport = {
  id: string
  send: (payload: ResolvedEmailPayload) => Promise<void>
  isConfigured?: () => boolean
}

let registeredTransport: EmailTransport | null = null

export function registerEmailTransport(transport: EmailTransport): void {
  registeredTransport = transport
}

export function getRegisteredEmailTransport(): EmailTransport | null {
  return registeredTransport
}

export function clearRegisteredEmailTransportForTests(): void {
  registeredTransport = null
}
