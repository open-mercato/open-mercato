import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { SortDir, type QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { messageObjectOptionsQuerySchema } from '../../data/validators'
import {
  getMessageObjectType,
  isMessageObjectTypeAllowedForMessageType,
} from '../../lib/message-objects-registry'
import { getMessageType } from '../../lib/message-types-registry'
import { resolveMessageContext } from '../../lib/routeHelpers'
import {
  errorResponseSchema,
  messageObjectOptionListResponseSchema,
  messageObjectOptionsQuerySchema as messageObjectOptionsQueryOpenApiSchema,
} from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['messages.compose'] },
}

const LABEL_FIELD_CANDIDATES = ['name', 'title', 'subject', 'email', 'code', 'id']

function readFieldAsString(
  row: Record<string, unknown>,
  field: string | null | undefined,
): string | null {
  if (!field || !field.trim()) return null
  const value = row[field]
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

export async function GET(req: Request) {
  const { ctx, scope } = await resolveMessageContext(req)
  const params = Object.fromEntries(new URL(req.url).searchParams)
  const parsed = messageObjectOptionsQuerySchema.safeParse(params)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid object options query' }, { status: 400 })
  }
  const input = parsed.data

  const messageType = getMessageType(input.messageType)
  if (!messageType) {
    return Response.json({ error: 'Unknown message type' }, { status: 400 })
  }

  const objectType = getMessageObjectType(input.entityModule, input.entityType)
  if (!objectType) {
    return Response.json({ error: 'Message object type not found' }, { status: 404 })
  }

  if (!isMessageObjectTypeAllowedForMessageType(objectType, messageType.type)) {
    return Response.json({ error: 'Object type is not allowed for this message type' }, { status: 403 })
  }

  const queryEngine = ctx.container.resolve('queryEngine') as QueryEngine
  const entityId = (objectType.entityId ?? `${objectType.module}:${objectType.entityType}`) as EntityId
  const labelField = objectType.optionLabelField?.trim() || 'id'
  const subtitleField = objectType.optionSubtitleField?.trim() || null

  const fields = Array.from(
    new Set([
      'id',
      labelField,
      subtitleField,
      ...LABEL_FIELD_CANDIDATES,
    ].filter((field): field is string => Boolean(field && field.trim().length))),
  )

  const search = input.search?.trim()
  const filters = search
    ? {
        [labelField]: {
          $ilike: `%${escapeLikePattern(search)}%`,
        },
      }
    : undefined

  const result = await queryEngine.query<Record<string, unknown>>(entityId, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId ?? undefined,
    fields,
    filters,
    page: { page: input.page, pageSize: input.pageSize },
    sort: [{ field: labelField, dir: SortDir.Asc }],
    withDeleted: false,
  })

  const items: Array<{ id: string; label: string; subtitle?: string }> = []
  for (const row of result.items ?? []) {
    const id = readFieldAsString(row, 'id')
    if (!id) continue

    const label =
      readFieldAsString(row, labelField)
      ?? LABEL_FIELD_CANDIDATES
        .map((candidate) => readFieldAsString(row, candidate))
        .find((candidate): candidate is string => Boolean(candidate))
      ?? id

    const subtitle =
      readFieldAsString(row, subtitleField)
      ?? (subtitleField ? null : readFieldAsString(row, 'email'))
      ?? (subtitleField ? null : readFieldAsString(row, 'code'))
      ?? (subtitleField ? null : readFieldAsString(row, 'subject'))

    items.push({
      id,
      label,
      subtitle: subtitle ?? undefined,
    })
  }

  const totalPages = Math.max(1, Math.ceil(result.total / input.pageSize))

  return Response.json({
    items,
    page: input.page,
    pageSize: input.pageSize,
    total: result.total,
    totalPages,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    GET: {
      summary: 'List selectable object records for deterministic attachment picker',
      query: messageObjectOptionsQueryOpenApiSchema,
      responses: [
        { status: 200, description: 'Object options', schema: messageObjectOptionListResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid input', schema: errorResponseSchema },
        { status: 403, description: 'Object type not allowed', schema: errorResponseSchema },
        { status: 404, description: 'Object type not found', schema: errorResponseSchema },
      ],
    },
  },
}
