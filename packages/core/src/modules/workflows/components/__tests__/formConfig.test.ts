import {
  buildWorkflowPayload,
  parseWorkflowToFormValues,
  defaultFormValues,
  type WorkflowDefinitionFormValues,
} from '../formConfig'

describe('workflow definition formConfig', () => {
  describe('parseWorkflowToFormValues', () => {
    test('reads embedded triggers from definition.triggers', () => {
      const trigger = {
        triggerId: 'on-customer-update',
        name: 'On Customer Update',
        eventPattern: 'customers.person.updated',
        enabled: true,
        priority: 0,
      }
      const values = parseWorkflowToFormValues({
        workflowId: 'wf',
        workflowName: 'Workflow',
        version: 1,
        enabled: true,
        definition: {
          steps: [],
          transitions: [],
          triggers: [trigger],
        },
      })
      expect(values.triggers).toEqual([trigger])
    })

    test('falls back to an empty triggers list when none are present', () => {
      const values = parseWorkflowToFormValues({
        workflowId: 'wf',
        workflowName: 'Workflow',
        version: 1,
        enabled: true,
        definition: { steps: [], transitions: [] },
      })
      expect(values.triggers).toEqual([])
    })
  })

  describe('buildWorkflowPayload', () => {
    // Regression for issue #1586: previously the EventTriggersEditor inside the
    // Edit form posted to a non-existent /api/workflows/triggers route. Triggers
    // are now embedded in the workflow definition document, mirroring the visual
    // editor, so the PUT payload must carry them under definition.triggers.
    test('embeds triggers inside definition payload', () => {
      const values: WorkflowDefinitionFormValues = {
        ...defaultFormValues,
        workflowId: 'wf',
        workflowName: 'Workflow',
        steps: [{ stepId: 'start' }],
        transitions: [{ transitionId: 'start-to-end' }],
        triggers: [
          {
            triggerId: 'trg',
            name: 'trigger',
            eventPattern: 'customers.person.updated',
            enabled: true,
            priority: 0,
          } as any,
        ],
      }

      const payload = buildWorkflowPayload(values)

      expect(payload.definition.triggers).toHaveLength(1)
      expect(payload.definition.triggers?.[0]).toMatchObject({
        triggerId: 'trg',
        eventPattern: 'customers.person.updated',
      })
    })

    test('omits triggers key when no triggers are configured', () => {
      const values: WorkflowDefinitionFormValues = {
        ...defaultFormValues,
        workflowId: 'wf',
        workflowName: 'Workflow',
      }

      const payload = buildWorkflowPayload(values)

      expect(payload.definition).not.toHaveProperty('triggers')
    })
  })
})
