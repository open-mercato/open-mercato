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

  // Regression for issue #2503: the Category/Tags/Icon fields are declared with
  // dot-path ids (`metadata.category`, `.tags`, `.icon`). CrudForm reads/writes
  // those as flat keys, so parse must hydrate the flat keys and build must
  // collapse them back into the nested metadata object the API expects.
  describe('metadata.* dot-path round trip (#2503)', () => {
    test('parseWorkflowToFormValues hydrates flat metadata keys from nested metadata', () => {
      const values = parseWorkflowToFormValues({
        workflowId: 'wf',
        workflowName: 'Workflow',
        version: 1,
        enabled: true,
        metadata: { category: 'Sales', tags: ['sales', 'orders'], icon: 'shopping-cart' },
        definition: { steps: [], transitions: [] },
      })
      expect(values['metadata.category']).toBe('Sales')
      expect(values['metadata.tags']).toEqual(['sales', 'orders'])
      expect(values['metadata.icon']).toBe('shopping-cart')
    })

    test('parseWorkflowToFormValues defaults flat metadata keys when metadata is absent', () => {
      const values = parseWorkflowToFormValues({
        workflowId: 'wf',
        workflowName: 'Workflow',
        version: 1,
        enabled: true,
        definition: { steps: [], transitions: [] },
      })
      expect(values['metadata.category']).toBe('')
      expect(values['metadata.tags']).toEqual([])
      expect(values['metadata.icon']).toBe('')
    })

    test('buildWorkflowPayload collapses flat metadata keys into nested metadata', () => {
      const values: WorkflowDefinitionFormValues = {
        ...defaultFormValues,
        workflowId: 'wf',
        workflowName: 'Workflow',
        'metadata.category': 'qa-category-2503',
        'metadata.tags': ['sales', 'orders'],
        'metadata.icon': 'shopping-cart',
      }

      const payload = buildWorkflowPayload(values)

      expect(payload.metadata).toEqual({
        tags: ['sales', 'orders'],
        category: 'qa-category-2503',
        icon: 'shopping-cart',
      })
    })

    test('buildWorkflowPayload drops blank category/icon but keeps tags array', () => {
      const values: WorkflowDefinitionFormValues = {
        ...defaultFormValues,
        workflowId: 'wf',
        workflowName: 'Workflow',
        'metadata.category': '   ',
        'metadata.tags': [],
        'metadata.icon': '',
      }

      const payload = buildWorkflowPayload(values)

      expect(payload.metadata).toEqual({ tags: [] })
    })

    test('edited category persists through a parse -> edit -> build round trip', () => {
      const hydrated = parseWorkflowToFormValues({
        workflowId: 'wf',
        workflowName: 'Workflow',
        version: 1,
        enabled: true,
        metadata: { category: 'Sales', tags: ['sales'], icon: 'shopping-cart' },
        definition: { steps: [], transitions: [] },
      })

      const edited: WorkflowDefinitionFormValues = {
        ...hydrated,
        'metadata.category': 'qa-category-2503',
      }

      const payload = buildWorkflowPayload(edited)

      expect(payload.metadata).toEqual({
        tags: ['sales'],
        category: 'qa-category-2503',
        icon: 'shopping-cart',
      })
    })
  })
})
