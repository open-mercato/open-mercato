import { loggedMinutes } from '../rollup'
import type { RollupEntry, RollupTask } from '../rollup'

const parent: RollupTask = { id: 'parent', parentTaskId: null }
const childA: RollupTask = { id: 'child-a', parentTaskId: 'parent' }
const childB: RollupTask = { id: 'child-b', parentTaskId: 'parent' }
const deletedChild: RollupTask = { id: 'child-deleted', parentTaskId: 'parent', deletedAt: new Date() }
const unrelated: RollupTask = { id: 'other', parentTaskId: null }

const entries: Record<string, RollupEntry[]> = {
  parent: [{ durationMinutes: 60 }, { durationMinutes: 30 }],
  'child-a': [{ durationMinutes: 45 }],
  'child-b': [{ durationMinutes: 15 }, { durationMinutes: 15 }],
  'child-deleted': [{ durationMinutes: 600 }],
  other: [{ durationMinutes: 999 }],
}

describe('loggedMinutes', () => {
  it('reports own minutes only for a parent with no children', () => {
    expect(loggedMinutes(parent, [parent, unrelated], entries)).toEqual({
      ownMinutes: 90,
      loggedMinutes: 90,
      childCount: 0,
    })
  })

  it('always includes child minutes in the parent rollup', () => {
    expect(loggedMinutes(parent, [parent, childA, childB, unrelated], entries)).toEqual({
      ownMinutes: 90,
      loggedMinutes: 165,
      childCount: 2,
    })
  })

  it('reports a child in isolation with only its own minutes', () => {
    expect(loggedMinutes(childA, [parent, childA, childB], entries)).toEqual({
      ownMinutes: 45,
      loggedMinutes: 45,
      childCount: 0,
    })
  })

  it('excludes soft-deleted children from the rollup and the count', () => {
    expect(loggedMinutes(parent, [parent, childA, deletedChild], entries)).toEqual({
      ownMinutes: 90,
      loggedMinutes: 135,
      childCount: 1,
    })
  })

  it('excludes soft-deleted entries', () => {
    const withDeletedEntry = {
      parent: [{ durationMinutes: 60 }, { durationMinutes: 30, deletedAt: new Date() }],
    }
    expect(loggedMinutes(parent, [parent], withDeletedEntry)).toEqual({
      ownMinutes: 60,
      loggedMinutes: 60,
      childCount: 0,
    })
  })

  it('treats a task with no entries as zero rather than undefined', () => {
    expect(loggedMinutes({ id: 'empty' }, [], {})).toEqual({
      ownMinutes: 0,
      loggedMinutes: 0,
      childCount: 0,
    })
  })

  it('ignores null and missing durations', () => {
    const sparse = { parent: [{ durationMinutes: null }, {}, { durationMinutes: 25 }] }
    expect(loggedMinutes(parent, [parent], sparse).ownMinutes).toBe(25)
  })

  it('accepts a Map of entries as well as a record', () => {
    const map = new Map<string, RollupEntry[]>([
      ['parent', [{ durationMinutes: 90 }]],
      ['child-a', [{ durationMinutes: 45 }]],
    ])
    expect(loggedMinutes(parent, [parent, childA], map)).toEqual({
      ownMinutes: 90,
      loggedMinutes: 135,
      childCount: 1,
    })
  })

  it('never counts an unrelated task', () => {
    const rollup = loggedMinutes(parent, [parent, childA, unrelated], entries)
    expect(rollup.loggedMinutes).toBe(135)
  })
})
