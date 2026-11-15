import { getDatabaseRequest, runWithDatabaseRequest } from '../request'

it('keeps overlapping HTTP requests separate through asynchronous query continuations', async () => {
  const first = new Request('https://example.test/first')
  const second = new Request('https://example.test/second')
  expect(getDatabaseRequest()).toBeUndefined()
  await Promise.all([first, second].map((request) => runWithDatabaseRequest(request, async () => {
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(getDatabaseRequest()).toBe(request)
  })))
  expect(getDatabaseRequest()).toBeUndefined()
})

it('shares request identity across duplicated runtime module instances without changing callback return shape', async () => {
  const request = new Request('https://example.test/identity')
  jest.resetModules()
  const duplicate = await import('../request')
  expect(runWithDatabaseRequest(request, () => duplicate.getDatabaseRequest())).toBe(request)
  expect(runWithDatabaseRequest(request, () => 42)).toBe(42)
})
