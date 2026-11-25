import {
  forgetLockedOperation,
  getLockedOperationRetry,
  rememberLockedOperation,
  retryAfterKeepMine,
} from '../widgets/injection/record-locking/conflictResolution'

const FORM_ID = 'customer-deal:b0000000-0000-4000-8000-000000000001'

describe('locked operation registry', () => {
  afterEach(() => forgetLockedOperation(FORM_ID))

  it('remembers the retry of a guarded mutation that went through the lock', () => {
    const retry = jest.fn(async () => true)
    rememberLockedOperation(FORM_ID, retry)
    expect(getLockedOperationRetry(FORM_ID)).toBe(retry)
  })

  it('drops the mutation retry once a form save sharing the id goes through the lock', () => {
    rememberLockedOperation(FORM_ID, jest.fn(async () => true))
    rememberLockedOperation(FORM_ID, undefined)
    expect(getLockedOperationRetry(FORM_ID)).toBeUndefined()
  })

  it('forgets the operation after a successful save', () => {
    rememberLockedOperation(FORM_ID, jest.fn(async () => true))
    forgetLockedOperation(FORM_ID)
    expect(getLockedOperationRetry(FORM_ID)).toBeUndefined()
  })
})

describe('retryAfterKeepMine', () => {
  it('retries the conflicting guarded mutation and leaves a form sharing its id unsubmitted', async () => {
    const submitForm = jest.fn(() => true)
    const operationRetry = jest.fn(async () => true)
    const fallbackRetry = jest.fn(async () => true)

    await expect(retryAfterKeepMine({ operationRetry, submitForm, fallbackRetry })).resolves.toBe(true)

    expect(operationRetry).toHaveBeenCalledTimes(1)
    expect(submitForm).not.toHaveBeenCalled()
    expect(fallbackRetry).not.toHaveBeenCalled()
  })

  it('reports a failing mutation retry as not retried without submitting the form', async () => {
    const submitForm = jest.fn(() => true)
    const operationRetry = jest.fn(async () => {
      throw new Error('[internal] retry failed')
    })

    await expect(retryAfterKeepMine({ operationRetry, submitForm })).resolves.toBe(false)
    expect(submitForm).not.toHaveBeenCalled()
  })

  it('resubmits the form when the conflict came from a form save', async () => {
    const submitForm = jest.fn(() => true)
    const fallbackRetry = jest.fn(async () => true)

    await expect(retryAfterKeepMine({ submitForm, fallbackRetry })).resolves.toBe(true)

    expect(submitForm).toHaveBeenCalledTimes(1)
    expect(fallbackRetry).not.toHaveBeenCalled()
  })

  it('falls back to the host retry when no form is on the page', async () => {
    const fallbackRetry = jest.fn(async () => true)

    await expect(retryAfterKeepMine({ submitForm: () => false, fallbackRetry })).resolves.toBe(true)
    expect(fallbackRetry).toHaveBeenCalledTimes(1)
  })

  it('reports nothing retried when there is neither a form nor a retry', async () => {
    await expect(retryAfterKeepMine({ submitForm: () => false })).resolves.toBe(false)
  })
})
