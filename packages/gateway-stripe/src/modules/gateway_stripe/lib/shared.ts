export function toCents(amount: number): number {
  return Math.round(amount * 100)
}

export function fromCents(cents: number): number {
  return cents / 100
}

export function buildStripeMetadata(input: {
  paymentId: string
  tenantId: string
  organizationId: string
  orderId?: string
}): Record<string, string> {
  const meta: Record<string, string> = {
    paymentId: input.paymentId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  }
  if (input.orderId) {
    meta.orderId = input.orderId
  }
  return meta
}
