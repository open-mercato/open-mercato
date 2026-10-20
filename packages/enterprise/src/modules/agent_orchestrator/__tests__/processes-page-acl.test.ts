/** @jest-environment node */
import { metadata as listPageMeta } from '../backend/processes/page.meta'
import { metadata as detailPageMeta } from '../backend/processes/[id]/page.meta'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

// P0-2 invariant (spec 2026-07-12-ux-p0-hotfixes §2): the Processes pages and
// their APIs must gate the same feature. A page-only `trace.view` gate lets
// trace-view users open a page whose every fetch 403s, while processes.view
// users cannot see the page at all.
describe('agent_orchestrator processes page↔API ACL parity', () => {
  const processesView = 'agent_orchestrator.processes.view'

  it('gates both pages on processes.view', () => {
    expect(listPageMeta.requireFeatures).toEqual([processesView])
    expect(detailPageMeta.requireFeatures).toEqual([processesView])
  })

  it('matches the API gates for list and detail', async () => {
    const { metadata: listApiMeta } = await import('../api/processes/route')
    const { metadata: detailApiMeta } = await import('../api/processes/[id]/route')
    expect(listApiMeta.GET.requireFeatures).toEqual(listPageMeta.requireFeatures)
    expect(detailApiMeta.GET.requireFeatures).toEqual(detailPageMeta.requireFeatures)
  })
})
