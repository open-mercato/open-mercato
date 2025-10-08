import { NextResponse, type NextRequest } from 'next/server'
import { findApi } from '@open-mercato/shared/modules/registry'
import { modules } from '@/generated/modules.generated'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveOrganizationScope, getSelectedOrganizationFromRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

async function checkAuthorization(
  methodMetadata: any,
  auth: any,
  req: NextRequest
): Promise<NextResponse | null> {
  if (methodMetadata?.requireAuth && !auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if ((methodMetadata?.requireRoles && methodMetadata.requireRoles.length) && 
      (!auth || !auth.roles || !methodMetadata.requireRoles.some((r: string) => auth.roles!.includes(r)))) {
    return NextResponse.json({ error: 'Forbidden', requiredRoles: methodMetadata.requireRoles }, { status: 403 })
  }

  if (methodMetadata?.requireFeatures && methodMetadata.requireFeatures.length) {
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const container = await createRequestContainer()
    const rbac = container.resolve<RbacService>('rbacService')
    const em = container.resolve('em') as any
    let organizationScopeId = auth.orgId ?? null
    if (auth.tenantId) {
      const scope = await resolveOrganizationScope({ em, rbac, auth, selectedId: getSelectedOrganizationFromRequest(req) })
      organizationScopeId = scope.selectedId ?? auth.orgId ?? null
    }
    const ok = await rbac.userHasAllFeatures(
      auth.sub,
      methodMetadata.requireFeatures,
      { tenantId: auth.tenantId, organizationId: organizationScopeId }
    )
    if (!ok) {
      return NextResponse.json({ error: 'Forbidden', requiredFeatures: methodMetadata.requireFeatures }, { status: 403 })
    }
  }

  return null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const p = await params
  const pathname = '/' + (p.slug?.join('/') ?? '')
  const api = findApi(modules, 'GET', pathname)
  if (!api) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  const auth = getAuthFromRequest(req as any as Request)
  
  const authError = await checkAuthorization(api.metadata?.GET, auth, req)
  if (authError) return authError
  
  return (api.handler as any)(req, { params: api.params, auth })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const p = await params
  const pathname = '/' + (p.slug?.join('/') ?? '')
  const api = findApi(modules, 'POST', pathname)
  if (!api) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  const auth = getAuthFromRequest(req as any as Request)
  
  const authError = await checkAuthorization(api.metadata?.POST, auth, req)
  if (authError) return authError
  
  return (api.handler as any)(req, { params: api.params, auth })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const p = await params
  const pathname = '/' + (p.slug?.join('/') ?? '')
  const api = findApi(modules, 'PUT', pathname)
  if (!api) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  const auth = getAuthFromRequest(req as any as Request)
  
  const authError = await checkAuthorization(api.metadata?.PUT, auth, req)
  if (authError) return authError
  
  return (api.handler as any)(req, { params: api.params, auth })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const p = await params
  const pathname = '/' + (p.slug?.join('/') ?? '')
  const api = findApi(modules, 'PATCH', pathname)
  if (!api) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  const auth = getAuthFromRequest(req as any as Request)
  
  const authError = await checkAuthorization(api.metadata?.PATCH, auth, req)
  if (authError) return authError
  
  return (api.handler as any)(req, { params: api.params, auth })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const p = await params
  const pathname = '/' + (p.slug?.join('/') ?? '')
  const api = findApi(modules, 'DELETE', pathname)
  if (!api) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  const auth = getAuthFromRequest(req as any as Request)
  
  const authError = await checkAuthorization(api.metadata?.DELETE, auth, req)
  if (authError) return authError
  
  return (api.handler as any)(req, { params: api.params, auth })
}
