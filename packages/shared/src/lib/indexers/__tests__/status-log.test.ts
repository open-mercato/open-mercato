import { recordIndexerLog } from '../status-log'

type Behaviors = {
  insert?: () => unknown
  select?: () => unknown
  delete?: () => unknown
}

function makeBuilder(op: keyof Behaviors, behaviors: Behaviors): any {
  const builder: any = {}
  for (const method of ['values', 'select', 'where', 'orderBy', 'offset', 'limit']) {
    builder[method] = () => builder
  }
  builder.execute = async () => {
    const behavior = behaviors[op]
    return behavior ? behavior() : []
  }
  return builder
}

function makeDb(behaviors: Behaviors): any {
  return {
    insertInto: () => makeBuilder('insert', behaviors),
    selectFrom: () => makeBuilder('select', behaviors),
    deleteFrom: () => makeBuilder('delete', behaviors),
  }
}

const INPUT = { source: 'vector' as const, handler: 'event:test', message: 'hi' }

describe('recordIndexerLog — inactive-transaction de-noising', () => {
  let errorSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('skips quietly when the insert hits an already-committed transaction', async () => {
    const db = makeDb({
      insert: () => {
        throw new Error('Transaction is already committed')
      },
    })

    await recordIndexerLog({ db }, INPUT)

    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('still logs an unexpected insert failure', async () => {
    const db = makeDb({
      insert: () => {
        throw new Error('connection refused')
      },
    })

    await recordIndexerLog({ db }, INPUT)

    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('skips quietly when the prune hits a rolled-back transaction', async () => {
    const db = makeDb({
      insert: () => undefined,
      select: () => {
        throw new Error('Transaction is already rolled back')
      },
    })

    await recordIndexerLog({ db }, INPUT)

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('still warns on an unexpected prune failure', async () => {
    const db = makeDb({
      insert: () => undefined,
      select: () => {
        throw new Error('deadlock detected')
      },
    })

    await recordIndexerLog({ db }, INPUT)

    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})
