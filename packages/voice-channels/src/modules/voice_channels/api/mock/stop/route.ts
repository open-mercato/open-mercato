import { z } from 'zod'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'

const stopBodySchema = z.object({
  callId: z.string().min(1),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['voice_channels.mock.manage'] },
}

export const openApi = {
  summary: 'Stop the active mock call simulation',
  tags: ['Voice Channels'],
}

export async function POST(req: Request) {
  const ctx = resolveRequestContext(req)
  const parsed = stopBodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
  }
  const body = parsed.data

  const simulator = ctx.container.resolve<any>('mockTranscriptSimulator')
  const orchestrator = ctx.container.resolve<any>('copilotOrchestrator')

  simulator.stopCall()
  orchestrator.endSession(body.callId)

  return Response.json({ stopped: true })
}
