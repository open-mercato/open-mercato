import { NextRequest, NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/core'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CurrencyFetchConfig } from '../../data/entities'
import {
  createFetchConfig,
  updateFetchConfig,
  deleteFetchConfig,
} from '../../commands/fetch-configs'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['currencies.fetch.view'],
}

export async function GET(req: NextRequest) {
  const container = await createRequestContainer()

  try {
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId || !auth.orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const em = container.resolve<EntityManager>('em')

    const configs = await em.find(
      CurrencyFetchConfig,
      {
        tenantId: auth.tenantId,
        organizationId: auth.orgId,
      },
      {
        orderBy: { provider: 'ASC' },
      }
    )

    return NextResponse.json({ configs })
  } finally {
    await (container as any).dispose?.()
  }
}

export async function POST(req: NextRequest) {
  const container = await createRequestContainer()

  try {
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId || !auth.orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const em = container.resolve<EntityManager>('em')
    
    let body
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const config = await createFetchConfig(em, body, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      userId: auth.sub,
    })

    return NextResponse.json({ config }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  } finally {
    await (container as any).dispose?.()
  }
}

export async function PUT(req: NextRequest) {
  const container = await createRequestContainer()

  try {
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId || !auth.orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const em = container.resolve<EntityManager>('em')
    
    let body
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    
    const { id, ...data } = body

    if (!id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 })
    }

    const config = await updateFetchConfig(em, id, data, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      userId: auth.sub,
    })

    return NextResponse.json({ config })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  } finally {
    await (container as any).dispose?.()
  }
}

export async function DELETE(req: NextRequest) {
  const container = await createRequestContainer()

  try {
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId || !auth.orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const em = container.resolve<EntityManager>('em')
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 })
    }

    await deleteFetchConfig(em, id, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      userId: auth.sub,
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  } finally {
    await (container as any).dispose?.()
  }
}
