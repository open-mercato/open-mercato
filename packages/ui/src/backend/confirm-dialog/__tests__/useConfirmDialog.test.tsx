/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { useConfirmDialog } from '../useConfirmDialog'
import type { ConfirmDialogOptions } from '../useConfirmDialog'

function installDialogPolyfill() {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute('open')
    },
  })
}

type ConfirmFn = (options?: ConfirmDialogOptions) => Promise<boolean>

type HookHandle = {
  current: { confirm: ConfirmFn } | null
}

function HookProbe({ handle }: { handle: HookHandle }) {
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  React.useEffect(() => {
    handle.current = { confirm }
    return () => {
      handle.current = null
    }
  }, [confirm, handle])
  return <>{ConfirmDialogElement}</>
}

function NestedRadixHost({ handle }: { handle: HookHandle }) {
  // Mirrors ScheduleActivityDialog: ConfirmDialogElement is mounted inside a
  // Radix Dialog. Radix uses useInsertionEffect for style injection on
  // open transitions; setState scheduled mid-commit by useConfirmDialog
  // surfaces the React 19 "useInsertionEffect must not schedule updates"
  // warning unless the hook defers its writes.
  return (
    <DialogPrimitive.Root open>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay />
        <DialogPrimitive.Content>
          <DialogPrimitive.Title>Host dialog</DialogPrimitive.Title>
          <HookProbe handle={handle} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useConfirmDialog — queue/timing fixes (#1804, #1810)', () => {
  let consoleErrorSpy: jest.SpyInstance
  let warnings: string[] = []

  beforeEach(() => {
    installDialogPolyfill()
    warnings = []
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        warnings.push(args.map((arg) => String(arg)).join(' '))
      })
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('does not log "useInsertionEffect must not schedule updates" when invoked inside a Radix Dialog (#1810)', async () => {
    const handle: HookHandle = { current: null }
    renderWithProviders(<NestedRadixHost handle={handle} />)

    expect(handle.current).not.toBeNull()

    let pending: Promise<boolean> | null = null
    await act(async () => {
      pending = handle.current!.confirm({
        title: 'Discard unsaved changes?',
        text: 'Confirm cancel',
        cancelText: 'Keep editing',
        confirmText: 'Discard',
      })
    })
    await flushMicrotasks()

    expect(pending).not.toBeNull()
    expect(
      warnings.some((entry) =>
        entry.includes('useInsertionEffect must not schedule updates'),
      ),
    ).toBe(false)
  })

  it('does not log "useInsertionEffect must not schedule updates" when confirm() is invoked from an insertion effect (#1810)', async () => {
    const handle: HookHandle = { current: null }

    function HostInsertion() {
      const { confirm, ConfirmDialogElement } = useConfirmDialog()
      // Invoking confirm from useInsertionEffect models the React 19
      // commit-phase race that surfaces #1810 in production: the hook
      // schedules state updates synchronously while the parent's
      // insertion-effect commit is still running.
      React.useInsertionEffect(() => {
        handle.current = { confirm }
      }, [confirm])
      // Once mounted, fire confirm in a layout effect so React 19 has
      // rendered + committed the insertion phase. Then invoke it again
      // from a microtask to stress the queue path.
      React.useLayoutEffect(() => {
        void confirm({ cancelText: 'Cancel', confirmText: 'OK' }).catch(() => undefined)
      }, [confirm])
      return <>{ConfirmDialogElement}</>
    }

    await act(async () => {
      renderWithProviders(<HostInsertion />)
    })
    await flushMicrotasks()

    expect(
      warnings.some((entry) =>
        entry.includes('useInsertionEffect must not schedule updates'),
      ),
    ).toBe(false)
  })

  it('reopens after Keep editing / X cancel: a second confirm() resolves and is not dropped (#1804)', async () => {
    const handle: HookHandle = { current: null }
    renderWithProviders(<HookProbe handle={handle} />)

    expect(handle.current).not.toBeNull()

    // First confirm — open and cancel via the dialog's Cancel ("Keep editing") button.
    let firstResult: boolean | null = null
    await act(async () => {
      handle
        .current!.confirm({
          cancelText: 'Keep editing',
          confirmText: 'Discard',
        })
        .then((value) => {
          firstResult = value
        })
    })
    await flushMicrotasks()

    const cancelButton = await screen.findByRole('button', { name: 'Keep editing' })
    await act(async () => {
      cancelButton.click()
    })
    await flushMicrotasks()

    expect(firstResult).toBe(false)

    // Second confirm — must open again. Before the fix, openRef.current was not
    // reset before processQueue ran, so the next confirm() was dropped.
    let secondResult: boolean | null = null
    await act(async () => {
      handle
        .current!.confirm({
          cancelText: 'Keep editing',
          confirmText: 'Discard',
        })
        .then((value) => {
          secondResult = value
        })
    })
    await flushMicrotasks()

    const cancelButton2 = await screen.findByRole('button', { name: 'Keep editing' })
    await act(async () => {
      cancelButton2.click()
    })
    await flushMicrotasks()

    expect(secondResult).toBe(false)
  })

  it('drains queued requests in declared order; duplicate confirm() during drain stays queued', async () => {
    const handle: HookHandle = { current: null }
    renderWithProviders(<HookProbe handle={handle} />)

    expect(handle.current).not.toBeNull()

    const order: string[] = []

    // Three concurrent confirm() calls — first opens, others queue.
    await act(async () => {
      handle
        .current!.confirm({ cancelText: 'Cancel A', confirmText: 'Confirm A' })
        .then((value) => {
          order.push(`a:${value}`)
        })
      handle
        .current!.confirm({ cancelText: 'Cancel B', confirmText: 'Confirm B' })
        .then((value) => {
          order.push(`b:${value}`)
        })
      handle
        .current!.confirm({ cancelText: 'Cancel C', confirmText: 'Confirm C' })
        .then((value) => {
          order.push(`c:${value}`)
        })
    })
    await flushMicrotasks()

    // First dialog (A) is the visible one.
    const cancelA = await screen.findByRole('button', { name: 'Cancel A' })
    await act(async () => {
      cancelA.click()
    })
    await flushMicrotasks()

    // Now B should have surfaced.
    const cancelB = await screen.findByRole('button', { name: 'Cancel B' })
    await act(async () => {
      cancelB.click()
    })
    await flushMicrotasks()

    // Now C should have surfaced.
    const cancelC = await screen.findByRole('button', { name: 'Cancel C' })
    await act(async () => {
      cancelC.click()
    })
    await flushMicrotasks()

    await waitFor(() => {
      expect(order).toEqual(['a:false', 'b:false', 'c:false'])
    })
  })
})
