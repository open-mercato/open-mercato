import { runBestEffortProvisioningStep } from '@open-mercato/onboarding/modules/onboarding/lib/provisioning'

function makeLogger() {
  return { error: jest.fn() }
}

describe('runBestEffortProvisioningStep', () => {
  it('returns ok and does not log when the step succeeds', async () => {
    const logger = makeLogger()
    const run = jest.fn().mockResolvedValue(undefined)

    const result = await runBestEffortProvisioningStep('marketing-consent', run, logger)

    expect(result).toEqual({ ok: true })
    expect(run).toHaveBeenCalledTimes(1)
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('swallows a thrown error, logs it, and reports failure instead of re-throwing', async () => {
    const logger = makeLogger()
    const failure = new Error('boom')

    const result = await runBestEffortProvisioningStep(
      'seedDefaults:catalog',
      () => Promise.reject(failure),
      logger,
    )

    expect(result).toEqual({ ok: false, error: failure })
    expect(logger.error).toHaveBeenCalledWith(
      '[onboarding.verify] non-fatal provisioning step failed',
      { step: 'seedDefaults:catalog', error: failure },
    )
  })

  it('keeps provisioning alive when one module hook throws or times out (issue #2951)', async () => {
    // Regression for #2951: a single seedDefaults hook that throws (or exceeds
    // its timeout) must not abort the loop or strand the freshly provisioned
    // workspace. Every module still runs and the sequence resolves so the
    // verify handler can reach markCompleted.
    const logger = makeLogger()
    const ran: string[] = []
    const hooks: Record<string, () => Promise<void>> = {
      auth: async () => { ran.push('auth') },
      catalog: async () => { ran.push('catalog'); throw new Error('seed failed') },
      sales: async () => { ran.push('sales') },
    }

    const results = []
    for (const moduleId of Object.keys(hooks)) {
      results.push(
        await runBestEffortProvisioningStep(`seedDefaults:${moduleId}`, hooks[moduleId], logger),
      )
    }

    expect(ran).toEqual(['auth', 'catalog', 'sales'])
    expect(results.map((r) => r.ok)).toEqual([true, false, true])
    expect(logger.error).toHaveBeenCalledTimes(1)
  })
})
