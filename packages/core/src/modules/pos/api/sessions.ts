/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { CrudHttpError as HttpError } from '@open-mercato/shared/lib/crud/errors'
import { container } from '@open-mercato/shared/lib/di/container'
import { PosSession } from '../data/entities'
import {
    posSessionCreateSchema,
    posSessionUpdateSchema,
    posSessionSchema,
    openPosSessionSchema,
    closePosSessionSchema
} from '../data/validators'
import { E } from '#generated/entities.ids.generated'
import {
    buildPosCrudOpenApi,
    createPagedListResponseSchema,
    defaultOkResponseSchema
} from './openapi'

const routeMetadata = {
    GET: { requireAuth: true, requireFeatures: ['pos.session.view'] },
    POST: { requireAuth: true, requireFeatures: ['pos.session.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['pos.session.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['pos.session.manage'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
    .object({
        page: z.coerce.number().min(1).default(1),
        pageSize: z.coerce.number().min(1).max(100).default(50),
        id: z.string().uuid().optional(),
        status: z.string().optional(),
        registerId: z.string().uuid().optional(),
        sortField: z.string().optional(),
        sortDir: z.enum(['asc', 'desc']).optional(),
    })
    .passthrough()

const crud = makeCrudRoute({
    metadata: routeMetadata,
    orm: {
        entity: PosSession,
        idField: 'id',
        orgField: 'organizationId',
        tenantField: 'tenantId',
        softDeleteField: 'deletedAt',
    },
    indexer: { entityType: E.pos.pos_session },
    list: {
        schema: listSchema,
        entityId: E.pos.pos_session,
        fields: [
            'id',
            'status',
            'registerId',
            'openedByUserId',
            'closedByUserId',
            'openedAt',
            'closedAt',
            'openingFloatAmount',
            'closingCashAmount',
            'expectedCashAmount',
            'varianceAmount',
            'currencyCode',
            'organizationId',
            'tenantId',
            'createdAt',
        ],
        sortFieldMap: {
            openedAt: 'openedAt',
            closedAt: 'closedAt',
            createdAt: 'createdAt',
            updatedAt: 'updatedAt',
        },
        buildFilters: async (query: any) => {
            const filters: Record<string, any> = {}
            if (query.id) filters.id = { $eq: query.id }
            if (query.status) filters.status = { $eq: query.status }
            if (query.registerId) filters.registerId = { $eq: query.registerId }
            return filters
        },
    },
    actions: {
        create: {
            commandId: 'pos.session.create',
            schema: rawBodySchema,
            mapInput: async ({ raw, ctx }) => {
                const { translate } = await resolveTranslations()
                return parseScopedCommandInput(posSessionCreateSchema, raw ?? {}, ctx, translate)
            },
            response: ({ result }) => ({ ok: true, item: result }),
            status: 201,
        },
        update: {
            commandId: 'pos.session.update',
            schema: rawBodySchema,
            mapInput: async ({ raw, ctx }) => {
                const { translate } = await resolveTranslations()
                return parseScopedCommandInput(posSessionUpdateSchema, raw ?? {}, ctx, translate)
            },
            response: ({ result }) => ({ ok: true, item: result }),
        },
        delete: {
            commandId: 'pos.session.delete',
            schema: rawBodySchema,
            mapInput: async ({ parsed, ctx }) => {
                const { translate } = await resolveTranslations()
                const id = resolveCrudRecordId(parsed, ctx, translate)
                return { id }
            },
            response: () => ({ ok: true }),
        },
    },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

// LifeCycle Actions
export async function POST_OPEN(req: Request, ctx: any) {
    const { id } = ctx.params
    const body = await req.json()
    const payload = openPosSessionSchema.parse(body)

    const commandBus = ctx.container.resolve('commandBus')
    const { result } = await commandBus.execute('pos.session.open', {
        input: { id, ...payload },
        ctx,
    })

    return Response.json(result, { status: 200 })
}

export async function POST_CLOSE(req: Request, ctx: any) {
    const { id } = ctx.params
    const body = await req.json()
    const payload = closePosSessionSchema.parse(body)

    const commandBus = ctx.container.resolve('commandBus')
    const { result } = await commandBus.execute('pos.session.close', {
        input: { id, ...payload },
        ctx,
    })

    return Response.json(result, { status: 200 })
}

// OpenAPI
const posSessionListItemSchema = posSessionSchema.pick({
    id: true,
    status: true,
    registerId: true,
    openedByUserId: true,
    closedByUserId: true,
    openedAt: true,
    closedAt: true,
    openingFloatAmount: true,
    currencyCode: true,
    createdAt: true,
})

export const openApi = {
    ...buildPosCrudOpenApi({
        resourceName: 'PosSession',
        pluralName: 'PosSessions',
        querySchema: listSchema,
        listResponseSchema: createPagedListResponseSchema(posSessionListItemSchema),
        create: {
            schema: posSessionCreateSchema,
            description: 'Creates a pos session.',
        },
        update: {
            schema: posSessionUpdateSchema,
            responseSchema: defaultOkResponseSchema,
            description: 'Updates a pos session.',
        },
        del: {
            schema: z.object({ id: z.string().uuid() }),
            responseSchema: defaultOkResponseSchema,
            description: 'Deletes a pos session by id.',
        },
    }),
    '/api/pos/sessions/{id}/open': {
        post: {
            summary: 'Open a POS session',
            tags: ['POS Session'],
            requestBody: {
                content: { 'application/json': { schema: openPosSessionSchema } },
            },
            responses: {
                '200': {
                    description: 'Session opened',
                    content: { 'application/json': { schema: posSessionSchema } },
                },
            },
        },
    },
    '/api/pos/sessions/{id}/close': {
        post: {
            summary: 'Close a POS session',
            tags: ['POS Session'],
            requestBody: {
                content: { 'application/json': { schema: closePosSessionSchema } },
            },
            responses: {
                '200': {
                    description: 'Session closed',
                    content: { 'application/json': { schema: posSessionSchema } },
                },
            },
        },
    },
}
