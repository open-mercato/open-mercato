import { BigIntType, MetadataStorage } from '@mikro-orm/core'
import { AgentRun, ProcessInstance } from '../data/entities'

/**
 * `AgentRun.costMinor` / `ProcessInstance.costMinor` / `ProcessInstance.subjectValueMinor`
 * are declared as TypeScript `number`, but the underlying column is `bigint`. MikroORM's
 * `BigIntType` defaults to hydrating as a native JS `bigint`, which then silently fails any
 * `typeof value === 'number'` guard downstream (e.g. `metricRollupService.ts`'s cost
 * aggregation reads a real cost as `0`). Each property MUST be configured with the
 * `BigIntType('number')` numeric mode so hydration matches its declared type. See #6237.
 */
describe('agent_orchestrator bigint-backed number fields', () => {
  // Importing the module runs its @Entity decorators, which populate MetadataStorage.
  void AgentRun
  void ProcessInstance

  function bigIntModeOf(className: string, propertyName: string): string | undefined {
    const meta = Object.values(MetadataStorage.getMetadata()).find(
      (candidate) => candidate.className === className,
    )
    const type = meta?.properties[propertyName]?.type
    expect(type).toBeInstanceOf(BigIntType)
    return (type as InstanceType<typeof BigIntType>).mode
  }

  it('hydrates AgentRun.costMinor as a safe-integer number, not a bigint', () => {
    expect(bigIntModeOf('AgentRun', 'costMinor')).toBe('number')
  })

  it('hydrates ProcessInstance.costMinor as a safe-integer number, not a bigint', () => {
    expect(bigIntModeOf('ProcessInstance', 'costMinor')).toBe('number')
  })

  it('hydrates ProcessInstance.subjectValueMinor as a safe-integer number, not a bigint', () => {
    expect(bigIntModeOf('ProcessInstance', 'subjectValueMinor')).toBe('number')
  })

  it('converts a DB-returned bigint string to a real JS number that JSON-serializes correctly', () => {
    const type = new BigIntType('number')
    const hydrated = type.convertToJSValue('4200')
    expect(typeof hydrated).toBe('number')
    expect(hydrated).toBe(4200)
    expect(() => JSON.stringify({ costMinor: hydrated })).not.toThrow()
    expect(JSON.stringify({ costMinor: hydrated })).toBe('{"costMinor":4200}')
  })
})
