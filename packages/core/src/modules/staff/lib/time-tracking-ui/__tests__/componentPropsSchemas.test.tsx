/**
 * @jest-environment jsdom
 */
import { getComponentEntry } from '@open-mercato/shared/modules/widgets/component-registry'
import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { timeEntryDialogPropsSchema } from '../TimeEntryDialog'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

describe('exported time entry dialog props schema', () => {
  it('is the exact schema registered for the dialog handle', () => {
    const componentId = extensionPoints.hosts.timeEntryDialogComponent.componentId
    expect(typeof timeEntryDialogPropsSchema.safeParse).toBe('function')
    expect(getComponentEntry(componentId)?.metadata?.propsSchema).toBe(timeEntryDialogPropsSchema)
  })

  it('accepts minimal dialog props and rejects a non-function callback', () => {
    const onOpenChange = () => {}
    expect(timeEntryDialogPropsSchema.safeParse({ open: true, onOpenChange }).success).toBe(true)
    expect(timeEntryDialogPropsSchema.safeParse({ open: true, onOpenChange: 'nope' }).success).toBe(false)
  })

  it('treats an omitted optional callback as absent, not as a mismatch', () => {
    const onOpenChange = () => {}
    expect(timeEntryDialogPropsSchema.safeParse({ open: false, onOpenChange, onSaved: 'nope' }).success).toBe(false)
    expect(timeEntryDialogPropsSchema.safeParse({ open: false, onOpenChange, onSaved: () => {} }).success).toBe(true)
  })
})
