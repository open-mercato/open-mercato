import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['voice_channels.mock.manage'] },
}

export const openApi = {
  summary: 'Get status of current mock call',
  tags: ['Voice Channels'],
}

export async function GET(req: Request) {
  const ctx = resolveRequestContext(req)
  const simulator = ctx.container.resolve<any>('mockTranscriptSimulator')

  return Response.json({
    isRunning: simulator.isRunning(),
    callId: simulator.currentCallId() ?? null,
    elapsedMs: simulator.elapsedMs() ?? 0,
  })
}
