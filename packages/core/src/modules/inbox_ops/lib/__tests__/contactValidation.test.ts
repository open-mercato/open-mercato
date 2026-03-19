/** @jest-environment node */

import { splitPersonName, hasContactNameIssue, stripTitleFromName } from '../contactValidation'

describe('stripTitleFromName', () => {
  it('strips Polish academic title "mgr"', () => {
    expect(stripTitleFromName('mgr Katarzyna Lewandowska')).toEqual({
      cleanedName: 'Katarzyna Lewandowska',
      title: 'mgr',
    })
  })

  it('strips "Dr." with period', () => {
    expect(stripTitleFromName('Dr. John Smith')).toEqual({
      cleanedName: 'John Smith',
      title: 'Dr.',
    })
  })

  it('strips "Prof" without period', () => {
    expect(stripTitleFromName('Prof Maria Garcia')).toEqual({
      cleanedName: 'Maria Garcia',
      title: 'Prof',
    })
  })

  it('strips Polish engineering title "inż"', () => {
    expect(stripTitleFromName('inż Jan Kowalski')).toEqual({
      cleanedName: 'Jan Kowalski',
      title: 'inż',
    })
  })

  it('does not strip non-title words', () => {
    expect(stripTitleFromName('Katarzyna Lewandowska')).toEqual({
      cleanedName: 'Katarzyna Lewandowska',
      title: null,
    })
  })

  it('does not strip from single-word names', () => {
    expect(stripTitleFromName('mgr')).toEqual({
      cleanedName: 'mgr',
      title: null,
    })
  })

  it('is case-insensitive', () => {
    expect(stripTitleFromName('MR John Doe')).toEqual({
      cleanedName: 'John Doe',
      title: 'MR',
    })
  })
})

describe('splitPersonName', () => {
  it('splits two-part name', () => {
    expect(splitPersonName('John Doe')).toEqual({ firstName: 'John', lastName: 'Doe' })
  })

  it('splits three-part name', () => {
    expect(splitPersonName('Mary Jane Watson')).toEqual({ firstName: 'Mary', lastName: 'Jane Watson' })
  })

  it('strips title before splitting', () => {
    expect(splitPersonName('mgr Katarzyna Lewandowska')).toEqual({
      firstName: 'Katarzyna',
      lastName: 'Lewandowska',
    })
  })

  it('strips Dr. title before splitting', () => {
    expect(splitPersonName('Dr. Anna Nowak')).toEqual({
      firstName: 'Anna',
      lastName: 'Nowak',
    })
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

  it('returns true when name is only a title + single word (e.g. "mgr Smith")', () => {
    expect(hasContactNameIssue({ actionType: 'create_contact', payload: { type: 'person', name: 'mgr Smith' } })).toBe(true)
  })

  it('returns false when name has title + first + last (e.g. "mgr Jan Kowalski")', () => {
    expect(hasContactNameIssue({ actionType: 'create_contact', payload: { type: 'person', name: 'mgr Jan Kowalski' } })).toBe(false)
  })
})
