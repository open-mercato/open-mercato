import {
  assertSingleInstanceStrategies,
  evaluateSingleInstanceGuard,
  SingleInstanceStrategyError,
  type InfraStrategySnapshot,
} from '../single-instance-strategy-guard'

const singleInstanceSnapshot: InfraStrategySnapshot = {
  cacheStrategy: 'memory',
  queueStrategy: 'local',
  rateLimitStrategy: 'memory',
}

const multiInstanceSafeSnapshot: InfraStrategySnapshot = {
  cacheStrategy: 'redis',
  queueStrategy: 'async',
  rateLimitStrategy: 'redis',
}

describe('evaluateSingleInstanceGuard', () => {
  it('is a no-op outside production even with single-instance strategies', () => {
    const result = evaluateSingleInstanceGuard(singleInstanceSnapshot, {
      NODE_ENV: 'development',
      OM_MULTI_INSTANCE: '1',
    })
    expect(result.action).toBe('ok')
    expect(result.offenders).toHaveLength(3)
  })

  it('is a no-op in production when all strategies are multi-instance safe', () => {
    const result = evaluateSingleInstanceGuard(multiInstanceSafeSnapshot, {
      NODE_ENV: 'production',
      OM_MULTI_INSTANCE: '1',
    })
    expect(result.action).toBe('ok')
    expect(result.offenders).toHaveLength(0)
  })

  it('fails in production when a multi-instance topology is declared via OM_MULTI_INSTANCE', () => {
    const result = evaluateSingleInstanceGuard(singleInstanceSnapshot, {
      NODE_ENV: 'production',
      OM_MULTI_INSTANCE: '1',
    })
    expect(result.action).toBe('fail')
    expect(result.offenders.map((offender) => offender.envVar)).toEqual([
      'CACHE_STRATEGY',
      'QUEUE_STRATEGY',
      'RATE_LIMIT_STRATEGY',
    ])
  })

  it('treats OM_INSTANCE_COUNT > 1 as a multi-instance topology', () => {
    const result = evaluateSingleInstanceGuard(singleInstanceSnapshot, {
      NODE_ENV: 'production',
      OM_INSTANCE_COUNT: '3',
    })
    expect(result.action).toBe('fail')
  })

  it('does not treat OM_INSTANCE_COUNT=1 as multi-instance', () => {
    const result = evaluateSingleInstanceGuard(singleInstanceSnapshot, {
      NODE_ENV: 'production',
      OM_INSTANCE_COUNT: '1',
    })
    expect(result.action).toBe('warn')
  })

  it('only warns in production when no multi-instance topology is declared', () => {
    const result = evaluateSingleInstanceGuard(singleInstanceSnapshot, {
      NODE_ENV: 'production',
    })
    expect(result.action).toBe('warn')
    expect(result.multiInstance).toBe(false)
  })

  it('downgrades a hard failure to a warning when the override is set', () => {
    const result = evaluateSingleInstanceGuard(singleInstanceSnapshot, {
      NODE_ENV: 'production',
      OM_MULTI_INSTANCE: '1',
      OM_ALLOW_SINGLE_INSTANCE_STRATEGIES: '1',
    })
    expect(result.action).toBe('warn')
    expect(result.overridden).toBe(true)
  })

  it('flags only the offending strategy when others are safe', () => {
    const result = evaluateSingleInstanceGuard(
      { cacheStrategy: 'redis', queueStrategy: 'local', rateLimitStrategy: 'redis' },
      { NODE_ENV: 'production', OM_MULTI_INSTANCE: '1' },
    )
    expect(result.action).toBe('fail')
    expect(result.offenders).toHaveLength(1)
    expect(result.offenders[0].component).toBe('queue')
  })
})

describe('assertSingleInstanceStrategies', () => {
  function createLogger() {
    return {
      warn: jest.fn(),
      error: jest.fn(),
    }
  }

  it('throws and logs when the guard fails', () => {
    const logger = createLogger()
    expect(() =>
      assertSingleInstanceStrategies(
        { NODE_ENV: 'production', OM_MULTI_INSTANCE: '1' },
        { snapshot: singleInstanceSnapshot, logger },
      ),
    ).toThrow(SingleInstanceStrategyError)
    expect(logger.error).toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('logs a warning but does not throw when only warning', () => {
    const logger = createLogger()
    const result = assertSingleInstanceStrategies(
      { NODE_ENV: 'production' },
      { snapshot: singleInstanceSnapshot, logger },
    )
    expect(result.action).toBe('warn')
    expect(logger.warn).toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('stays silent and does not throw when everything is safe', () => {
    const logger = createLogger()
    const result = assertSingleInstanceStrategies(
      { NODE_ENV: 'production', OM_MULTI_INSTANCE: '1' },
      { snapshot: multiInstanceSafeSnapshot, logger },
    )
    expect(result.action).toBe('ok')
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })
})
