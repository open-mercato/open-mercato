import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The handlers that cannot be undone ask before they act.
 *
 * All three used to run on the first click, on screens a marketer opens without reading anything first: a
 * suppression import that unsubscribes everybody it matches and cannot be reversed, a version restore that
 * reloads the page immediately afterwards, and a winner promotion that rewrites the campaign and ends the test
 * collecting the evidence. Two of them are driven in a browser by TC-MA-049; the winner button only renders
 * once lanes have recorded deliveries, which no spec can construct cheaply, so all three are held here as well.
 *
 * Checked in the source rather than by rendering, because what matters is an ORDER — the question comes before
 * the write — and because a regex that has stopped matching would report a clean module for ever. The fixtures
 * below are the positive control: the same check must flag a handler written the old way.
 */
const BACKEND_ROOT = join(__dirname, '..')

type Guarded = {
  file: string
  /** The handler as it appears in the source, from its declaration to the mutation it performs. */
  handler: RegExp
}

const GUARDED: Guarded[] = [
  {
    file: join(BACKEND_ROOT, 'marketing', 'settings', 'page.tsx'),
    handler: /const importSuppressionList = async[\s\S]*?apiCallOrThrow/,
  },
  {
    file: join(BACKEND_ROOT, 'marketing', 'campaigns', '[id]', 'page.tsx'),
    handler: /const restoreRevision = async[\s\S]*?apiCallOrThrow/,
  },
  {
    file: join(BACKEND_ROOT, 'marketing', 'campaigns', '[id]', 'results', 'page.tsx'),
    handler: /const applyWinner = async[\s\S]*?apiCallOrThrow/,
  },
]

/** The two lines that together make a question binding: it is awaited, and a "no" returns. */
function asksBeforeActing(handlerSource: string): boolean {
  return /await confirm\(/.test(handlerSource) && /if \(!confirmed\) return/.test(handlerSource)
}

function handlerSource(file: string, handler: RegExp): string {
  const match = readFileSync(file, 'utf8').match(handler)
  if (!match) throw new Error(`[internal] handler not found in ${file}; the guard has stopped matching`)
  return match[0]
}

describe('actions nothing can undo', () => {
  /**
   * Pages this delivery does not contain are skipped, and the rule asserts it found some.
   *
   * The three pages belong to three different phases of the module's delivery, so no single phase holds all of
   * them, and demanding all three would fail for the right reason in the wrong place. Skipping an absent page
   * keeps the real assertion on every page that IS here, and the count below stops the rule going vacuous if
   * the paths ever stop resolving.
   */
  const present = GUARDED.filter(({ file }) => existsSync(file))

  it('finds at least one guarded page in this delivery', () => {
    expect(present.length).toBeGreaterThan(0)
  })

  it.each(present)('asks before it acts: $file', ({ file, handler }) => {
    expect(asksBeforeActing(handlerSource(file, handler))).toBe(true)
  })

  it.each(present)('renders the dialog it opens: $file', ({ file }) => {
    // A `confirm` whose element is never rendered resolves to nothing and the action silently never runs.
    const source = readFileSync(file, 'utf8')
    expect(source).toContain('useConfirmDialog')
    expect(source).toContain('{ConfirmDialogElement}')
  })

  it('flags a handler written the old way, which is what makes the check worth having', () => {
    const oldWay = `
      const applyWinner = async (winner: Winner) => {
        setApplying(winner.stepId)
        await runMutation(() => apiCallOrThrow('/api/whatever', { method: 'POST' }))
    `
    expect(asksBeforeActing(oldWay)).toBe(false)
  })

  it('flags a question that is asked and then ignored', () => {
    // Asking without acting on the answer is worse than not asking: the dialog teaches somebody it is a
    // safety net when it is decoration.
    const ignored = `
      const applyWinner = async (winner: Winner) => {
        void confirm({ text: 'Sure?' })
        await runMutation(() => apiCallOrThrow('/api/whatever', { method: 'POST' }))
    `
    expect(asksBeforeActing(ignored)).toBe(false)
  })

  it('flags an awaited question whose answer is not checked', () => {
    const unchecked = `
      const applyWinner = async (winner: Winner) => {
        await confirm({ text: 'Sure?' })
        await runMutation(() => apiCallOrThrow('/api/whatever', { method: 'POST' }))
    `
    expect(asksBeforeActing(unchecked)).toBe(false)
  })
})
