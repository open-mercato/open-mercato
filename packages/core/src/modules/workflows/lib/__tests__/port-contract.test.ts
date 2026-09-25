/**
 * Port Contract Validation Tests (Sub-workflow Explicit Ports)
 */

import { describe, test, expect } from '@jest/globals'
import { validateAgainstPorts } from '../port-contract'
import type { PortField } from '../../data/validators'

const port = (overrides: Partial<PortField> & Pick<PortField, 'name' | 'type'>): PortField => ({
  label: overrides.name,
  required: false,
  ...overrides,
})

describe('validateAgainstPorts', () => {
  describe('coercion per type', () => {
    test('text coerces to string', () => {
      const { coerced, errors } = validateAgainstPorts({ a: 123 }, [port({ name: 'a', type: 'text' })])
      expect(errors).toEqual([])
      expect(coerced.a).toBe('123')
    })

    test('number accepts numeric strings, rejects non-numbers', () => {
      const ok = validateAgainstPorts({ n: '42' }, [port({ name: 'n', type: 'number' })])
      expect(ok.errors).toEqual([])
      expect(ok.coerced.n).toBe(42)

      const bad = validateAgainstPorts({ n: 'abc' }, [port({ name: 'n', type: 'number' })])
      expect(bad.errors).toHaveLength(1)
      expect(bad.errors[0].port).toBe('n')
    })

    test('boolean parses tokens and native booleans, rejects unknown', () => {
      expect(validateAgainstPorts({ b: 'yes' }, [port({ name: 'b', type: 'boolean' })]).coerced.b).toBe(true)
      expect(validateAgainstPorts({ b: false }, [port({ name: 'b', type: 'boolean' })]).coerced.b).toBe(false)
      const bad = validateAgainstPorts({ b: 'maybe' }, [port({ name: 'b', type: 'boolean' })])
      expect(bad.errors).toHaveLength(1)
    })

    test('select enforces options when provided', () => {
      const ports = [port({ name: 's', type: 'select', options: ['low', 'high'] })]
      expect(validateAgainstPorts({ s: 'high' }, ports).errors).toEqual([])
      const bad = validateAgainstPorts({ s: 'mid' }, ports)
      expect(bad.errors).toHaveLength(1)
      expect(bad.errors[0].message).toContain('one of')
    })

    test('date coerces to ISO string, rejects invalid', () => {
      const ok = validateAgainstPorts({ d: '2026-01-08T12:00:00Z' }, [port({ name: 'd', type: 'date' })])
      expect(ok.errors).toEqual([])
      expect(ok.coerced.d).toBe('2026-01-08T12:00:00.000Z')
      expect(validateAgainstPorts({ d: 'not-a-date' }, [port({ name: 'd', type: 'date' })]).errors).toHaveLength(1)
    })
  })

  describe('required + passthrough', () => {
    test('missing required port is an error', () => {
      const { errors } = validateAgainstPorts({}, [port({ name: 'x', type: 'text', required: true })])
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('Required port')
    })

    test('missing optional port is skipped, not an error', () => {
      const { coerced, errors } = validateAgainstPorts({}, [port({ name: 'x', type: 'text' })])
      expect(errors).toEqual([])
      expect(coerced).not.toHaveProperty('x')
    })

    test('keys not covered by a port pass through unchanged', () => {
      const { coerced, errors } = validateAgainstPorts(
        { declared: '5', extra: { keep: true } },
        [port({ name: 'declared', type: 'number' })],
      )
      expect(errors).toEqual([])
      expect(coerced.declared).toBe(5)
      expect(coerced.extra).toEqual({ keep: true })
    })

    test('empty-string and null count as absent', () => {
      const ports = [port({ name: 'x', type: 'text', required: true })]
      expect(validateAgainstPorts({ x: '' }, ports).errors).toHaveLength(1)
      expect(validateAgainstPorts({ x: null }, ports).errors).toHaveLength(1)
    })
  })
})
