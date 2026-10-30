import {
  LEDGER_PATH_MIME,
  ledgerInsertionText,
  readLedgerDragPath,
  resolveLedgerDrop,
  writeLedgerDragPayload,
} from '../ledger-drag'

function fakeDataTransfer(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    store,
    getData: (type: string) => store.get(type) ?? '',
    setData: (type: string, value: string) => {
      store.set(type, value)
    },
    get types() {
      return [...store.keys()]
    },
  }
}

describe('ledger drag payload', () => {
  test('carries the pill as plain text and the bare path privately', () => {
    const dataTransfer = fakeDataTransfer()
    writeLedgerDragPayload(dataTransfer, 'customer.email')
    expect(dataTransfer.getData('text/plain')).toBe('{{customer.email}}')
    expect(dataTransfer.getData(LEDGER_PATH_MIME)).toBe('customer.email')
  })

  test('reads back only its own payload', () => {
    expect(readLedgerDragPath(fakeDataTransfer({ [LEDGER_PATH_MIME]: 'orderId' }))).toBe('orderId')
    expect(readLedgerDragPath(fakeDataTransfer({ 'text/plain': 'orderId' }))).toBeNull()
    expect(readLedgerDragPath(fakeDataTransfer({ [LEDGER_PATH_MIME]: '' }))).toBeNull()
    expect(readLedgerDragPath(null)).toBeNull()
  })

  test('wraps the path only in template mode', () => {
    expect(ledgerInsertionText('a.b', 'template')).toBe('{{a.b}}')
    expect(ledgerInsertionText('a.b', 'bare')).toBe('a.b')
  })
})

describe('resolveLedgerDrop', () => {
  const dataTransfer = fakeDataTransfer({ [LEDGER_PATH_MIME]: 'customer.email' })

  test('splices the pill at the caret of the dropped-on control', () => {
    expect(resolveLedgerDrop(dataTransfer, { selectionStart: 6, selectionEnd: 6 }, 'Hello  world')).toEqual({
      value: 'Hello {{customer.email}} world',
      cursor: 24,
    })
  })

  test('replaces the selected range', () => {
    expect(resolveLedgerDrop(dataTransfer, { selectionStart: 0, selectionEnd: 5 }, 'Hello world')).toEqual({
      value: '{{customer.email}} world',
      cursor: 18,
    })
  })

  test('inserts the bare path for mapping cells and appends when there is no caret', () => {
    expect(resolveLedgerDrop(dataTransfer, null, 'prefix.', 'bare')).toEqual({
      value: 'prefix.customer.email',
      cursor: 21,
    })
  })

  test('leaves foreign drops to the browser', () => {
    expect(resolveLedgerDrop(fakeDataTransfer({ 'text/plain': 'nope' }), null, 'x')).toBeNull()
  })
})
