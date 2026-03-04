import type {
  CancelInput,
  CancelResult,
  CaptureInput,
  CaptureResult,
  CreateSessionInput,
  CreateSessionResult,
  GatewayAdapter,
  GatewayPaymentStatus,
  GetStatusInput,
  RefundInput,
  RefundResult,
  VerifyWebhookInput,
  GatewayWebhookEvent,
} from './adapter'
import { getGatewayAdapter } from './adapter-registry'

function resolveAdapter(providerKey: string, version?: string | null): GatewayAdapter {
  const adapter = getGatewayAdapter(providerKey, version)
  if (!adapter) {
    throw new Error(`Gateway adapter not found for provider '${providerKey}'`)
  }
  return adapter
}

export async function createGatewaySession(
  providerKey: string,
  input: CreateSessionInput,
  version?: string | null,
): Promise<CreateSessionResult> {
  const adapter = resolveAdapter(providerKey, version)
  return adapter.createSession(input)
}

export async function captureGatewayPayment(
  providerKey: string,
  input: CaptureInput,
  version?: string | null,
): Promise<CaptureResult> {
  const adapter = resolveAdapter(providerKey, version)
  return adapter.capture(input)
}

export async function refundGatewayPayment(
  providerKey: string,
  input: RefundInput,
  version?: string | null,
): Promise<RefundResult> {
  const adapter = resolveAdapter(providerKey, version)
  return adapter.refund(input)
}

export async function cancelGatewayPayment(
  providerKey: string,
  input: CancelInput,
  version?: string | null,
): Promise<CancelResult> {
  const adapter = resolveAdapter(providerKey, version)
  return adapter.cancel(input)
}

export async function getGatewayPaymentStatus(
  providerKey: string,
  input: GetStatusInput,
  version?: string | null,
): Promise<GatewayPaymentStatus> {
  const adapter = resolveAdapter(providerKey, version)
  return adapter.getStatus(input)
}

export async function verifyGatewayWebhook(
  providerKey: string,
  input: VerifyWebhookInput,
  version?: string | null,
): Promise<GatewayWebhookEvent> {
  const adapter = resolveAdapter(providerKey, version)
  return adapter.verifyWebhook(input)
}
