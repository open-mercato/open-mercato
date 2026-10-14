import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { PROBE_MARKER_RESOURCE_KIND } from '../lib/markers'

const markerInputSchema = z.object({
  markerId: z.string().uuid(),
})

type MarkerInput = z.infer<typeof markerInputSchema>

type MarkerResult = { markerId: string }

/**
 * Test-only undoable command that persists nothing: its action-log entry is
 * the whole effect, so audit-log undo and redo of a command owned by the probe
 * module can be exercised end to end without fixtures to clean up.
 */
const recordMarkerCommand: CommandHandler<MarkerInput, MarkerResult> = {
  id: 'module_availability_probe.markers.record',
  isUndoable: true,
  execute(rawInput) {
    const { markerId } = markerInputSchema.parse(rawInput)
    return { markerId }
  },
  buildLog({ result }) {
    return {
      resourceKind: PROBE_MARKER_RESOURCE_KIND,
      resourceId: result.markerId,
    }
  },
  undo() {},
}

registerCommand(recordMarkerCommand)
