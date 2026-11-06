import type { Page } from '@playwright/test'
import { addCustomLine } from '../salesUi'

jest.mock('../api', () => ({ apiRequest: jest.fn(), getAuthToken: jest.fn() }))
jest.mock('@playwright/test', () => ({
  expect: (locator: {
    waitFor: (options: { state: string; timeout: number }) => Promise<void>
    isEnabled: () => Promise<boolean>
  }) => ({
    toBeVisible: ({ timeout = 15_000 }: { timeout?: number } = {}) => locator.waitFor({ state: 'visible', timeout }),
    toBeHidden: ({ timeout }: { timeout: number }) => locator.waitFor({ state: 'hidden', timeout }),
    toBeEnabled: async () => {
      if (!(await locator.isEnabled())) throw new Error('[internal] Button is disabled')
    },
  }),
}))

type LocatorKind = 'items' | 'open' | 'dialog' | 'custom' | 'input' | 'submit' | 'row'
type TestLocator = {
  first: () => TestLocator
  isVisible: () => Promise<boolean>
  isEnabled: () => Promise<boolean>
  fill: () => Promise<void>
  click: () => Promise<void>
  waitFor: (options: { state: string; timeout: number }) => Promise<void>
  getByRole: (role: string, options: { name: string | RegExp }) => TestLocator
}

function delayedLinePage(saveDelay: number | null) {
  const state = { dialogOpen: false, pending: false, rowVisible: false, submissions: 0 }
  const locator = (kind: LocatorKind): TestLocator => {
    const visible = () => kind === 'dialog' ? state.dialogOpen : kind === 'row' ? state.rowVisible : true
    const target = {
      first: () => target,
      isVisible: async () => visible(),
      isEnabled: async () => kind !== 'submit' || !state.pending,
      fill: async () => {},
      click: async () => {
        if (kind === 'open') state.dialogOpen = true
        if (kind !== 'submit') return
        if (state.pending) throw new Error('[internal] A successful save is already pending')
        state.submissions += 1
        state.pending = true
        if (saveDelay !== null) {
          setTimeout(() => {
            state.dialogOpen = false
            state.rowVisible = true
          }, saveDelay)
        }
      },
      waitFor: ({ state: expected, timeout }: { state: string; timeout: number }) => new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + timeout
        const check = () => {
          if (visible() === (expected === 'visible')) return resolve()
          if (Date.now() >= deadline) return reject(new Error(`[internal] ${kind} did not become ${expected}`))
          setTimeout(check, 10)
        }
        check()
      }),
      getByRole: (role: string, options: { name: string | RegExp }) => {
        if (role === 'textbox') return locator('input')
        return locator(options.name instanceof RegExp && options.name.test('Custom line') ? 'custom' : 'submit')
      },
    }
    return target
  }
  const page = {
    getByRole: (role: string, options: { name: RegExp }) => {
      if (role === 'dialog') return locator('dialog')
      if (role === 'row') return locator('row')
      return locator(options.name.test('Items') ? 'items' : 'open')
    },
  } as unknown as Page
  return { page, state }
}

describe('addCustomLine', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  it('waits for a successful save longer than three seconds without submitting again', async () => {
    const { page, state } = delayedLinePage(3_400)
    const outcome = addCustomLine(page, { name: 'Delayed line', quantity: 1, unitPriceGross: 50 })
      .then(() => null, (error: unknown) => error)

    await jest.runAllTimersAsync()

    expect(await outcome).toBeNull()
    expect(state).toMatchObject({ submissions: 1, rowVisible: true, dialogOpen: false })
  })

  it('fails a save that never completes without a duplicate submission', async () => {
    const { page, state } = delayedLinePage(null)
    const outcome = addCustomLine(page, { name: 'Stalled line', quantity: 1, unitPriceGross: 50 })
      .then(() => null, (error: unknown) => error)

    await jest.runAllTimersAsync()

    expect(await outcome).toEqual(new Error('[internal] dialog did not become hidden'))
    expect(state).toMatchObject({ submissions: 1, rowVisible: false, dialogOpen: true })
  })
})
