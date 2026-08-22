const INSTANCE_ID_KEY = '__openMercatoCrossProcessEventInstanceId__'

describe('cross-process bridge instance identity', () => {
  const globalScope = globalThis as Record<string, unknown>
  const originalInstanceId = globalScope[INSTANCE_ID_KEY]

  beforeEach(() => {
    delete globalScope[INSTANCE_ID_KEY]
    jest.resetModules()
  })

  afterAll(() => {
    if (originalInstanceId === undefined) delete globalScope[INSTANCE_ID_KEY]
    else globalScope[INSTANCE_ID_KEY] = originalInstanceId
  })

  it('reuses one process identity across isolated module copies', () => {
    let first: string | undefined
    let second: string | undefined

    jest.isolateModules(() => {
      first = require('../bridge').CROSS_PROCESS_EVENT_INSTANCE_ID as string
    })
    jest.isolateModules(() => {
      second = require('../bridge').CROSS_PROCESS_EVENT_INSTANCE_ID as string
    })

    expect(first).toEqual(expect.any(String))
    expect(second).toBe(first)
  })
})
