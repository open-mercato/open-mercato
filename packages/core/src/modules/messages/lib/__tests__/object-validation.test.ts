import { validateMessageObjectsForType } from '../object-validation'

const getMessageObjectTypeMock = jest.fn()
const isAllowedMock = jest.fn()

jest.mock('../message-objects-registry', () => ({
  getMessageObjectType: (...args: unknown[]) => getMessageObjectTypeMock(...args),
  isMessageObjectTypeAllowedForMessageType: (...args: unknown[]) => isAllowedMock(...args),
}))

describe('validateMessageObjectsForType', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns unsupported error when object type is missing', () => {
    getMessageObjectTypeMock.mockReturnValue(undefined)

    const error = validateMessageObjectsForType('default', [
      { entityModule: 'sales', entityType: 'order', entityId: 'id-1' },
    ])

    expect(error).toBe('Unsupported message object type: sales:order')
  })

  it('returns not-allowed error when type is blocked for message type', () => {
    getMessageObjectTypeMock.mockReturnValue({ module: 'sales', entityType: 'order' })
    isAllowedMock.mockReturnValue(false)

    const error = validateMessageObjectsForType('system', [
      { entityModule: 'sales', entityType: 'order', entityId: 'id-1' },
    ])

    expect(error).toBe('Object type sales:order is not allowed for message type system')
  })

  it('returns null for valid object list', () => {
    getMessageObjectTypeMock.mockReturnValue({ module: 'sales', entityType: 'order' })
    isAllowedMock.mockReturnValue(true)

    const error = validateMessageObjectsForType('default', [
      { entityModule: 'sales', entityType: 'order', entityId: 'id-1' },
    ])

    expect(error).toBeNull()
  })
})
