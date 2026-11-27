import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveDecisionState } from '../../lib/runtime'
import { computeRetryAfterSeconds } from '../../lib/transitions'

export const metadata = {
  GET: {
    requireAuth: false,
    rateLimit: { points: 120, duration: 60, keyPrefix: 'maintenance_status' },
  },
}

const maintenanceStatusSchema = z.object({
  active: z.boolean(),
  until: z.string().nullable(),
  retryAfter: z.number().int().nullable(),
  message: z.string().nullable(),
})

export type MaintenanceStatusResponse = z.infer<typeof maintenanceStatusSchema>

export async function GET() {
  const decision = await resolveDecisionState()
  const state = decision?.state
  const active = state?.active === true
  const body: MaintenanceStatusResponse = {
    active,
    until: active ? state!.until : null,
    retryAfter: active ? computeRetryAfterSeconds(state!, new Date()) : null,
    message: active ? state!.page.message ?? null : null,
  }
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Maintenance',
  summary: 'Maintenance mode status',
  methods: {
    GET: {
      summary: 'Get the public maintenance mode status',
      description: 'Public, read-only. Stays available during a maintenance window. Exposes no window id, reason, holds or process data.',
      responses: [
        { status: 200, description: 'Current maintenance status', schema: maintenanceStatusSchema },
      ],
    },
  },
}
