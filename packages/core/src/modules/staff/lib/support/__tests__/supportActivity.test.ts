const mockEmit = jest.fn()
const mockReportError = jest.fn()
jest.mock('../../../events', () => ({ emitStaffEvent: (...args: unknown[]) => mockEmit(...args) }))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))
import { emitSupportAttachmentActivity } from '../supportActivity'

const task = { id: 'task', tenantId: 'tenant', organizationId: 'org', timeProjectId: 'project' }

beforeEach(() => jest.clearAllMocks())

test('activity completion follows delayed event delivery', async () => {
  let release!: () => void
  mockEmit.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve }))
  let completed = false
  const delivery = emitSupportAttachmentActivity(task, { id: 'ticket' }, 'attachment_added', 'attachment').then(() => { completed = true })
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(completed).toBe(false)
  release()
  await delivery
  expect(completed).toBe(true)
})

test('delivery failures are reported without failing the stored mutation', async () => {
  const failure = new Error('[internal] Delivery failed')
  mockEmit.mockRejectedValueOnce(failure)
  await expect(emitSupportAttachmentActivity(task, { id: 'ticket' }, 'attachment_removed', 'attachment')).resolves.toBeUndefined()
  expect(mockReportError).toHaveBeenCalledWith(failure, expect.objectContaining({ code: 'staff.support_activity_emit_failed' }))
})
