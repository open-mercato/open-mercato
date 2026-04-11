import { z } from 'zod'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { setCacheEnabled, isCacheEnabled } from '../../../lib/copilot/response-cache'

const cacheBodySchema = z.object({
  enabled: z.boolean(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['voice_channels.mock.manage'] },
}

export const openApi = {
  summary: 'Toggle the response cache on or off at runtime',
  tags: ['Voice Channels'],
}

export async function POST(req: Request) {
  const ctx = resolveRequestContext(req)
  const parsed = cacheBodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
  }

  setCacheEnabled(parsed.data.enabled)

  return Response.json({
    cacheEnabled: isCacheEnabled(),
  })
}
