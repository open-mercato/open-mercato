import { NextResponse } from 'next/server'

type RouteContext = {
  params: Promise<{ path: string[] }>
}

const API_BASE =
  process.env.STOREFRONT_API_URL ??
  process.env.NEXT_PUBLIC_STOREFRONT_API_URL ??
  ''

function normalizeHost(value: string | null): string | null {
  if (!value) return null
  return value.trim().toLowerCase()
}

async function proxy(req: Request, context: RouteContext): Promise<Response> {
  if (!API_BASE) {
    return NextResponse.json(
      { error: 'Storefront API base URL is not configured' },
      { status: 500 },
    )
  }

  const { path } = await context.params
  const incomingUrl = new URL(req.url)
  const upstreamUrl = new URL(
    `/api/ecommerce/storefront/${path.join('/')}`,
    API_BASE,
  )
  incomingUrl.searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.set(key, value)
  })

  const incomingHost = normalizeHost(incomingUrl.host)
  const upstreamHost = normalizeHost(upstreamUrl.host)
  if (incomingHost && upstreamHost && incomingHost === upstreamHost) {
    return NextResponse.json(
      {
        error:
          'Storefront proxy misconfiguration: STOREFRONT_API_URL points to storefront app host, causing recursive proxy calls. Point it to Open Mercato backend host.',
      },
      { status: 500 },
    )
  }

  const upstreamHeaders = new Headers(req.headers)
  upstreamHeaders.delete('host')
  upstreamHeaders.delete('connection')
  upstreamHeaders.delete('content-length')

  const method = req.method.toUpperCase()
  const upstreamResponse = await fetch(upstreamUrl.toString(), {
    method,
    headers: upstreamHeaders,
    body: method === 'GET' || method === 'HEAD' ? undefined : req.body,
    redirect: 'manual',
  })

  const responseHeaders = new Headers(upstreamResponse.headers)
  responseHeaders.delete('content-length')
  responseHeaders.delete('transfer-encoding')

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  })
}

export async function GET(req: Request, context: RouteContext) {
  return proxy(req, context)
}

export async function POST(req: Request, context: RouteContext) {
  return proxy(req, context)
}

export async function PUT(req: Request, context: RouteContext) {
  return proxy(req, context)
}

export async function PATCH(req: Request, context: RouteContext) {
  return proxy(req, context)
}

export async function DELETE(req: Request, context: RouteContext) {
  return proxy(req, context)
}
