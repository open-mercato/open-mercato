import { cleanupCrmFixtures } from '../__integration__/helpers/umesFixtures'

it('attempts every cleanup step before reporting failures', async () => {
  const order: string[] = []
  const failure = new Error('[internal] first cleanup failed')
  await expect(cleanupCrmFixtures([
    async () => { order.push('first'); throw failure },
    async () => { order.push('second') },
    async () => { order.push('third') },
  ])).rejects.toThrow('All CRM fixture cleanup steps succeed')
  expect(order).toEqual(['first', 'second', 'third'])
})

it('passes when every cleanup succeeds', async () => {
  const cleanup = jest.fn(async () => {})
  await cleanupCrmFixtures([cleanup, cleanup])
  expect(cleanup).toHaveBeenCalledTimes(2)
})
