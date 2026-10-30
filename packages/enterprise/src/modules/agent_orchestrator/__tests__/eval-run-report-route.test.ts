/** @jest-environment node */
import { GET, metadata, openApi } from '../api/eval-runs/[id]/report/route'
import { buildEvalReport, EvalRunNotFinishedError } from '../lib/eval/report/buildEvalReport'
import { buildEvalErrorReport } from '../lib/eval/report/errorReport'
import type { EvalReport } from '../lib/eval/report/reportSchema'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('../lib/eval/report/buildEvalReport', () => {
  const actual = jest.requireActual('../lib/eval/report/buildEvalReport')
  return { ...actual, buildEvalReport: jest.fn() }
})

const { getAuthFromRequest } = jest.requireMock('@open-mercato/shared/lib/auth/server') as {
  getAuthFromRequest: jest.Mock
}
const { createRequestContainer } = jest.requireMock('@open-mercato/shared/lib/di/container') as {
  createRequestContainer: jest.Mock
}
const buildEvalReportMock = buildEvalReport as jest.MockedFunction<typeof buildEvalReport>

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const SUITE_RUN_ID = '33333333-3333-4333-8333-333333333333'
const forkedEm = { marker: 'forked-em' }

function sampleReport(status: EvalReport['status'] = 'completed'): EvalReport {
  const report = buildEvalErrorReport({
    agentDefinitionId: 'sales.deal_researcher',
    message: 'sample',
    suiteRunId: SUITE_RUN_ID,
    env: {},
    now: () => new Date('2026-10-22T10:00:00.000Z'),
  })
  return { ...report, status }
}

function callRoute(query = '', id = SUITE_RUN_ID) {
  const url = `http://localhost/api/agent_orchestrator/eval-runs/${id}/report${query}`
  return GET(new Request(url), { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  jest.clearAllMocks()
  getAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT, orgId: ORG })
  createRequestContainer.mockResolvedValue({
    resolve: (key: string) => (key === 'em' ? { fork: () => forkedEm } : null),
  })
  buildEvalReportMock.mockResolvedValue(sampleReport())
})

describe('GET /api/agent_orchestrator/eval-runs/:id/report', () => {
  it('requires the eval.export feature and documents the route', () => {
    expect(metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['agent_orchestrator.eval.export'] })
    expect(openApi.methods.GET?.errors?.map((entry) => entry.status)).toEqual([400, 401, 403, 404, 409])
  })

  it('returns the JSON report as an attachment by default, scoped to the caller', async () => {
    const response = await callRoute()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="eval-${SUITE_RUN_ID}.json"`)
    const body = JSON.parse(await response.text()) as EvalReport
    expect(body.schema).toBe('open-mercato.agent-eval-report')
    expect(body.suiteRun.id).toBe(SUITE_RUN_ID)
    expect(buildEvalReportMock).toHaveBeenCalledWith(
      forkedEm,
      { tenantId: TENANT, organizationId: ORG },
      SUITE_RUN_ID,
      { includePayloads: false, partial: false, evidenceMaxChars: undefined },
    )
  })

  it('renders Markdown with a .md filename', async () => {
    const response = await callRoute('?format=md')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="eval-${SUITE_RUN_ID}.md"`)
    expect(await response.text()).toContain(SUITE_RUN_ID)
  })

  it('renders JUnit XML with a .xml filename', async () => {
    const response = await callRoute('?format=junit')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/xml; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="eval-${SUITE_RUN_ID}.xml"`)
    expect(await response.text()).toMatch(/^<\?xml/)
  })

  it('passes the payload, partial and evidence options through', async () => {
    await callRoute('?includePayloads=true&partial=1&evidenceMaxChars=500')
    expect(buildEvalReportMock).toHaveBeenCalledWith(forkedEm, expect.any(Object), SUITE_RUN_ID, {
      includePayloads: true,
      partial: true,
      evidenceMaxChars: 500,
    })
  })

  it('rejects an unknown format, a malformed boolean and an out-of-range evidence cap', async () => {
    for (const query of ['?format=html', '?includePayloads=maybe', '?evidenceMaxChars=10']) {
      const response = await callRoute(query)
      expect(response.status).toBe(400)
    }
    expect(buildEvalReportMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed id before touching the database', async () => {
    const response = await callRoute('', 'not-a-uuid')
    expect(response.status).toBe(400)
    expect(createRequestContainer).not.toHaveBeenCalled()
  })

  it('returns 404 when the run is not in the caller scope', async () => {
    buildEvalReportMock.mockResolvedValue(null)
    const response = await callRoute()
    expect(response.status).toBe(404)
  })

  it('returns 409 run_not_finished while the run is queued or running', async () => {
    buildEvalReportMock.mockRejectedValue(new EvalRunNotFinishedError(SUITE_RUN_ID))
    const response = await callRoute()
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'run_not_finished', code: 'run_not_finished' })
  })

  it('returns a running report when partial is requested', async () => {
    buildEvalReportMock.mockResolvedValue(sampleReport('running'))
    const response = await callRoute('?partial=true')
    expect(response.status).toBe(200)
    const body = JSON.parse(await response.text()) as EvalReport
    expect(body.status).toBe('running')
  })

  it('rethrows unexpected failures', async () => {
    buildEvalReportMock.mockRejectedValue(new Error('[internal] boom'))
    await expect(callRoute()).rejects.toThrow('boom')
  })

  it('returns 401 without auth and 400 without tenant context', async () => {
    getAuthFromRequest.mockResolvedValueOnce(null)
    expect((await callRoute()).status).toBe(401)
    getAuthFromRequest.mockResolvedValueOnce({ sub: 'user-1', tenantId: TENANT, orgId: null })
    expect((await callRoute()).status).toBe(400)
  })
})
