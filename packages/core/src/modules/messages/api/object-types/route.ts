import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { messageObjectTypesQuerySchema } from '../../data/validators'
import { getMessageObjectTypesForMessageType } from '../../lib/message-objects-registry'
import {
  messageObjectTypeListResponseSchema,
  messageObjectTypesQuerySchema as messageObjectTypesQueryOpenApiSchema,
} from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['messages.compose'] },
}

export async function GET(req: Request) {
  const params = Object.fromEntries(new URL(req.url).searchParams)
  const parsed = messageObjectTypesQuerySchema.safeParse(params)
  if (!parsed.success) {
    return Response.json({ error: 'messageType is required' }, { status: 400 })
  }
  const input = parsed.data

  const items = getMessageObjectTypesForMessageType(input.messageType).map((objectType) => ({
    module: objectType.module,
    entityType: objectType.entityType,
    labelKey: objectType.labelKey,
    icon: objectType.icon,
    actions: objectType.actions.map((action) => ({
      id: action.id,
      labelKey: action.labelKey,
      variant: action.variant,
      icon: action.icon,
      commandId: action.commandId,
      href: action.href,
      isTerminal: action.isTerminal,
      confirmRequired: action.confirmRequired,
      confirmMessage: action.confirmMessage,
    })),
  }))

  return Response.json({ items })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    GET: {
      summary: 'List registered message object types for a message type',
      query: messageObjectTypesQueryOpenApiSchema,
      responses: [
        { status: 200, description: 'Message object types', schema: messageObjectTypeListResponseSchema },
        { status: 400, description: 'Invalid query' },
      ],
    },
  },
}
