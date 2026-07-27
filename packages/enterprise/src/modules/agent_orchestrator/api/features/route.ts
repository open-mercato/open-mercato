import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { getModules } from '@open-mercato/shared/lib/i18n/server'

/**
 * Read-only feature catalog for the task-definition permissions picker.
 * Mirrors `packages/core/src/modules/auth/api/features.ts` over the same
 * `getModules()` source but is gated `tasks.manage` instead of
 * `auth.acl.manage` — task admins are generally not ACL admins, yet they need
 * the id vocabulary to grant least-privilege features to a task's execution
 * principal. Ids + titles only; no role or grant data leaks through here.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.tasks.manage'] },
}

type FeatureItem = { id: string; title: string; module: string }

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const modules = getModules()
  const byId = new Map<string, FeatureItem>()
  for (const mod of modules || []) {
    const features = (mod as { features?: Array<Record<string, unknown>> }).features || []
    for (const feature of features) {
      const id = typeof feature.id === 'string' ? feature.id : String(feature.id ?? '')
      if (!id || byId.has(id)) continue
      byId.set(id, {
        id,
        title: typeof feature.title === 'string' && feature.title ? feature.title : id,
        module: typeof feature.module === 'string' && feature.module ? feature.module : String(mod.id ?? ''),
      })
    }
  }
  const items = Array.from(byId.values()).sort(
    (a, b) => a.module.localeCompare(b.module) || a.id.localeCompare(b.id),
  )
  return NextResponse.json({ items })
}

const featureItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  module: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'List declared ACL features for the task permissions picker',
  methods: {
    GET: {
      summary: 'List declared ACL feature ids and titles',
      description:
        'Flattens the enabled modules’ static feature declarations to id/title/module triples for the agentic-task grantedFeatures picker. Gated by agent_orchestrator.tasks.manage.',
      responses: [
        {
          status: 200,
          description: 'Declared feature catalog',
          schema: z.object({ items: z.array(featureItemSchema) }),
        },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Missing agent_orchestrator.tasks.manage', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
