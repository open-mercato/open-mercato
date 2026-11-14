import {
  clearPrivacyDataClasses,
  getPrivacyDataClass,
  listPrivacyDataClasses,
  registerPrivacyDataClass,
} from '../registry'

describe('privacy data class registry', () => {
  beforeEach(() => clearPrivacyDataClasses())

  afterAll(() => clearPrivacyDataClasses())

  it('registers definitions in stable order and replaces the same id', () => {
    registerPrivacyDataClass({
      id: 'customers.people',
      module: 'customers',
      title: 'People',
      handlerService: 'customerPeoplePrivacyHandler',
      subjectKinds: ['customers:person', 'customers:person'],
      subjectIdentifierKinds: ['email', 'email'],
      subjectActions: ['discover', 'export'],
    })
    registerPrivacyDataClass({
      id: 'audit_logs.access_logs',
      module: 'audit_logs',
      title: 'Access logs',
      handlerService: 'accessLogsPrivacyHandler',
      subjectKinds: [],
      retention: { actions: ['delete'], defaultDays: 90 },
      subjectActions: [],
    })
    registerPrivacyDataClass({
      id: 'customers.people',
      module: 'customers',
      title: 'Customer people',
      handlerService: 'customerPeoplePrivacyHandler',
      subjectKinds: ['customers:person'],
      subjectIdentifierKinds: ['email', 'email'],
      subjectActions: ['discover', 'export', 'erase'],
    })

    expect(listPrivacyDataClasses().map((definition) => definition.id)).toEqual([
      'audit_logs.access_logs',
      'customers.people',
    ])
    expect(getPrivacyDataClass('customers.people')?.title).toBe('Customer people')
    expect(getPrivacyDataClass('customers.people')?.subjectIdentifierKinds).toEqual(['email'])
  })

  it('rejects malformed public definitions', () => {
    expect(() => registerPrivacyDataClass({
      id: 'invalid',
      module: 'test',
      title: 'Invalid',
      handlerService: 'invalidHandler',
      subjectKinds: [],
      subjectActions: [],
    })).toThrow('Invalid privacy data class id')
  })

  it('rejects an empty environment sanitization declaration', () => {
    expect(() => registerPrivacyDataClass({
      id: 'customers.people',
      module: 'customers',
      title: 'Customer people',
      handlerService: 'customerPrivacyHandler',
      subjectKinds: [],
      subjectActions: [],
      environmentSanitization: { categories: [] },
    })).toThrow('Environment sanitization must declare at least one category')
  })
})
