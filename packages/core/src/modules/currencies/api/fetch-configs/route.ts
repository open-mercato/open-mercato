import { NextRequest, NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/core'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { CurrencyFetchConfig } from '../../data/entities'
import {
  createFetchConfig,
  updateFetchConfig,
  deleteFetchConfig,
} from '../../commands/fetch-configs'
import { currencyFetchConfigCreateSchema, currencyFetchConfigUpdateSchema } from '../../data/validators'

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

const fetchConfigItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  provider: z.string(),
  isEnabled: z.boolean(),
  syncTime: z.string().nullable(),
  lastSyncAt: z.string().nullable().optional(),
  lastSyncStatus: z.string().nullable().optional(),
  lastSyncMessage: z.string().nullable().optional(),
  lastSyncCount: z.number().nullable().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  summary: 'Manage currency fetch configurations',
  description: 'Endpoints for managing currency rate fetch configurations from external providers.',
  methods: {
    GET: {
      operationId: 'listCurrencyFetchConfigs',
      summary: 'List currency fetch configurations',
      description: 'Returns all currency fetch configurations scoped to the authenticated organization.',
      responses: [
        {
          status: 200,
          description: 'A list of currency fetch configurations',
          schema: z.object({
            configs: z.array(fetchConfigItemSchema),
          }),
        },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
    POST: {
      operationId: 'createCurrencyFetchConfig',
      summary: 'Create currency fetch configuration',
      description: 'Creates a new currency fetch configuration.',
      requestBody: {
        schema: currencyFetchConfigCreateSchema,
        contentType: 'application/json',
      },
      responses: [
        {
          status: 201,
          description: 'Currency fetch configuration created successfully',
          schema: z.object({
            config: fetchConfigItemSchema,
          }),
        },
      ],
      errors: [
        { status: 400, description: 'Bad request', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
    PUT: {
      operationId: 'updateCurrencyFetchConfig',
      summary: 'Update currency fetch configuration',
      description: 'Updates an existing currency fetch configuration by id.',
      requestBody: {
        schema: currencyFetchConfigUpdateSchema.extend({
          id: z.string().uuid(),
        }),
        contentType: 'application/json',
      },
      responses: [
        {
          status: 200,
          description: 'Currency fetch configuration updated successfully',
          schema: z.object({
            config: fetchConfigItemSchema,
          }),
        },
      ],
      errors: [
        { status: 400, description: 'Bad request', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
    DELETE: {
      operationId: 'deleteCurrencyFetchConfig',
      summary: 'Delete currency fetch configuration',
      description: 'Deletes a currency fetch configuration by id.',
      query: z.object({
        id: z.string().uuid().describe('Currency fetch configuration identifier to delete'),
      }),
      responses: [
        {
          status: 200,
          description: 'Currency fetch configuration deleted successfully',
          schema: z.object({ success: z.literal(true) }),
        },
      ],
      errors: [
        { status: 400, description: 'Bad request', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
  },
}
