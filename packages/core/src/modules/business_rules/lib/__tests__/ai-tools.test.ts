import { aiTools } from '../../ai-tools'

// Helper to find a tool by name
function findTool(name: string) {
  const tool = aiTools.find(t => t.name === name)
  if (!tool) throw new Error(`Tool not found: ${name}`)
  return tool
}

// Minimal tool context for testing
const mockContext = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  userId: 'user-1',
  container: { resolve: () => ({}) },
  userFeatures: ['business_rules.view', 'business_rules.manage'],
  isSuperAdmin: false,
}

describe('business_rules AI tools', () => {
  it('exports 5 tools', () => {
    expect(aiTools).toHaveLength(5)
    const names = aiTools.map(t => t.name)
    expect(names).toContain('business_rules_get_form_state')
    expect(names).toContain('business_rules_suggest_conditions')
    expect(names).toContain('business_rules_suggest_actions')
    expect(names).toContain('business_rules_validate')
    expect(names).toContain('business_rules_dsl_reference')
  })

  it('all tools have required fields', () => {
    for (const tool of aiTools) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema).toBeDefined()
      expect(tool.handler).toBeInstanceOf(Function)
    }
  })

  describe('business_rules_dsl_reference', () => {
    it('returns structured DSL docs for "all"', async () => {
      const tool = findTool('business_rules_dsl_reference')
      const result = await tool.handler({ topic: 'all' }, mockContext) as any
      expect(result.topic).toBe('all')
      expect(result.comparisonOperators).toBeDefined()
      expect(result.actionTypes).toBeDefined()
      expect(result.examples).toBeDefined()
    })

    it('returns operators topic', async () => {
      const tool = findTool('business_rules_dsl_reference')
      const result = await tool.handler({ topic: 'operators' }, mockContext) as any
      expect(result.topic).toBe('operators')
      expect(result.comparisonOperators.length).toBe(16)
    })

    it('requires business_rules.view feature', () => {
      const tool = findTool('business_rules_dsl_reference')
      expect(tool.requiredFeatures).toContain('business_rules.view')
    })
  })

  describe('business_rules_get_form_state', () => {
    it('returns error when no form state in context', async () => {
      const tool = findTool('business_rules_get_form_state')
      const result = await tool.handler({}, mockContext) as any
      expect(result.error).toBe('no_form_state')
    })

    it('returns form state when present in context', async () => {
      const tool = findTool('business_rules_get_form_state')
      const contextWithForm = {
        ...mockContext,
        formState: {
          formType: 'business_rules',
          sections: ['conditionExpression', 'successActions'],
          values: { conditionExpression: { operator: 'AND', rules: [] } },
          metadata: { ruleType: 'GUARD' },
        },
      }
      const result = await tool.handler({}, contextWithForm) as any
      expect(result.formType).toBe('business_rules')
      expect(result.values).toBeDefined()
      expect(result.sections).toBeDefined()
    })

    it('returns error when form state is for different form type', async () => {
      const tool = findTool('business_rules_get_form_state')
      const contextWithWrongForm = {
        ...mockContext,
        formState: { formType: 'other_form' },
      }
      const result = await tool.handler({}, contextWithWrongForm) as any
      expect(result.error).toBe('no_form_state')
    })

    it('requires business_rules.view feature', () => {
      const tool = findTool('business_rules_get_form_state')
      expect(tool.requiredFeatures).toContain('business_rules.view')
    })
  })

  describe('business_rules_suggest_conditions', () => {
    it('returns error when no expression provided', async () => {
      const tool = findTool('business_rules_suggest_conditions')
      const result = await tool.handler({
        description: 'test condition',
        mode: 'replace',
      }, mockContext) as any
      expect(result.error).toBe('missing_expression')
    })

    it('returns form-suggestion for valid simple expression', async () => {
      const tool = findTool('business_rules_suggest_conditions')
      const result = await tool.handler({
        description: 'Block orders over 10k',
        conditionExpression: {
          field: 'order.total', operator: '>', value: 10000,
        },
        mode: 'replace',
      }, mockContext) as any
      expect(result.type).toBe('form-suggestion')
      expect(result.sections).toHaveLength(1)
      expect(result.sections[0].sectionId).toBe('conditionExpression')
      expect(result.sections[0].explanation).toBe('Block orders over 10k')
      expect(result.sections[0].mode).toBe('replace')
    })

    it('returns form-suggestion for valid group expression', async () => {
      const tool = findTool('business_rules_suggest_conditions')
      const result = await tool.handler({
        description: 'Multiple conditions',
        conditionExpression: {
          operator: 'AND',
          rules: [
            { field: 'order.total', operator: '>', value: 10000 },
            { field: 'customer.tier', operator: '!=', value: 'vip' },
          ],
        },
        mode: 'replace',
      }, mockContext) as any
      expect(result.type).toBe('form-suggestion')
      expect(result.sections).toHaveLength(1)
    })

    it('rejects expression exceeding safety limits', async () => {
      const tool = findTool('business_rules_suggest_conditions')
      // Build a deeply nested expression (depth > 10)
      let expr: any = { field: 'x', operator: '=', value: 1 }
      for (let i = 0; i < 12; i++) {
        expr = { operator: 'AND', rules: [expr] }
      }
      const result = await tool.handler({
        description: 'deeply nested',
        conditionExpression: expr,
        mode: 'replace',
      }, mockContext) as any
      expect(result.error).toBe('validation_failed')
    })

    it('preserves mode in the suggestion', async () => {
      const tool = findTool('business_rules_suggest_conditions')
      const result = await tool.handler({
        description: 'append condition',
        conditionExpression: { field: 'order.status', operator: '=', value: 'pending' },
        mode: 'append',
      }, mockContext) as any
      expect(result.sections[0].mode).toBe('append')
    })

    it('requires business_rules.manage feature', () => {
      const tool = findTool('business_rules_suggest_conditions')
      expect(tool.requiredFeatures).toContain('business_rules.manage')
    })
  })

  describe('business_rules_suggest_actions', () => {
    it('returns error when no actions provided', async () => {
      const tool = findTool('business_rules_suggest_actions')
      const result = await tool.handler({
        description: 'test',
        actionTarget: 'success',
        mode: 'replace',
      }, mockContext) as any
      expect(result.error).toBe('missing_actions')
    })

    it('returns error when actions is empty array', async () => {
      const tool = findTool('business_rules_suggest_actions')
      const result = await tool.handler({
        description: 'test',
        actions: [],
        actionTarget: 'success',
        mode: 'replace',
      }, mockContext) as any
      expect(result.error).toBe('missing_actions')
    })

    it('returns form-suggestion for valid success actions', async () => {
      const tool = findTool('business_rules_suggest_actions')
      const result = await tool.handler({
        description: 'Log the event',
        actions: [
          { type: 'LOG', config: { message: 'Rule triggered' } },
        ],
        actionTarget: 'success',
        mode: 'replace',
      }, mockContext) as any
      expect(result.type).toBe('form-suggestion')
      expect(result.sections).toHaveLength(1)
      expect(result.sections[0].sectionId).toBe('successActions')
      expect(result.sections[0].explanation).toBe('Log the event')
    })

    it('returns correct sectionId for failure actions', async () => {
      const tool = findTool('business_rules_suggest_actions')
      const result = await tool.handler({
        description: 'Show error on failure',
        actions: [
          { type: 'SHOW_ERROR', config: { message: 'Operation blocked' } },
        ],
        actionTarget: 'failure',
        mode: 'replace',
      }, mockContext) as any
      expect(result.sections[0].sectionId).toBe('failureActions')
    })

    it('requires business_rules.manage feature', () => {
      const tool = findTool('business_rules_suggest_actions')
      expect(tool.requiredFeatures).toContain('business_rules.manage')
    })
  })

  describe('business_rules_validate', () => {
    it('returns valid for correct condition expression', async () => {
      const tool = findTool('business_rules_validate')
      const result = await tool.handler({
        conditionExpression: {
          operator: 'AND',
          rules: [
            { field: 'order.total', operator: '>', value: 100 },
          ],
        },
      }, mockContext) as any
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('returns valid for simple condition', async () => {
      const tool = findTool('business_rules_validate')
      const result = await tool.handler({
        conditionExpression: { field: 'order.status', operator: '=', value: 'active' },
      }, mockContext) as any
      expect(result.valid).toBe(true)
    })

    it('returns errors for unsafe expression (excessive depth)', async () => {
      const tool = findTool('business_rules_validate')
      let expr: any = { field: 'x', operator: '=', value: 1 }
      for (let i = 0; i < 12; i++) {
        expr = { operator: 'AND', rules: [expr] }
      }
      const result = await tool.handler({
        conditionExpression: expr,
      }, mockContext) as any
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('validates with no inputs returns valid', async () => {
      const tool = findTool('business_rules_validate')
      const result = await tool.handler({}, mockContext) as any
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('requires business_rules.view feature', () => {
      const tool = findTool('business_rules_validate')
      expect(tool.requiredFeatures).toContain('business_rules.view')
    })
  })
})
