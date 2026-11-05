import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getBackendRouteManifests } from '@open-mercato/shared/modules/registry'
import { getModuleSurfaceFingerprint } from '@open-mercato/shared/lib/modules/surfaceFingerprint'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { groupBackendRoutesByModule, resolveBackendChromePayload } from '../../lib/backendChrome'

export const metadata = {
  GET: { requireAuth: true },
}

// The fingerprint covers the module set, each module's declared features and
// the serializable route manifest, so the TTL only has to bound what it cannot
// see — chiefly a route `icon` swap, which serializes identically. Rebuilding
// this payload is expensive (a `renderToStaticMarkup` per nav icon plus several
// scoped queries), so the bound is generous rather than aggressive.
const NAV_CACHE_TTL_MS = 30 * 60 * 1000

const sidebarNavItemSchema: z.ZodType<{
  id?: string
  href: string
  title: string
  defaultTitle?: string
  enabled?: boolean
  hidden?: boolean
  pageContext?: 'main' | 'admin' | 'settings' | 'profile'
  iconName?: string
  iconMarkup?: string
  order?: number
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
    iconName: z.string().optional(),
    iconMarkup: z.string().optional(),
    order: z.number().optional(),
    children: z.array(sidebarNavItemSchema).optional(),
  }),
)

const sectionItemSchema: z.ZodType<{
  id: string
  label: string
  labelKey?: string
  href: string
  order?: number
  iconName?: string
  iconMarkup?: string
  children?: any[]
}> = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string(),
    labelKey: z.string().optional(),
    href: z.string(),
    order: z.number().optional(),
    iconName: z.string().optional(),
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
  brand: z.object({
    name: z.string().optional(),
    logo: z.object({
      src: z.string(),
      alt: z.string().optional(),
    }).nullable().optional(),
  }).nullable().optional(),
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
  // Present when a single organization is in scope; `null` under an all-organizations selection or
  // when the lookup fails. Declared optional so the response contract stays additive for clients
  // generated against an older schema.
  currentOrganization: z.object({
    id: z.string(),
    name: z.string(),
  }).nullable().optional(),
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
    set?: (key: string, value: unknown, options?: { tags?: string[]; ttl?: number }) => Promise<void>
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
  let cacheScopeSelectedOrganizationId = auth.orgId ?? null
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
    cacheScopeSelectedOrganizationId = scope.selectedId ?? null
  } catch {
    cacheScopeOrganizationId = auth.orgId ?? null
    cacheScopeTenantId = auth.tenantId ?? null
    cacheScopeSelectedOrganizationId = auth.orgId ?? null
    selectedOrganizationId = auth.orgId ?? null
    selectedTenantId = auth.tenantId ?? null
  }

  // v6: the payload gained `currentOrganization`, and the payload also embeds the enabled-module set,
  // its declared features, and the backend route manifest. The selection is part of the key because
  // the resolved organization cannot distinguish "all organizations" from "my own organization";
  // use the resolved selection so cookie-driven requests without an `orgId` query remain distinct.
  // The fingerprint invalidates module-surface changes; the TTL bounds anything it cannot observe.
  const cacheVersion = `v7:${getModuleSurfaceFingerprint()}`
  const cacheSelection = cacheScopeSelectedOrganizationId ?? '__all__'
  const cacheKey = `nav:sidebar:${cacheVersion}:${locale}:${auth.sub}:${cacheScopeTenantId || 'null'}:${cacheScopeOrganizationId || 'null'}:${cacheSelection}`
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
    modules: groupBackendRoutesByModule(getBackendRouteManifests()),
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
        cacheScopeTenantId ? `nav:sidebar:tenant:${cacheScopeTenantId}` : undefined,
        cacheScopeOrganizationId ? `nav:sidebar:organization:${cacheScopeOrganizationId}` : undefined,
        `nav:sidebar:scope:${auth.sub}:${cacheScopeTenantId || 'null'}:${cacheScopeOrganizationId || 'null'}:${locale}`,
        ...((Array.isArray(auth.roles) ? auth.roles : []).map((role) => `nav:sidebar:role:${role}`)),
      ].filter(Boolean) as string[]
      await cache.set(cacheKey, payload, { tags, ttl: NAV_CACHE_TTL_MS })
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
