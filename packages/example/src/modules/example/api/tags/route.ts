import { getAuthFromCookies } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { CustomFieldDef, CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  exampleErrorSchema,
  exampleTag,
  optionsResponseSchema,
} from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['example.todos.view'] },
}

export async function GET(request: Request) {
  try {
    const auth = await getAuthFromCookies()
    if (!auth?.orgId) {
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    const rows = await em.find(CustomFieldValue, {
      entityId: 'example:todo',
      fieldKey: 'labels',
      $or: [ { organizationId: auth.orgId as any }, { organizationId: null } ],
    })
    const set = new Set<string>()
    for (const r of rows) {
      const raw = (r as any).valueText || (r as any).valueMultiline || ''
      const s = String(raw || '').trim()
      if (!s) continue
      set.add(s)
    }
    // Also include static options from the field definition if provided
    const def = await em.findOne(CustomFieldDef, {
      entityId: 'example:todo',
      key: 'labels',
      $and: [
        { $or: [ { organizationId: auth.orgId as any }, { organizationId: null } ] },
        { $or: [ { tenantId: auth.tenantId as any }, { tenantId: null } ] },
      ],
    })
    const opts = Array.isArray(def?.configJson?.options) ? def!.configJson!.options as string[] : []
    for (const o of opts) {
      const s = String(o || '').trim()
      if (s) set.add(s)
    }
    const items = Array.from(set).map((t) => ({ value: t, label: t }))
    return new Response(JSON.stringify({ items }), { headers: { 'content-type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

const tagsGetDoc: OpenApiMethodDoc = {
  summary: 'List example tags',
  description: 'Returns tag options collected from custom field values and dictionary configuration.',
  tags: [exampleTag],
  responses: [
    { status: 200, description: 'Available tag options.', schema: optionsResponseSchema },
  ],
  errors: [
    { status: 500, description: 'Failed to resolve tags', schema: exampleErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: exampleTag,
  summary: 'Example tag suggestions',
  methods: {
    GET: tagsGetDoc,
  },
}
