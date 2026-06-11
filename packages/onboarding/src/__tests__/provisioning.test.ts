import { runBestEffortProvisioningStep } from '@open-mercato/onboarding/modules/onboarding/lib/provisioning'

function makeLogger() {
  return { error: jest.fn(), info: jest.fn() }
}

function uniqueViolation(message: string): Error {
  return Object.assign(new Error(message), {
    code: '23505',
    constraint: 'catalog_products_handle_scope_unique',
  })
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

  it('logs an expected unique-constraint collision at info, not error', async () => {
    // A concurrent verify / re-verify re-applies a seed against rows that
    // already exist. seed hooks are not fully idempotent, so the duplicate-key
    // collision is expected and harmless — it must not surface as an error and
    // bury genuine failures (maintainer feedback on PR #2954).
    const logger = makeLogger()
    const failure = uniqueViolation('duplicate key value violates unique constraint')

    const result = await runBestEffortProvisioningStep(
      'seedExamples:catalog',
      () => Promise.reject(failure),
      logger,
    )

    expect(result).toEqual({ ok: false, error: failure })
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      '[onboarding.verify] non-fatal provisioning step skipped (already applied)',
      { step: 'seedExamples:catalog' },
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
