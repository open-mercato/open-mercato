import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveBackendChromePayload } from '../../lib/backendChrome'

export const metadata = {
  GET: { requireAuth: true },
}

const sidebarNavItemSchema: z.ZodType<{
  id?: string
  href: string
  title: string
  defaultTitle?: string
  enabled?: boolean
  hidden?: boolean
  pageContext?: 'main' | 'admin' | 'settings' | 'profile'
  iconMarkup?: string
  children?: any[]
}> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    href: z.string(),
    title: z.string(),
    defaultTitle: z.string().optional(),
    enabled: z.boolean().optional(),
    hidden: z.boolean().optional(),
    pageContext: z.enum(['main', 'admin', 'settings', 'profile']).optional(),
    iconMarkup: z.string().optional(),
    children: z.array(sidebarNavItemSchema).optional(),
  }),
)

const sectionItemSchema: z.ZodType<{
  id: string
  label: string
  labelKey?: string
  href: string
  order?: number
  iconMarkup?: string
  children?: any[]
}> = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string(),
    labelKey: z.string().optional(),
    href: z.string(),
    order: z.number().optional(),
    iconMarkup: z.string().optional(),
    children: z.array(sectionItemSchema).optional(),
  }),
)

const sectionGroupSchema = z.object({
  id: z.string(),
  label: z.string(),
  labelKey: z.string().optional(),
  order: z.number().optional(),
  items: z.array(sectionItemSchema),
})

const adminNavResponseSchema = z.object({
  groups: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string(),
      defaultName: z.string().optional(),
      items: z.array(sidebarNavItemSchema),
    }),
  ),
  settingsSections: z.array(sectionGroupSchema),
  settingsPathPrefixes: z.array(z.string()),
  profileSections: z.array(sectionGroupSchema),
  profilePathPrefixes: z.array(z.string()),
  grantedFeatures: z.array(z.string()),
  roles: z.array(z.string()),
})

const adminNavErrorSchema = z.object({
  error: z.string(),
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { translate, locale } = await resolveTranslations()
  const container = await createRequestContainer()
  const cache = container.resolve('cache') as {
    get?: (key: string) => Promise<unknown>
    set?: (key: string, value: unknown, options?: { tags?: string[] }) => Promise<void>
  } | null
  let selectedOrganizationId: string | null | undefined
  let selectedTenantId: string | null | undefined
  try {
    const url = new URL(req.url)
    const orgParam = url.searchParams.get('orgId')
    const tenantParam = url.searchParams.get('tenantId')
    selectedOrganizationId = orgParam === null ? undefined : orgParam || null
    selectedTenantId = tenantParam === null ? undefined : tenantParam || null
  } catch {
    selectedOrganizationId = undefined
    selectedTenantId = undefined
  }

  let cacheScopeTenantId = auth.tenantId ?? null
  let cacheScopeOrganizationId = auth.orgId ?? null
  try {
    const { organizationId, scope } = await resolveFeatureCheckContext({
      container,
      auth,
      selectedId: selectedOrganizationId,
      tenantId: selectedTenantId,
      request: req,
    })
    cacheScopeOrganizationId = organizationId
    cacheScopeTenantId = scope.tenantId ?? auth.tenantId ?? null
  } catch {
    cacheScopeOrganizationId = auth.orgId ?? null
    cacheScopeTenantId = auth.tenantId ?? null
  }

  const cacheKey = `nav:sidebar:${locale}:${auth.sub}:${cacheScopeTenantId || 'null'}:${cacheScopeOrganizationId || 'null'}`
  try {
    if (cache?.get) {
      const cached = await cache.get(cacheKey)
      if (cached) return NextResponse.json(cached)
    }
  } catch {
    // ignore cache read failures
  }

  const payload = await resolveBackendChromePayload({
    auth,
    locale,
    modules: getModules(),
    translate: (key, fallback) => (key ? translate(key, fallback) : fallback),
    request: req,
    selectedOrganizationId,
    selectedTenantId,
  })

  try {
    if (cache?.set) {
      const tags = [
        `rbac:user:${auth.sub}`,
        cacheScopeTenantId ? `rbac:tenant:${cacheScopeTenantId}` : undefined,
        `nav:entities:${cacheScopeTenantId || 'null'}`,
        `nav:locale:${locale}`,
        `nav:sidebar:user:${auth.sub}`,
        `nav:sidebar:scope:${auth.sub}:${cacheScopeTenantId || 'null'}:${cacheScopeOrganizationId || 'null'}:${locale}`,
        ...((Array.isArray(auth.roles) ? auth.roles : []).map((role) => `nav:sidebar:role:${role}`)),
      ].filter(Boolean) as string[]
      await cache.set(cacheKey, payload, { tags })
    }
  } catch {
    // ignore cache write failures
  }

  return NextResponse.json(payload)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'Admin sidebar navigation',
  methods: {
    GET: {
      summary: 'Resolve backend chrome bootstrap payload',
      description:
        'Returns the backend chrome payload available to the authenticated administrator after applying scope, RBAC, role defaults, and personal sidebar preferences.',
      responses: [
        { status: 200, description: 'Backend chrome payload', schema: adminNavResponseSchema },
        { status: 401, description: 'Unauthorized', schema: adminNavErrorSchema },
      ],
    },
  },
}
