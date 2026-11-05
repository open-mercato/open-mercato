import {
  buildExampleTodoCustomValuesFromInteraction,
  buildExampleTodoHref,
  buildInteractionUpdateFromExampleTodo,
} from '../mappings'

describe('example_customers_sync mappings', () => {
  it('maps canonical interaction fields into example todo custom values', () => {
    expect(
      buildExampleTodoCustomValuesFromInteraction({
        priority: 9,
        body: 'Follow up with procurement',
        customValues: { severity: 'critical' },
      }),
    ).toEqual({
      priority: 5,
      __om_customer_interaction_priority_raw: 9,
      description: 'Follow up with procurement',
      severity: 'high',
      __om_customer_interaction_severity_raw: 'critical',
    })

    expect(
      buildExampleTodoCustomValuesFromInteraction({
        priority: 0,
        body: null,
        customValues: { severity: 'normal' },
      }),
    ).toEqual({
      priority: 1,
      __om_customer_interaction_priority_raw: 0,
      severity: 'medium',
      __om_customer_interaction_severity_raw: 'normal',
    })

    expect(
      buildExampleTodoCustomValuesFromInteraction({
        priority: null,
        body: null,
        customValues: {},
      }, {
        includeClears: true,
      }),
    ).toEqual({
      priority: null,
      __om_customer_interaction_priority_raw: null,
      description: null,
      severity: null,
      __om_customer_interaction_severity_raw: null,
    })
  })

  it('maps example todo payloads back into canonical interaction updates', () => {
    const occurredAt = new Date('2026-04-01T10:00:00.000Z')

    expect(
      buildInteractionUpdateFromExampleTodo({
        title: 'Call customer',
        isDone: true,
        occurredAt,
        customValues: {
          priority: '4',
          description: 'Capture new renewal date',
          severity: ' high ',
        },
      }),
    ).toEqual({
      title: 'Call customer',
      status: 'done',
      occurredAt,
      priority: 4,
      body: 'Capture new renewal date',
      customValues: { severity: 'high' },
    })

    expect(
      buildInteractionUpdateFromExampleTodo({
        title: 'Call customer',
        isDone: true,
        occurredAt,
        customValues: {
          priority: 5,
          __om_customer_interaction_priority_raw: 9,
          description: 'Capture new renewal date',
          severity: 'high',
          __om_customer_interaction_severity_raw: 'critical',
        },
      }),
    ).toEqual({
      title: 'Call customer',
      status: 'done',
      occurredAt,
      priority: 9,
      body: 'Capture new renewal date',
      customValues: { severity: 'critical' },
    })

    expect(
      buildInteractionUpdateFromExampleTodo({
        title: 'Call customer',
        isDone: true,
        occurredAt,
        customValues: {
          priority: 4,
          __om_customer_interaction_priority_raw: 9,
          description: 'Capture new renewal date',
          severity: 'low',
          __om_customer_interaction_severity_raw: 'critical',
        },
      }),
    ).toEqual({
      title: 'Call customer',
      status: 'done',
      occurredAt,
      priority: 4,
      body: 'Capture new renewal date',
      customValues: { severity: 'low' },
    })

    expect(
      buildInteractionUpdateFromExampleTodo({
        title: 'Reopened task',
        isDone: false,
        customValues: {
          priority: null,
          description: null,
        },
      }),
    ).toEqual({
      title: 'Reopened task',
      status: 'planned',
      occurredAt: null,
      priority: null,
      body: null,
      customValues: {},
    })

    expect(
      buildInteractionUpdateFromExampleTodo({
        title: 'Reopened task',
        isDone: false,
        customValues: {},
      }, {
        includeClears: true,
      }),
    ).toEqual({
      title: 'Reopened task',
      status: 'planned',
      occurredAt: null,
      priority: null,
      body: null,
      customValues: { severity: null },
    })
  })

  it('builds stable example todo edit links', () => {
    expect(buildExampleTodoHref('todo-id/with spaces')).toBe('/backend/todos/todo-id%2Fwith%20spaces/edit')
  })
})
