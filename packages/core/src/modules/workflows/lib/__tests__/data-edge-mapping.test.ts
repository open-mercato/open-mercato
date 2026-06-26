/**
 * Data-edge field mapping (Phase 6) — pure helper tests.
 */

import { describe, test, expect } from '@jest/globals'
import type { Connection, Edge, Node } from '@xyflow/react'
import {
  classifyConnection,
  applyInputMappingToNodes,
  buildDataMappingEdge,
  dataMappingEdgeId,
  isDataMappingEdge,
  DATA_MAPPING_EDGE_TYPE,
} from '../data-edge-mapping'

const conn = (overrides: Partial<Connection>): Connection => ({
  source: 'a',
  target: 'b',
  sourceHandle: null,
  targetHandle: null,
  ...overrides,
})

describe('classifyConnection', () => {
  test('port→IN port is a data mapping; parent path is the OUT port name', () => {
    const result = classifyConnection(conn({ source: 'score', sourceHandle: 'out:decision', target: 'apply', targetHandle: 'in:claimId' }))
    expect(result).toEqual({ kind: 'data-mapping', targetNodeId: 'apply', childPortKey: 'claimId', parentPath: 'decision' })
  })

  test('generic source → IN port falls back to the source node id', () => {
    const result = classifyConnection(conn({ source: 'trigger', sourceHandle: 'source', target: 'apply', targetHandle: 'in:amount' }))
    expect(result).toEqual({ kind: 'data-mapping', targetNodeId: 'apply', childPortKey: 'amount', parentPath: 'trigger' })
  })

  test('plain control handles stay a transition', () => {
    expect(classifyConnection(conn({ sourceHandle: 'source', targetHandle: 'target' }))).toEqual({ kind: 'control' })
    expect(classifyConnection(conn({ sourceHandle: null, targetHandle: null }))).toEqual({ kind: 'control' })
  })

  test('OUT port dragged onto a non-port target is ignored (no bogus transition)', () => {
    expect(classifyConnection(conn({ sourceHandle: 'out:decision', targetHandle: 'target' }))).toEqual({ kind: 'data-ignored' })
  })
})

describe('applyInputMappingToNodes', () => {
  const nodes: Node[] = [
    { id: 'apply', position: { x: 0, y: 0 }, data: { config: { subWorkflowId: 'apply-discount' } } },
    { id: 'other', position: { x: 0, y: 0 }, data: {} },
  ]

  test('writes config.inputMapping on the target node and leaves others untouched', () => {
    const updated = applyInputMappingToNodes(nodes, 'apply', 'claimId', 'decision')
    expect((updated.find((n) => n.id === 'apply')!.data as any).config.inputMapping).toEqual({ claimId: 'decision' })
    expect((updated.find((n) => n.id === 'apply')!.data as any).config.subWorkflowId).toBe('apply-discount')
    expect(updated.find((n) => n.id === 'other')!.data).toEqual({})
  })

  test('merges with an existing inputMapping', () => {
    const seeded = applyInputMappingToNodes(nodes, 'apply', 'claimId', 'decision')
    const merged = applyInputMappingToNodes(seeded, 'apply', 'amount', 'total')
    expect((merged.find((n) => n.id === 'apply')!.data as any).config.inputMapping).toEqual({ claimId: 'decision', amount: 'total' })
  })

  test('round-trip parity: drag output equals the key/value form shape', () => {
    // The form persists config.inputMapping as { childKey: parentPath }.
    const formShape = { claimId: 'decision' }
    const updated = applyInputMappingToNodes(nodes, 'apply', 'claimId', 'decision')
    expect((updated.find((n) => n.id === 'apply')!.data as any).config.inputMapping).toEqual(formShape)
  })
})

describe('buildDataMappingEdge / isDataMappingEdge', () => {
  test('builds a typed data edge with a stable per-port id', () => {
    const edge = buildDataMappingEdge(conn({ source: 'score', sourceHandle: 'out:decision', target: 'apply', targetHandle: 'in:claimId' }), 'claimId')
    expect(edge.id).toBe(dataMappingEdgeId('apply', 'claimId'))
    expect(edge.type).toBe(DATA_MAPPING_EDGE_TYPE)
    expect(edge.source).toBe('score')
    expect(edge.target).toBe('apply')
  })

  test('isDataMappingEdge distinguishes data edges from transitions', () => {
    expect(isDataMappingEdge({ type: DATA_MAPPING_EDGE_TYPE } as Edge)).toBe(true)
    expect(isDataMappingEdge({ type: 'workflowTransition' } as Edge)).toBe(false)
    expect(isDataMappingEdge({ type: 'smoothstep' } as Edge)).toBe(false)
  })
})
