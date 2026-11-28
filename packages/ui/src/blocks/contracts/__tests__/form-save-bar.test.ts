import { formSaveBarPropsSchema } from '../form-save-bar'

const noop = () => undefined
const base = { saveState: 'dirty', onSave: noop }

describe('FormSaveBar contract', () => {
  it('accepts a bar driven by onSave', () => {
    expect(formSaveBarPropsSchema.safeParse(base).success).toBe(true)
  })

  it('accepts a bar wired to a form by id', () => {
    expect(formSaveBarPropsSchema.safeParse({ saveState: 'dirty', formId: 'customer-form' }).success).toBe(true)
  })

  it('accepts a full bar', () => {
    const result = formSaveBarPropsSchema.safeParse({
      saveState: 'saved',
      message: 'Draft stored',
      savedAt: '2026-03-12T10:15:00Z',
      formId: 'customer-form',
      onSave: noop,
      saveLabel: 'Save customer',
      resetLabel: 'Discard',
      saveDisabledReason: 'Fill in the required fields first',
      onReset: noop,
      actions: [
        { key: 'duplicate', label: 'Save as copy' },
        { key: 'delete', label: 'Delete', tone: 'destructive' },
      ],
      onAction: noop,
      placement: 'container',
      alwaysVisible: true,
    })
    expect(result.success).toBe(true)
  })

  it('requires saveState and rejects unknown states', () => {
    expect(formSaveBarPropsSchema.safeParse({ onSave: noop }).success).toBe(false)
    expect(formSaveBarPropsSchema.safeParse({ saveState: 'conflict', onSave: noop }).success).toBe(false)
  })

  it('rejects a bar with neither formId nor onSave', () => {
    const result = formSaveBarPropsSchema.safeParse({ saveState: 'dirty' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('formId or onSave is required')
      expect(result.error.issues[0]?.path).toEqual(['onSave'])
    }
  })

  it('rejects actions without onAction', () => {
    const result = formSaveBarPropsSchema.safeParse({ ...base, actions: [{ key: 'duplicate', label: 'Save as copy' }] })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['onAction'])
  })

  it('rejects duplicate action keys', () => {
    const result = formSaveBarPropsSchema.safeParse({
      ...base,
      actions: [
        { key: 'duplicate', label: 'Save as copy' },
        { key: 'duplicate', label: 'Save as copy again' },
      ],
      onAction: noop,
    })
    expect(result.success).toBe(false)
  })

  it('rejects a savedAt that is not an ISO datetime', () => {
    expect(formSaveBarPropsSchema.safeParse({ ...base, savedAt: 'yesterday' }).success).toBe(false)
  })

  it('rejects an unknown placement and empty labels', () => {
    expect(formSaveBarPropsSchema.safeParse({ ...base, placement: 'top' }).success).toBe(false)
    expect(formSaveBarPropsSchema.safeParse({ ...base, saveLabel: '' }).success).toBe(false)
    expect(formSaveBarPropsSchema.safeParse({ ...base, message: '' }).success).toBe(false)
  })

  it('accepts an optional return focus target getter and rejects a non-function', () => {
    expect(formSaveBarPropsSchema.safeParse({ ...base, getReturnFocusTarget: () => null }).success).toBe(true)
    expect(formSaveBarPropsSchema.safeParse({ ...base, getReturnFocusTarget: 'title' }).success).toBe(false)
  })
})
