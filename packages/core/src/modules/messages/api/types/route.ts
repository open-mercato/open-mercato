import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { getAllMessageTypes } from '../../lib/message-types-registry'
import { messageTypeListResponseSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['messages.view'] },
}

export async function GET() {
  const items = getAllMessageTypes().map((type) => ({
    type: type.type,
    module: type.module,
    labelKey: type.labelKey,
    icon: type.icon,
    color: type.color ?? null,
    isCreateableByUser: type.isCreateableByUser,
    allowReply: type.allowReply ?? true,
    allowForward: type.allowForward ?? true,
    actionsExpireAfterHours: type.actionsExpireAfterHours ?? null,
    ui: {
      listItemComponent: type.ui?.listItemComponent ?? null,
      contentComponent: type.ui?.contentComponent ?? null,
      actionsComponent: type.ui?.actionsComponent ?? null,
    },
  }))

  return Response.json({ items })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    GET: {
      summary: 'List registered message types',
      responses: [
        { status: 200, description: 'Message types', schema: messageTypeListResponseSchema },
      ],
    },
  },
}
