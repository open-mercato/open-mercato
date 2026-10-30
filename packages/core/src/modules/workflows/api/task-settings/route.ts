/**
 * Tenant task-permission settings (spec §6.4, design §6).
 *
 * - GET  /api/workflows/task-settings — read the opt-out
 * - PUT  /api/workflows/task-settings — write it
 *
 * A new route, which BACKWARD_COMPATIBILITY.md §7 allows freely, and the bridge
 * that discharges the deprecation protocol's "keep the old behaviour alongside
 * the new one for at least one minor version" for the §6.4 visibility change.
 *
 * Shape copied field-for-field from `entities/api/entity-settings.ts` with one
 * deliberate inversion: the read defaults to `true` (the NEW, narrower model)
 * on failure rather than to the permissive value. See
 * `lib/task-permission-settings.ts`.
 *
 * `tenantId` always comes from the authenticated context and never from the
 * request body — a settings write that accepted a tenant id would be a
 * cross-tenant write primitive.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  readTaskPermissionsBusinessContext,
  writeTaskPermissionsBusinessContext,
  type TaskPermissionsConfigService,
} from '../../lib/task-permission-settings'
import { workflowsTag, workflowErrorSchema } from '../openapi'

export const metadata = {
  // Reading the tenant's task-permission posture is administration, not one's
  // own work — the predicate reads the setting server-side for everyone else.
  GET: { requireAuth: true, requireFeatures: ['workflows.tasks.view_all'] },
  // Writing it is an administrative mutation that is not a reassignment.
  PUT: { requireAuth: true, requireFeatures: ['workflows.tasks.manage'] },
}

const settingsResponseSchema = z.object({
  taskPermissionsBusinessContext: z.boolean(),
})

const putBodySchema = z.object({
  taskPermissionsBusinessContext: z.boolean(),
})

const putResponseSchema = settingsResponseSchema.extend({ ok: z.boolean() })

async function resolveModuleConfigService(): Promise<TaskPermissionsConfigService | null> {
  try {
    const { resolve } = await createRequestContainer()
    return resolve('moduleConfigService') as TaskPermissionsConfigService
  } catch {
    // Fails to the default, which is the NEW model — never the permissive one.
    return null
  }
}

export async function GET(request: Request) {
  const auth = await getAuthFromRequest(request)
  if (!auth || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const moduleConfigService = await resolveModuleConfigService()
  const taskPermissionsBusinessContext = await readTaskPermissionsBusinessContext(
    moduleConfigService,
    auth.tenantId,
  )
  return NextResponse.json({ taskPermissionsBusinessContext })
}

export async function PUT(request: Request) {
  const auth = await getAuthFromRequest(request)
  if (!auth || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = putBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const moduleConfigService = await resolveModuleConfigService()
  if (!moduleConfigService) {
    return NextResponse.json({ error: 'Settings storage unavailable' }, { status: 503 })
  }

  await writeTaskPermissionsBusinessContext(
    moduleConfigService,
    auth.tenantId,
    parsed.data.taskPermissionsBusinessContext,
  )

  return NextResponse.json({
    ok: true,
    taskPermissionsBusinessContext: parsed.data.taskPermissionsBusinessContext,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Tenant task-permission settings',
  methods: {
    GET: {
      summary: 'Get tenant task-permission settings',
      description:
        'Returns whether the business-context task-permission model (spec §6.4) is enabled for the tenant. Defaults to true.',
      responses: [
        { status: 200, description: 'Current settings', schema: settingsResponseSchema },
        { status: 401, description: 'Missing authentication', schema: workflowErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update tenant task-permission settings',
      description:
        'Sets the tenant-scoped opt-out. Setting it to false restores the pre-6.4 READ filter on the task list, task detail and work inbox; it never affects claiming, completing, tenant/organization scoping or the portal task routes.',
      requestBody: { schema: putBodySchema },
      responses: [
        { status: 200, description: 'Updated settings', schema: putResponseSchema },
        { status: 400, description: 'Invalid payload', schema: workflowErrorSchema },
        { status: 401, description: 'Missing authentication', schema: workflowErrorSchema },
        { status: 503, description: 'Settings storage unavailable', schema: workflowErrorSchema },
      ],
    },
  },
}
