import { defaultFieldTypeRegistry } from '../schema/field-type-registry'
import { FormVersionCompiler } from '../services/form-version-compiler'
import { RolePolicyService } from '../services/role-policy-service'

const baseSchema = () => ({
  type: 'object',
  'x-om-roles': ['admin', 'patient', 'clinician'],
  'x-om-default-actor-role': 'patient',
  properties: {
    full_name: {
      type: 'string',
      'x-om-type': 'text',
      'x-om-editable-by': ['patient'],
      'x-om-visible-to': ['patient', 'clinician', 'admin'],
    },
    diagnosis: {
      type: 'string',
      'x-om-type': 'textarea',
      'x-om-editable-by': ['clinician'],
      'x-om-visible-to': ['clinician', 'admin'],
    },
    notes: {
      type: 'string',
      'x-om-type': 'textarea',
      'x-om-editable-by': ['admin'],
      'x-om-visible-to': ['admin'],
    },
  },
  required: ['full_name'],
})

describe('RolePolicyService', () => {
  const compiler = new FormVersionCompiler({ registry: defaultFieldTypeRegistry })
  const service = new RolePolicyService()

  const compiled = compiler.compile({
    id: 'rp-test-v1',
    updatedAt: new Date('2026-05-01T00:00:00Z'),
    schema: baseSchema(),
    uiSchema: {},
  })

  it('enforces the canWrite/canRead matrix per role', () => {
    const patient = service.resolve(compiled, 'patient')
    expect(patient.canWrite('full_name')).toBe(true)
    expect(patient.canRead('full_name')).toBe(true)
    expect(patient.canWrite('diagnosis')).toBe(false)
    expect(patient.canRead('diagnosis')).toBe(false)
    expect(patient.canWrite('notes')).toBe(false)

    const clinician = service.resolve(compiled, 'clinician')
    expect(clinician.canWrite('full_name')).toBe(false)
    expect(clinician.canRead('full_name')).toBe(true)
    expect(clinician.canWrite('diagnosis')).toBe(true)
    expect(clinician.canRead('diagnosis')).toBe(true)
    expect(clinician.canWrite('notes')).toBe(false)

    const admin = service.resolve(compiled, 'admin')
    expect(admin.canRead('full_name')).toBe(true)
    expect(admin.canRead('diagnosis')).toBe(true)
    expect(admin.canRead('notes')).toBe(true)
    expect(admin.canWrite('notes')).toBe(true)
  })

  it('drops fields outside the actor editable set when filtering a patch', () => {
    const patient = service.resolve(compiled, 'patient')
    const { accepted, droppedFieldKeys } = patient.filterWritePatch({
      full_name: 'Jane',
      diagnosis: 'allergy',
    })
    expect(accepted).toEqual({ full_name: 'Jane' })
    expect(droppedFieldKeys).toEqual(['diagnosis'])
  })

  it('slices a read payload to the actor visible set', () => {
    const clinician = service.resolve(compiled, 'clinician')
    const sliced = clinician.sliceReadPayload({
      full_name: 'Jane',
      diagnosis: 'allergy',
      notes: 'admin-only',
    })
    expect(sliced).toEqual({ full_name: 'Jane', diagnosis: 'allergy' })
  })

  it('returns empty arrays when the role has no editable or visible fields', () => {
    const stranger = service.resolve(compiled, 'stranger')
    expect(stranger.editableFieldKeys()).toEqual([])
    expect(stranger.visibleFieldKeys()).toEqual([])
    const { accepted, droppedFieldKeys } = stranger.filterWritePatch({ full_name: 'Jane' })
    expect(accepted).toEqual({})
    expect(droppedFieldKeys).toEqual(['full_name'])
  })
})
