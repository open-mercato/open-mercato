/** @jest-environment node */
/**
 * `transformDisplayData` is an opt-in transform, and this file is the cheap guard on that.
 *
 * The widget is registered on every CrudForm host that mounts it, and `CrudForm` writes the
 * handler's result back into the form's own values — which the next submit sends. An
 * unconditional rewrite therefore retitles records nobody asked to retitle. That is not
 * hypothetical: while the display transform was never reaching form values (CrudForm keyed its
 * initial-values effect without injection-widget ids, so late-loading widgets never re-ran it),
 * the blanket `toUpperCase()` looked harmless; the moment that key was fixed it uppercased the
 * title on every host, including hosts whose tests assert unrelated behavior.
 */
jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
}))

import widget from '../injection/crud-validation/widget'

type SharedState = { get: (key: string) => unknown; set: (key: string, value: unknown) => void }

function buildContext(): { context: { sharedState: SharedState }; written: Map<string, unknown> } {
  const written = new Map<string, unknown>()
  return {
    context: {
      sharedState: {
        get: (key: string) => written.get(key),
        set: (key: string, value: unknown) => { written.set(key, value) },
      },
    },
    written,
  }
}

const transformDisplayData = widget.eventHandlers?.transformDisplayData

describe('example crud-validation widget transformDisplayData', () => {
  it('is declared, so the host really has a display transform to run', () => {
    expect(typeof transformDisplayData).toBe('function')
  })

  it('leaves an unmarked record byte-identical and records nothing', async () => {
    const { context, written } = buildContext()
    const record = { id: 'todo-1', title: 'plain todo', note: 'keep me' }

    const result = await transformDisplayData!(record, context)

    expect(result).toEqual(record)
    expect(written.has('lastTransformDisplayData')).toBe(false)
  })

  it('uppercases the title only for a record carrying the [display] marker', async () => {
    const { context, written } = buildContext()
    const record = { id: 'todo-2', title: '[display] marked todo', note: 'keep me' }

    const result = await transformDisplayData!(record, context)

    expect(result).toEqual({ id: 'todo-2', title: '[DISPLAY] MARKED TODO', note: 'keep me' })
    expect(written.get('lastTransformDisplayData')).toEqual(result)
  })

  it('does not treat the save-time [transform] marker as a display opt-in', async () => {
    const { context } = buildContext()
    const record = { id: 'todo-3', title: '[confirm][transform] transform demo' }

    expect(await transformDisplayData!(record, context)).toEqual(record)
  })

  it('matches the marker case-insensitively', async () => {
    const { context } = buildContext()

    const result = await transformDisplayData!({ id: 'todo-4', title: '[Display] mixed case' }, context)

    expect(result).toEqual({ id: 'todo-4', title: '[DISPLAY] MIXED CASE' })
  })

  it('passes a record with no title through untouched', async () => {
    const { context, written } = buildContext()
    const record = { id: 'todo-5', note: 'no title at all' }

    expect(await transformDisplayData!(record, context)).toEqual(record)
    expect(written.has('lastTransformDisplayData')).toBe(false)
  })
})
