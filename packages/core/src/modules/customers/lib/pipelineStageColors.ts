export const PIPELINE_STAGE_COLOR_TONES = ['success', 'warning', 'info', 'error', 'neutral', 'brand', 'pink'] as const

const pipelineStageColorTones: ReadonlySet<string> = new Set(PIPELINE_STAGE_COLOR_TONES)

export function isPipelineStageColorTone(value: unknown): value is (typeof PIPELINE_STAGE_COLOR_TONES)[number] {
  return typeof value === 'string' && pipelineStageColorTones.has(value)
}
