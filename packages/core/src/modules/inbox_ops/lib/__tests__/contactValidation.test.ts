/** @jest-environment node */

import { splitPersonName, hasContactNameIssue } from '../contactValidation'

describe('splitPersonName', () => {
  it('splits two-part name', () => {
    expect(splitPersonName('John Doe')).toEqual({ firstName: 'John', lastName: 'Doe' })
  })

  it('splits three-part name', () => {
    expect(splitPersonName('Mary Jane Watson')).toEqual({ firstName: 'Mary', lastName: 'Jane Watson' })
  })

  it('returns empty lastName for single name', () => {
    expect(splitPersonName('John')).toEqual({ firstName: 'John', lastName: '' })
  })

  it('returns empty strings for empty input', () => {
    expect(splitPersonName('')).toEqual({ firstName: '', lastName: '' })
  })

  it('derives name from email when name is single word', () => {
    expect(splitPersonName('John', 'john.doe@example.com')).toEqual({ firstName: 'John', lastName: 'Doe' })
  })

  it('derives name from email with underscore separator', () => {
    expect(splitPersonName('info', 'jane_smith@company.com')).toEqual({ firstName: 'Jane', lastName: 'Smith' })
  })

  it('derives name from email with dash separator', () => {
    expect(splitPersonName('x', 'm-johnson@corp.net')).toEqual({ firstName: 'M', lastName: 'Johnson' })
  })

  it('returns single name when email has no separator', () => {
    expect(splitPersonName('info', 'info@company.com')).toEqual({ firstName: 'info', lastName: '' })
  })

  it('ignores email when name already has 2+ parts', () => {
    expect(splitPersonName('John Doe', 'jane.smith@example.com')).toEqual({ firstName: 'John', lastName: 'Doe' })
  })

  it('handles whitespace-padded input', () => {
    expect(splitPersonName('  John   Doe  ')).toEqual({ firstName: 'John', lastName: 'Doe' })
  })
})

describe('hasContactNameIssue', () => {
  it('returns true for person with single-word name', () => {
    expect(hasContactNameIssue({ actionType: 'create_contact', payload: { type: 'person', name: 'John' } })).toBe(true)
  })

  it('returns false for person with full name', () => {
    expect(hasContactNameIssue({ actionType: 'create_contact', payload: { type: 'person', name: 'John Doe' } })).toBe(false)
  })

  it('returns false for company type', () => {
    expect(hasContactNameIssue({ actionType: 'create_contact', payload: { type: 'company', name: 'Acme' } })).toBe(false)
  })

  it('returns false for non-contact action types', () => {
    expect(hasContactNameIssue({ actionType: 'create_order', payload: { name: 'x' } })).toBe(false)
  })

  it('returns true for empty name', () => {
    expect(hasContactNameIssue({ actionType: 'create_contact', payload: { type: 'person', name: '' } })).toBe(true)
  })

  it('defaults type to person when missing', () => {
    expect(hasContactNameIssue({ actionType: 'create_contact', payload: { name: 'SingleName' } })).toBe(true)
  })
})
