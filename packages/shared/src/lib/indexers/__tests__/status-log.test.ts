import { recordIndexerLog } from '../status-log'
import { createLogger } from '@open-mercato/shared/lib/logger'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})
const loggerError = createLogger('shared').error as jest.Mock
const loggerWarn = createLogger('shared').warn as jest.Mock


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

  beforeEach(() => {
    loggerError.mockClear()
    loggerWarn.mockClear()
  })

  afterEach(() => {
  })

  it('skips quietly when the insert hits an already-committed transaction', async () => {
    const db = makeDb({
      insert: () => {
        throw new Error('Transaction is already committed')
      },
    })

    await recordIndexerLog({ db }, INPUT)

    expect(loggerError).not.toHaveBeenCalled()
  })

  it('still logs an unexpected insert failure', async () => {
    const db = makeDb({
      insert: () => {
        throw new Error('connection refused')
      },
    })

    await recordIndexerLog({ db }, INPUT)

    expect(loggerError).toHaveBeenCalledTimes(1)
  })

  it('skips quietly when the prune hits a rolled-back transaction', async () => {
    const db = makeDb({
      insert: () => undefined,
      select: () => {
        throw new Error('Transaction is already rolled back')
      },
    })

    await recordIndexerLog({ db }, INPUT)

    expect(loggerWarn).not.toHaveBeenCalled()
  })

  it('still warns on an unexpected prune failure', async () => {
    const db = makeDb({
      insert: () => undefined,
      select: () => {
        throw new Error('deadlock detected')
      },
    })

    await recordIndexerLog({ db }, INPUT)

    expect(loggerWarn).toHaveBeenCalledTimes(1)
  })
})
