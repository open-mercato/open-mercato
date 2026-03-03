import { describe, expect, test } from '@jest/globals'
import {
  decisionSupersedeSchema,
  runRerouteSchema,
} from '../validators'

describe('agent governance validators', () => {
  test('runRerouteSchema requires at least one reroute target', () => {
    expect(() =>
      runRerouteSchema.parse({
        id: 'f7f8793f-16f5-44fd-8225-8f4d03f5f90e',
      }),
    ).toThrow()
  })

  test('runRerouteSchema accepts policy reroute payload', () => {
    const parsed = runRerouteSchema.parse({
      id: 'f7f8793f-16f5-44fd-8225-8f4d03f5f90e',
      policyId: '3d454f84-88c8-4e81-b5bb-b04f311afec3',
      reason: 'Switch to stricter policy',
    })
    expect(parsed.policyId).toBe('3d454f84-88c8-4e81-b5bb-b04f311afec3')
  })

  test('decisionSupersedeSchema accepts correction payload', () => {
    const parsed = decisionSupersedeSchema.parse({
      id: '1f2adb9d-4106-4db7-9adf-ef9f81fca55a',
      sourceRefs: ['ticket:123'],
      writeSet: { correctedField: 'value' },
      status: 'success',
      note: 'manual correction',
    })
    expect(parsed.id).toBe('1f2adb9d-4106-4db7-9adf-ef9f81fca55a')
    expect(parsed.status).toBe('success')
  })
})
