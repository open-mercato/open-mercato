import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import english from '../../i18n/en.json'
import { auditChangeSummary, auditExecutionState, auditRecordName } from '../rowPresentation'

const translate: TranslateFn = (key, fallbackOrParams) => {
  const value = (english as Record<string, string>)[key] ?? key
  const params = typeof fallbackOrParams === 'object' ? fallbackOrParams : {}
  return value.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
}

describe('audit row identification', () => {
  it('prefers the after snapshot name and supports the directory before-view wrapper', () => {
    expect(auditRecordName({ snapshotAfter: { name: 'New name' }, snapshotBefore: { view: { name: 'Old name' } } })).toBe('New name')
    expect(auditRecordName({ snapshotBefore: { view: { name: 'Deleted organization' } } })).toBe('Deleted organization')
  })

  it('does not search unrelated payloads and leaves unavailable names to the ID fallback', () => {
    expect(auditRecordName({ snapshotAfter: { context: { name: 'Wrong record' }, undo: { name: 'Secret' } } })).toBeUndefined()
    expect(auditRecordName({ snapshotAfter: { name: 'iv:tag:cipher:v1' } })).toBeUndefined()
    expect(auditRecordName({ snapshotAfter: 'iv:tag:cipher:v1' })).toBeUndefined()
    expect(auditRecordName({ snapshotAfter: { name: ' iv:tag:cipher:v1 \n' } })).toBeUndefined()
    expect(auditRecordName({ snapshotAfter: { name: '  ' }, snapshotBefore: { name: 'Before' } })).toBe('Before')
  })

  it('bounds names and collapses multiline text without interpreting markup', () => {
    expect(auditRecordName({ snapshotAfter: { name: '<b>Name</b>\n with\tspaces' } })).toBe('<b>Name</b> with spaces')
    expect(auditRecordName({ snapshotAfter: { name: 'x'.repeat(200) } })).toHaveLength(120)
  })

  it('summarizes a name change and deterministically counts additional fields', () => {
    expect(auditChangeSummary({ changes: {
      password: { from: 'secret-before', to: 'secret-after' },
      status: { from: 'open', to: 'closed' },
      name: { from: 'A', to: 'B' },
    } }, translate)).toBe('Name: A → B (+2)')
  })

  it('preserves explicit null parent changes and distinguishes missing values', () => {
    expect(auditChangeSummary({ resourceKind: 'directory.organization', changes: { parentId: { from: 'parent-id', to: null } } }, translate)).toBe('Parent organization: parent-id → (root level)')
    expect(auditChangeSummary({ resourceKind: 'directory.organization', snapshotBefore: { view: { parentId: 'wrong-fallback' } }, changes: { parentId: { from: null, to: 'parent-id' } } }, translate)).toBe('Parent organization: (root level) → parent-id')
    expect(auditChangeSummary({ changes: { parentId: { to: 'parent-id' } } }, translate)).toBe('Changed fields: 1')
  })

  it('uses a generic parent label outside directory organizations', () => {
    expect(auditChangeSummary({ resourceKind: 'catalog.category', changes: { parentId: { from: 'category-id', to: null } } }, translate)).toBe('Parent: category-id → (root level)')
  })

  it('supports legacy values and old/new changes, including false, zero and null', () => {
    expect(auditChangeSummary({ snapshotBefore: { view: { isActive: true } }, changes: { isActive: false } }, translate)).toBe('Active: Yes → No')
    expect(auditChangeSummary({ changes: { status: { old: 0, new: 1 } } }, translate)).toBe('Status: 0 → 1')
    expect(auditChangeSummary({ changes: { name: { old: 'A', new: null } } }, translate)).toBe('Name: A → —')
  })

  it.each([
    { password: { from: 'secret', to: 'secret-new' } },
    { 'credentials.name': { from: 'secret', to: 'secret-new' } },
    { name: { from: 'iv:tag:cipher:v1', to: 'plain' } },
    { name: { from: 'plain', to: 'iv:tag:cipher:v1' } },
    { name: { from: { token: 'secret' }, to: ['secret'] } },
  ])('does not preview sensitive, encrypted or complex values: %j', (changes) => {
    expect(auditChangeSummary({ changes }, translate)).toBe('Changed fields: 1')
  })

  it('handles missing or malformed changes without rendering their contents', () => {
    expect(auditChangeSummary({}, translate)).toBe('No tracked field changes')
    expect(auditChangeSummary({ changes: {} }, translate)).toBe('No tracked field changes')
  })

  it.each(['done', 'undone', 'failed', 'redone'])('localizes state %s', (state) => {
    expect(auditExecutionState(state, translate)).toBe(translate(`audit_logs.version_history.status.${state}`))
  })

  it('preserves unknown execution states', () => {
    expect(auditExecutionState('future-state', translate)).toBe('future-state')
  })
})
