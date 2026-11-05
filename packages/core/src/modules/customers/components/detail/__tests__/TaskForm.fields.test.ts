jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => null,
}))

import { buildTaskFormFields, buildTaskFormGroups } from '../TaskForm'

const t = (key: string, fallback?: string) => fallback ?? key
const statusOptions = [
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
]

const fieldIds = (canonical: boolean) =>
  buildTaskFormFields({ useCanonicalInteractions: canonical, statusOptions, t }).map((field) => field.id)

const statusGroupFields = (canonical: boolean) =>
  buildTaskFormGroups({ useCanonicalInteractions: canonical, t }).find((group) => group.id === 'status')?.fields

describe('TaskForm field model — interaction-mode gating', () => {
  it('renders the dictionary-backed status select on the canonical path', () => {
    const fields = buildTaskFormFields({ useCanonicalInteractions: true, statusOptions, t })
    const status = fields.find((field) => field.id === 'status')
    // Canonical status uses a custom renderer (TaskStatusSelect) so each option can surface its
    // dictionary appearance (icon + color); CrudForm's generic `select` only renders label text.
    expect(status).toMatchObject({ id: 'status', type: 'custom' })
    expect(typeof (status as { component?: unknown }).component).toBe('function')
    expect(fieldIds(true)).not.toContain('is_done')
    expect(statusGroupFields(true)).toEqual(['priority', 'status'])
  })

  it('renders the legacy done checkbox instead of the picker on the legacy path', () => {
    const fields = buildTaskFormFields({ useCanonicalInteractions: false, statusOptions, t })
    const done = fields.find((field) => field.id === 'is_done')
    expect(done).toMatchObject({ type: 'checkbox' })
    expect(fieldIds(false)).not.toContain('status')
    expect(statusGroupFields(false)).toEqual(['priority', 'is_done'])
  })
})
