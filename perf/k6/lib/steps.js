import exec from 'k6/execution'
import { resolveSegmentAt } from './pure/stages.js'

export function setStepTags(step, stage, measured) {
  exec.vu.metrics.tags.step = String(step)
  exec.vu.metrics.tags.stage = String(stage)
  exec.vu.metrics.tags.measured = measured ? '1' : '0'
}

export function applyTimelineTags(timeline, testStartedAt) {
  const origin = typeof testStartedAt === 'number' ? testStartedAt : exec.scenario.startTime
  const segment = resolveSegmentAt(timeline, (Date.now() - origin) / 1000)
  setStepTags(segment.step, segment.stage, segment.measured)
  return segment
}
