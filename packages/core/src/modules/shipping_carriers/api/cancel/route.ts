import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { ShippingCarrierService } from '../../lib/shipping-service'
import { isShipmentCancelNotAllowedError } from '../../lib/status-sync'
import { shippingCarrierUpstreamErrorResponse } from '../../lib/upstream-error-response'
import { cancelShipmentSchema } from '../../data/validators'
import { shippingCarriersTag } from '../openapi'

function resolveGuardUserId(auth: {
  sub?: string | null
  userId?: string | null
  keyId?: string | null
}): string {
  if (typeof auth.sub === 'string' && auth.sub.trim().length > 0) return auth.sub
  if (typeof auth.userId === 'string' && auth.userId.trim().length > 0) return auth.userId
  if (typeof auth.keyId === 'string' && auth.keyId.trim().length > 0) return auth.keyId
  return 'system'
}

export const metadata = {
  path: '/shipping-carriers/cancel',
  POST: { requireAuth: true, requireFeatures: ['shipping_carriers.manage'] },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const payload = await readJsonSafe<unknown>(req)
  const parsed = cancelShipmentSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }
  const container = await createRequestContainer()
  const guardUserId = resolveGuardUserId(auth)
  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    userId: guardUserId,
    resourceKind: 'shipping_carriers.shipment',
    resourceId: parsed.data.shipmentId,
    operation: 'custom',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: parsed.data as Record<string, unknown>,
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  const service = container.resolve('shippingCarrierService') as ShippingCarrierService
  try {
    const result = await service.cancelShipment({
      ...parsed.data,
      organizationId: auth.orgId as string,
      tenantId: auth.tenantId,
    })

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId: auth.orgId,
        userId: guardUserId,
        resourceKind: 'shipping_carriers.shipment',
        resourceId: parsed.data.shipmentId,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json(result)
  } catch (error: unknown) {
    if (isShipmentCancelNotAllowedError(error)) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    return shippingCarrierUpstreamErrorResponse('cancel.post', error)
  }
}

export const openApi = {
  tags: [shippingCarriersTag],
  summary: 'Cancel shipment',
  methods: {
    POST: {
      summary: 'Cancel shipment',
      tags: [shippingCarriersTag],
      responses: [
        { status: 200, description: 'Shipment cancelled' },
        { status: 422, description: 'Validation failed or shipment cannot be cancelled in its current status' },
        { status: 502, description: 'Provider upstream error' },
      ],
    },
  },
}
