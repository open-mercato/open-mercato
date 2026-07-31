/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import type { Edge } from '@xyflow/react'
import { appendWorkflowEdge } from '../graph-utils'

const edge = (overrides: Partial<Edge> & Pick<Edge, 'id' | 'source' | 'target'>): Edge => ({
  type: 'smoothstep',
  ...overrides,
})

describe('appendWorkflowEdge (#3169 addEdge replacement)', () => {
  test('appends a new edge as a new array', () => {
    const existing = [edge({ id: 'e1', source: 'a', target: 'b' })]
    const next = appendWorkflowEdge(existing, edge({ id: 'e2', source: 'b', target: 'c' }))
    expect(next).toHaveLength(2)
    expect(next).not.toBe(existing)
    expect(next.map((e) => e.id)).toEqual(['e1', 'e2'])
  })

  test('drops a duplicate connection (same source/target) without mutating', () => {
    const existing = [edge({ id: 'e1', source: 'a', target: 'b' })]
    const next = appendWorkflowEdge(existing, edge({ id: 'e2', source: 'a', target: 'b' }))
    expect(next).toBe(existing)
    expect(next).toHaveLength(1)
  })

  test('treats differing handles as distinct connections', () => {
    const existing = [edge({ id: 'e1', source: 'a', target: 'b', sourceHandle: 'out-1' })]
    const next = appendWorkflowEdge(existing, edge({ id: 'e2', source: 'a', target: 'b', sourceHandle: 'out-2' }))
    expect(next).toHaveLength(2)
  })

  test('treats empty-string and nullish handles as the same connection (matches addEdge)', () => {
    const existing = [edge({ id: 'e1', source: 'a', target: 'b', sourceHandle: '' })]
    const next = appendWorkflowEdge(existing, edge({ id: 'e2', source: 'a', target: 'b', sourceHandle: undefined }))
    expect(next).toBe(existing)
    expect(next).toHaveLength(1)
  })
})
