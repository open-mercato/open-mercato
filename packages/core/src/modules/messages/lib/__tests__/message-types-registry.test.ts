import {
  getAllMessageTypes,
  getMessageType,
  getMessageTypeOrDefault,
  getMessageTypesByModule,
  isMessageTypeCreateableByUser,
  registerMessageTypes,
} from '../message-types-registry'
import defaultTypes from '../../message-types'

describe('message-types-registry', () => {
  afterEach(() => {
    registerMessageTypes(defaultTypes, { replace: true })
  })

  it('registers custom types and resolves by module', () => {
    registerMessageTypes([
      {
        type: 'custom.type',
        module: 'custom',
        labelKey: 'custom.type',
        isCreateableByUser: true,
      },
    ] as never, { replace: true })

    expect(getMessageType('custom.type')?.module).toBe('custom')
    expect(getMessageTypesByModule('custom')).toHaveLength(1)
    expect(getAllMessageTypes()).toHaveLength(1)
    expect(isMessageTypeCreateableByUser('custom.type')).toBe(true)
  })

  it('returns default fallback for unknown type', () => {
    registerMessageTypes([
      {
        type: 'default',
        module: 'messages',
        labelKey: 'messages.types.default',
        isCreateableByUser: true,
      },
    ] as never, { replace: true })

    const resolved = getMessageTypeOrDefault('missing')
    expect(resolved.type).toBe('default')
  })
})
