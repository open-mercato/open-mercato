/**
 * Reads back what the probe connector captured when it started a run.
 *
 * Two things the integration suite cannot otherwise observe: the per-run callback
 * URL (minted inside the runner, handed only to the "provider", and stored only as
 * a SHA-256 digest — so a test can reach the token route no other way), and
 * WHETHER `start()` ran at all, which is how a refusal is proven to have happened
 * before anything dialled rather than after.
 *
 * Authenticated even though the module is test-only: the capture holds live
 * callback bearers, and a test already has a token.
 */

import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readProbeStarts } from '../../lib/probeConnector'

export const metadata = {
  GET: { requireAuth: true },
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const externalRunId = url.searchParams.get('externalRunId')
  const starts = readProbeStarts()
  const entries = externalRunId ? starts.filter((entry) => entry.externalRunId === externalRunId) : starts
  return Response.json({ count: entries.length, entries })
}

const startSchema = z.object({
  externalRunId: z.string(),
  callbackUrl: z.string(),
  agentId: z.string(),
  tenantId: z.string(),
  organizationId: z.string(),
  createdAt: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'AgentProbe',
  methods: {
    GET: {
      summary: 'Test-only: external runs the probe connector started, with their per-run callback URLs',
      tags: ['AgentProbe'],
      responses: [
        {
          status: 200,
          description: 'Captured starts, oldest first',
          schema: z.object({ count: z.number(), entries: z.array(startSchema) }),
        },
      ],
    },
  },
}
