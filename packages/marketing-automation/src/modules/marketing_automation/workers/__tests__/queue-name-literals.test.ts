import { metadata as dispatchMeta } from '../dispatch'
import { metadata as resumeMeta } from '../resume'
import { metadata as segmentActionMeta } from '../segment-action'
import { metadata as sweepMeta } from '../sweep'
import {
  MARKETING_DISPATCH_QUEUE,
  MARKETING_RESUME_QUEUE,
  MARKETING_SEGMENT_ACTION_QUEUE,
  MARKETING_SWEEP_QUEUE,
} from '../../lib/queues'

/**
 * The generator extracts `metadata.queue` from the AST and cannot resolve an imported constant,
 * so each worker repeats its queue name as a literal. This is the guard against somebody
 * "cleaning up" that duplication and silently removing the worker from the registry.
 */
describe('worker queue names', () => {
  test('dispatch worker matches its constant', () => {
    expect(dispatchMeta.queue).toBe(MARKETING_DISPATCH_QUEUE)
  })

  test('resume worker matches its constant', () => {
    expect(resumeMeta.queue).toBe(MARKETING_RESUME_QUEUE)
  })

  test('sweep worker matches its constant', () => {
    expect(sweepMeta.queue).toBe(MARKETING_SWEEP_QUEUE)
  })

  test('segment action worker matches its constant', () => {
    expect(segmentActionMeta.queue).toBe(MARKETING_SEGMENT_ACTION_QUEUE)
  })

  test('the bulk action worker is NOT scheduler-facing', () => {
    // It is started by an operator pressing a button, never by a clock; a scheduler running it would apply an
    // action to a segment nobody asked about.
    expect(segmentActionMeta.schedulerSafe).toBeUndefined()
  })

  test('the scheduler-facing workers opt in explicitly', () => {
    expect(resumeMeta.schedulerSafe).toBe(true)
    expect(sweepMeta.schedulerSafe).toBe(true)
    // A dispatch job carries a trigger payload the scheduler cannot supply, so exposing it as a
    // schedulable target would only let somebody create a job that can never do anything.
    expect(dispatchMeta.schedulerSafe).toBeUndefined()
  })
})
