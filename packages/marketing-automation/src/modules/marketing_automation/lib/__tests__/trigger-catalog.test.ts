import fs from 'node:fs'
import path from 'node:path'
import { availableEventTriggers, findTrigger, TRIGGER_CATALOG } from '../trigger-catalog'

/**
 * The catalog against the subscribers, and against the locale files.
 *
 * This is the invariant worth a structural test: an available trigger with no subscriber is offered in the
 * palette, picked by an author, saved without complaint — and never fires. Nothing else in the gate notices,
 * because every layer is individually correct. The module already learned this lesson once, with a queue name
 * that had to stay a literal.
 */

const MODULE_ROOT = path.resolve(__dirname, '..', '..')

type DeclaredSubscriber = { eventId: string; file: string }

/**
 * Every file in `subscribers/` and the event it declares.
 *
 * A LIST rather than a map, because two subscribers may legitimately listen to the same event — one forwards
 * `sales.order.created` to campaigns while another converts a referral on it — and keying by event would hide
 * one of them. No filename is skipped either: the generator registers every file in that folder as a
 * subscriber, so a helper living there is one whether it means to be or not.
 */
function declaredSubscribers(): DeclaredSubscriber[] {
  const directory = path.join(MODULE_ROOT, 'subscribers')
  const declared: DeclaredSubscriber[] = []
  for (const file of fs.readdirSync(directory)) {
    if (!file.endsWith('.ts')) continue
    const source = fs.readFileSync(path.join(directory, file), 'utf8')
    const match = /event:\s*'([^']*)'/.exec(source)
    if (match) declared.push({ eventId: match[1], file })
  }
  return declared
}

/** Trigger ids this module synthesises itself — a sweep produces them, so no subscriber may exist. */
const SYNTHETIC_PREFIX = 'marketing_automation.'

describe('the trigger catalog', () => {
  const declared = declaredSubscribers()
  const subscribedEvents = new Set(declared.map((entry) => entry.eventId))

  test('every trigger an author can pick is actually subscribed to', () => {
    const missing = availableEventTriggers()
      .filter((entry) => !entry.eventId.startsWith(SYNTHETIC_PREFIX))
      .filter((entry) => !subscribedEvents.has(entry.eventId))
      .map((entry) => entry.eventId)
    expect(missing).toEqual([])
  })

  /**
   * Nothing in `subscribers/` may be anything but a subscriber.
   *
   * The generator reads the folder, not an index: a shared helper living here was registered as a subscriber
   * for the empty-string event, whose handler imports a module with no default export. It never fired, so
   * nothing ever failed — which is exactly why it needed a test rather than a fix alone.
   */
  test('every file in subscribers/ declares a real event', () => {
    // The offending filename travels in the asserted value, because jest's `expect` takes no message.
    // The offending filename travels in the asserted value, because jest's `expect` takes no message.
    expect(declared.filter((entry) => entry.eventId.length === 0).map((entry) => entry.file)).toEqual([])

    const directory = path.join(MODULE_ROOT, 'subscribers')
    const files = fs.readdirSync(directory).filter((file) => file.endsWith('.ts'))
    // Every file accounted for: one declaring no event at all would be missing from the list above.
    expect(declared).toHaveLength(files.length)
  })

  test('every subscriber forwards an event the catalog knows about', () => {
    // The other direction: a subscriber for an event with no catalog entry dispatches runs whose
    // `trigger.*` context is empty, so every audience over it is quietly false.
    const unknown = [...subscribedEvents]
      .filter((eventId) => !eventId.startsWith(SYNTHETIC_PREFIX))
      .filter((eventId) => !findTrigger(eventId))
    expect(unknown).toEqual([])
  })

  test('a synthetic trigger has no subscriber, because it is not an event', () => {
    for (const entry of TRIGGER_CATALOG) {
      if (!entry.eventId.startsWith(SYNTHETIC_PREFIX)) continue
      // These are produced by a sweep or emitted by this module itself; where this module DOES emit one, the
      // subscriber exists and the catalog entry is available — the ones asserted here are the sweep sources.
      if (entry.available) continue
      expect(subscribedEvents.has(entry.eventId)).toBe(false)
    }
  })

  test('an unavailable trigger explains itself', () => {
    for (const entry of TRIGGER_CATALOG.filter((candidate) => !candidate.available)) {
      // The palette shows these greyed out, and a greyed-out row with no reason is worse than a hidden one.
      expect(typeof entry.blockedReasonKey === 'string' || entry.eventId.startsWith(SYNTHETIC_PREFIX)).toBe(true)
    }
  })

  test('every trigger has a label in the locale files', () => {
    const en = JSON.parse(fs.readFileSync(path.join(MODULE_ROOT, 'i18n', 'en.json'), 'utf8')) as Record<string, string>
    const missing = TRIGGER_CATALOG.filter((entry) => !en[entry.labelKey]).map((entry) => entry.labelKey)
    expect(missing).toEqual([])
  })

  test('every context key it offers is under trigger.', () => {
    // The audience builder offers these paths verbatim; one that is not under `trigger.` would read a key of
    // the subject document that this trigger has no business filling in.
    for (const entry of TRIGGER_CATALOG) {
      for (const key of entry.contextKeys) {
        expect(key.startsWith('trigger.')).toBe(true)
      }
    }
  })

  test('no two entries claim the same event', () => {
    const ids = TRIGGER_CATALOG.map((entry) => entry.eventId)
    expect(ids).toHaveLength(new Set(ids).size)
  })
})
