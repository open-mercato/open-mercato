import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['voice_channels.copilot.view'] },
}

export const openApi = {
  summary: 'List active and recent Copilot call sessions',
  tags: ['Voice Channels'],
}

export async function GET(req: Request) {
  const ctx = resolveRequestContext(req)
  const orchestrator = ctx.container.resolve<any>('copilotOrchestrator')

  const activeSessions = orchestrator.getActiveSessions()
  return Response.json({
    calls: activeSessions.map((session: any) => ({
      callId: session.callId,
      customerId: session.customerId,
      startedAt: session.startedAt,
      segmentCount: session.segmentCount,
    })),
  })
}
