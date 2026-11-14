import {
  pipelineCreateSchema,
  pipelineStageCreateSchema,
  pipelineStageUpdateSchema,
  pipelineUpdateSchema,
} from '../validators'

const scope = {
  tenantId: '550e8400-e29b-41d4-a716-446655440001',
  organizationId: '550e8400-e29b-41d4-a716-446655440002',
}
const id = '550e8400-e29b-41d4-a716-446655440003'

describe('pipeline stage default probability schemas', () => {
  it('accepts the stageProbabilitiesEnabled flag on pipeline create and update', () => {
    expect(pipelineCreateSchema.parse({ ...scope, name: 'Sales', stageProbabilitiesEnabled: true }).stageProbabilitiesEnabled).toBe(true)
    expect(pipelineUpdateSchema.parse({ id, stageProbabilitiesEnabled: false }).stageProbabilitiesEnabled).toBe(false)
    expect(pipelineUpdateSchema.parse({ id }).stageProbabilitiesEnabled).toBeUndefined()
  })

  it.each([0, 55, 100])('accepts defaultProbability %s', (value) => {
    expect(pipelineStageCreateSchema.parse({ ...scope, pipelineId: id, label: 'Stage', defaultProbability: value }).defaultProbability).toBe(value)
    expect(pipelineStageUpdateSchema.parse({ id, defaultProbability: value }).defaultProbability).toBe(value)
  })

  it('accepts null to clear the stage default', () => {
    expect(pipelineStageUpdateSchema.parse({ id, defaultProbability: null }).defaultProbability).toBeNull()
  })

  it.each([-1, 101, 12.5])('rejects defaultProbability %s', (value) => {
    expect(pipelineStageCreateSchema.safeParse({ ...scope, pipelineId: id, label: 'Stage', defaultProbability: value }).success).toBe(false)
    expect(pipelineStageUpdateSchema.safeParse({ id, defaultProbability: value }).success).toBe(false)
  })
})
