/** @jest-environment node */
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const mockExecute = jest.fn()
const mockDispose = jest.fn(async () => undefined)
const mockContainer = {
  resolve: jest.fn((token: string) => (token === 'commandBus' ? { execute: mockExecute } : undefined)),
  dispose: mockDispose,
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

import cli from '../cli'

const TENANT = '22222222-2222-4222-8222-222222222222'
const ORG = '11111111-1111-4111-8111-111111111111'
const PERIOD = '33333333-3333-4333-8333-333333333333'

const commandNamed = (name: string) => {
  const found = cli.find((entry) => entry.command === name)
  if (!found) throw new Error(`[internal] CLI command ${name} is not registered`)
  return found
}

describe('posting_rules CLI', () => {
  let logSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    process.exitCode = undefined
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
    process.exitCode = undefined
  })

  const errorOutput = () => errorSpy.mock.calls.map((call) => call.map(String).join(' ')).join('\n')
  const logOutput = () => logSpy.mock.calls.map((call) => call.map(String).join(' ')).join('\n')

  describe('reconcile-cost-ring', () => {
    it('runs posting_rules.reconcileCostRing through the command bus as a system actor scoped to --org', async () => {
      mockExecute.mockResolvedValue({ result: { entriesInspected: 2, linesReclassified: 3, failures: [] }, logEntry: null })

      await commandNamed('reconcile-cost-ring').run(['--tenant', TENANT, '--org', ORG, '--period', PERIOD])

      expect(mockExecute).toHaveBeenCalledTimes(1)
      const [commandId, options] = mockExecute.mock.calls[0]
      expect(commandId).toBe('posting_rules.reconcileCostRing')
      expect(options.input).toEqual({ tenantId: TENANT, organizationId: ORG, periodId: PERIOD })
      expect(options.ctx).toMatchObject({
        container: mockContainer,
        auth: null,
        selectedOrganizationId: ORG,
        organizationIds: [ORG],
        systemActor: true,
      })
      expect(logOutput()).toContain('3 lines reclassified')
      expect(process.exitCode).toBeUndefined()
      expect(mockDispose).toHaveBeenCalled()
    })

    it('passes periodId null when --period is omitted (every period)', async () => {
      mockExecute.mockResolvedValue({ result: { entriesInspected: 0, linesReclassified: 0, failures: [] }, logEntry: null })
      await commandNamed('reconcile-cost-ring').run([`--tenant=${TENANT}`, `--org=${ORG}`])
      expect(mockExecute.mock.calls[0][1].input).toEqual({ tenantId: TENANT, organizationId: ORG, periodId: null })
    })

    it('exits non-zero and lists every line that could not be reclassified', async () => {
      mockExecute.mockResolvedValue({
        result: { entriesInspected: 1, linesReclassified: 0, failures: [{ entryId: 'entry-1', lineId: 'line-1', error: 'No target account.' }] },
        logEntry: null,
      })
      await commandNamed('reconcile-cost-ring').run(['--tenant', TENANT, '--org', ORG])
      expect(errorOutput()).toContain('entry entry-1 line line-1: No target account.')
      expect(process.exitCode).toBe(1)
    })

    it('exits non-zero with the named error when the run is rejected', async () => {
      mockExecute.mockRejectedValue(new CrudHttpError(422, { error: 'The technical clearing account is not configured.' }))
      await commandNamed('reconcile-cost-ring').run(['--tenant', TENANT, '--org', ORG])
      expect(errorOutput()).toContain('reconcile-cost-ring failed (422): The technical clearing account is not configured.')
      expect(process.exitCode).toBe(1)
      expect(mockDispose).toHaveBeenCalled()
    })

    it.each([
      [['--org', ORG], '--tenant'],
      [['--tenant', TENANT], '--org'],
      [['--tenant', 'not-a-uuid', '--org', ORG], '--tenant'],
      [['--tenant', TENANT, '--org', ORG, '--period', 'nope'], '--period'],
    ])('rejects invalid arguments %j without touching the command bus', async (argv, flag) => {
      await commandNamed('reconcile-cost-ring').run(argv)
      expect(mockExecute).not.toHaveBeenCalled()
      expect(errorOutput()).toContain(flag)
      expect(errorOutput()).toContain('Usage: yarn mercato posting_rules reconcile-cost-ring')
      expect(process.exitCode).toBe(1)
    })
  })

  describe('lock-fiscal-period', () => {
    it('runs posting_rules.lockFiscalPeriod through the command bus as a system actor', async () => {
      mockExecute.mockResolvedValue({
        result: { fiscalPeriodId: PERIOD, isLocked: true, updatedAt: '2026-10-20T10:00:00.000Z' },
        logEntry: null,
      })

      await commandNamed('lock-fiscal-period').run(['--tenant', TENANT, '--org', ORG, '--period', PERIOD])

      const [commandId, options] = mockExecute.mock.calls[0]
      expect(commandId).toBe('posting_rules.lockFiscalPeriod')
      expect(options.input).toEqual({ tenantId: TENANT, organizationId: ORG, periodId: PERIOD })
      expect(options.ctx).toMatchObject({ auth: null, selectedOrganizationId: ORG, systemActor: true })
      expect(logOutput()).toContain(`Fiscal period ${PERIOD} locked`)
      expect(process.exitCode).toBeUndefined()
    })

    it('exits non-zero and prints the offending lines when the guard refuses', async () => {
      mockExecute.mockRejectedValue(
        new CrudHttpError(422, {
          error: 'This fiscal period cannot be locked: 1 account class 4 lines have not yet been reclassified.',
          unreclassifiedEntryIds: ['entry-1'],
          unreclassifiedLines: [{ entryId: 'entry-1', lineId: 'line-1' }],
        }),
      )
      await commandNamed('lock-fiscal-period').run(['--tenant', TENANT, '--org', ORG, '--period', PERIOD])
      expect(errorOutput()).toContain('lock-fiscal-period failed (422)')
      expect(errorOutput()).toContain('"lineId": "line-1"')
      expect(process.exitCode).toBe(1)
    })

    it('requires --period', async () => {
      await commandNamed('lock-fiscal-period').run(['--tenant', TENANT, '--org', ORG])
      expect(mockExecute).not.toHaveBeenCalled()
      expect(errorOutput()).toContain('--period')
      expect(process.exitCode).toBe(1)
    })
  })
})
