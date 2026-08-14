import { revokeObjectUrlAfterNavigation } from '..'

describe('revokeObjectUrlAfterNavigation', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('defers releasing the blob URL until after the click task', () => {
    const revokeObjectURL = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    revokeObjectUrlAfterNavigation('blob:http://localhost/document-download')

    expect(revokeObjectURL).not.toHaveBeenCalled()
    jest.runOnlyPendingTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/document-download')
  })
})
