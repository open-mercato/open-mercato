import { NextResponse, type NextRequest } from 'next/server'
import { findApi } from '@open-mercato/shared/modules/registry'
import { modules } from '@/generated/modules.generated'
import { getAuthFromRequest } from '@/lib/auth/server'

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const p = await params
  const pathname = '/' + (p.slug?.join('/') ?? '')
  const api = findApi(modules, 'GET', pathname)
  if (!api) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  const auth = getAuthFromRequest(req as any as Request)
  if (api.requireAuth && !auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((api.requireRoles && api.requireRoles.length) && (!auth || !auth.roles || !api.requireRoles.some(r => auth.roles!.includes(r)))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return (api.handler as any)(req, { params: api.params, auth })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const p = await params
  const pathname = '/' + (p.slug?.join('/') ?? '')
  const api = findApi(modules, 'POST', pathname)
  if (!api) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  const auth = getAuthFromRequest(req as any as Request)
  if (api.requireAuth && !auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((api.requireRoles && api.requireRoles.length) && (!auth || !auth.roles || !api.requireRoles.some(r => auth.roles!.includes(r)))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return (api.handler as any)(req, { params: api.params, auth })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const p = await params
  const pathname = '/' + (p.slug?.join('/') ?? '')
  const api = findApi(modules, 'PUT', pathname)
  if (!api) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  const auth = getAuthFromRequest(req as any as Request)
  if (api.requireAuth && !auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((api.requireRoles && api.requireRoles.length) && (!auth || !auth.roles || !api.requireRoles.some(r => auth.roles!.includes(r)))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return (api.handler as any)(req, { params: api.params, auth })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const p = await params
  const pathname = '/' + (p.slug?.join('/') ?? '')
  const api = findApi(modules, 'PATCH', pathname)
  if (!api) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  const auth = getAuthFromRequest(req as any as Request)
  if (api.requireAuth && !auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((api.requireRoles && api.requireRoles.length) && (!auth || !auth.roles || !api.requireRoles.some(r => auth.roles!.includes(r)))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return (api.handler as any)(req, { params: api.params, auth })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const p = await params
  const pathname = '/' + (p.slug?.join('/') ?? '')
  const api = findApi(modules, 'DELETE', pathname)
  if (!api) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  const auth = getAuthFromRequest(req as any as Request)
  if (api.requireAuth && !auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return (api.handler as any)(req, { params: api.params, auth })
}
