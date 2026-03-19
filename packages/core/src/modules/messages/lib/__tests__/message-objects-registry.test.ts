import {
  getAllMessageObjectTypes,
  getMessageObjectType,
  getMessageObjectTypesForMessageType,
  isMessageObjectTypeAllowedForMessageType,
  registerMessageObjectTypes,
} from '../message-objects-registry'
import defaultTypes from '../../message-objects'

describe('message-objects-registry', () => {
  afterEach(() => {
    registerMessageObjectTypes(defaultTypes, { replace: true })
  })

  it('registers and resolves custom object type', () => {
    registerMessageObjectTypes([
      {
        module: 'sales',
        entityType: 'order',
        labelKey: 'sales.order',
        actions: [],
      },
    ] as never, { replace: true })

    expect(getMessageObjectType('sales', 'order')?.labelKey).toBe('sales.order')
    expect(getAllMessageObjectTypes()).toHaveLength(1)
  })

  it('enforces message type allow-list when provided', () => {
    const objectType = {
      module: 'sales',
      entityType: 'order',
      labelKey: 'sales.order',
      actions: [],
      messageTypes: ['default'],
    }

    expect(isMessageObjectTypeAllowedForMessageType(objectType as never, 'default')).toBe(true)
    expect(isMessageObjectTypeAllowedForMessageType(objectType as never, 'system')).toBe(false)
  })

  it('filters object types by allowed message type', () => {
    registerMessageObjectTypes([
      {
        module: 'sales',
        entityType: 'order',
        labelKey: 'sales.order',
        actions: [],
        messageTypes: ['default'],
      },
      {
        module: 'customers',
        entityType: 'person',
        labelKey: 'customers.person',
        actions: [],
      },
    ] as never, { replace: true })

    const allowedForDefault = getMessageObjectTypesForMessageType('default')
    const allowedForSystem = getMessageObjectTypesForMessageType('system')

    expect(allowedForDefault).toHaveLength(2)
    expect(allowedForSystem).toHaveLength(1)
    expect(allowedForSystem[0]?.module).toBe('customers')
  })
})
