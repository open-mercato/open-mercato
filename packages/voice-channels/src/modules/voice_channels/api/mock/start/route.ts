import { z } from 'zod'
import type { MockCallScript } from '@open-mercato/voice-channels/modules/voice_channels/types'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'

const startBodySchema = z.object({
  script: z.object({
    callId: z.string().min(1),
    customerId: z.string().min(1),
    segments: z.array(z.object({
      speaker: z.enum(['customer', 'agent']),
      text: z.string(),
      delayMs: z.number().int().nonnegative(),
    })).min(1),
  }),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['voice_channels.mock.manage'] },
}

export const openApi = {
  summary: 'Start a mock call simulation',
  tags: ['Voice Channels'],
}

export async function POST(req: Request) {
  const ctx = resolveRequestContext(req)
  const parsed = startBodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
  }
  const body = parsed.data

  const simulator = ctx.container.resolve<any>('mockTranscriptSimulator')
  const orchestrator = ctx.container.resolve<any>('copilotOrchestrator')

  // Start orchestrator session (subscriber auto-wires segments → orchestrator via event bus)
  await orchestrator.startSession(
    body.script.callId,
    body.script.customerId,
    ctx.tenantId!,
    ctx.organizationId!
  )

  const result = await simulator.startCall(body.script, ctx.tenantId!, ctx.organizationId!)

  return Response.json(result)
}
