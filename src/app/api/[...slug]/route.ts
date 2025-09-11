import { NextResponse } from 'next/server'
import { findApi } from '@/modules/registry'
import { getAuthFromRequest } from '@/lib/auth/server'

export async function GET(req: Request, { params }: { params: { slug: string[] } }) {
  const pathname = '/' + (params.slug?.join('/') ?? '')
  const api = findApi('GET', pathname)
  if (!api) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  const auth = getAuthFromRequest(req)
  if (api.requireAuth && !auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return (api.handler as any)(req, { params: api.params, auth })
}

export async function POST(req: Request, { params }: { params: { slug: string[] } }) {
  const pathname = '/' + (params.slug?.join('/') ?? '')
  const api = findApi('POST', pathname)
  if (!api) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  const auth = getAuthFromRequest(req)
  if (api.requireAuth && !auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return (api.handler as any)(req, { params: api.params, auth })
}

export async function PUT(req: Request, { params }: { params: { slug: string[] } }) {
  const pathname = '/' + (params.slug?.join('/') ?? '')
  const api = findApi('PUT', pathname)
  if (!api) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  const auth = getAuthFromRequest(req)
  if (api.requireAuth && !auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return (api.handler as any)(req, { params: api.params, auth })
}

export async function PATCH(req: Request, { params }: { params: { slug: string[] } }) {
  const pathname = '/' + (params.slug?.join('/') ?? '')
  const api = findApi('PATCH', pathname)
  if (!api) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  const auth = getAuthFromRequest(req)
  if (api.requireAuth && !auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return (api.handler as any)(req, { params: api.params, auth })
}

export async function DELETE(req: Request, { params }: { params: { slug: string[] } }) {
  const pathname = '/' + (params.slug?.join('/') ?? '')
  const api = findApi('DELETE', pathname)
  if (!api) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  const auth = getAuthFromRequest(req)
  if (api.requireAuth && !auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return (api.handler as any)(req, { params: api.params, auth })
}
