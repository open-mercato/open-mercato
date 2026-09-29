import {
  buildWorkflowEditorCommands,
  groupWorkflowEditorCommands,
  WORKFLOW_COMMAND_GROUP_ORDER,
  type WorkflowCommandContext,
  type WorkflowEditorCommand,
} from '../editor-commands'

function makeActions() {
  return {
    undo: jest.fn(),
    redo: jest.fn(),
    deleteSelection: jest.fn(),
    copy: jest.fn(),
    paste: jest.fn(),
    duplicate: jest.fn(),
    addStep: jest.fn(),
    addNote: jest.fn(),
    addGroup: jest.fn(),
    goToStep: jest.fn(),
    tidy: jest.fn(),
    togglePalette: jest.fn(),
    toggleMetadata: jest.fn(),
    toggleFocus: jest.fn(),
    toggleProblems: jest.fn(),
    validate: jest.fn(),
    runTest: jest.fn(),
    save: jest.fn(),
  }
}

const labels: WorkflowCommandContext['labels'] = {
  undo: 'Undo',
  redo: 'Redo',
  deleteSelection: 'Delete selection',
  copy: 'Copy selection',
  paste: 'Paste',
  duplicate: 'Duplicate selection',
  addStep: (typeLabel) => `Add step: ${typeLabel}`,
  addNote: 'Add note',
  addGroup: 'Add group',
  goToStep: 'Go to step',
  tidy: 'Tidy',
  togglePalette: 'Toggle palette',
  toggleMetadata: 'Toggle details',
  toggleFocus: 'Toggle focus',
  toggleProblems: 'Toggle problems',
  validate: 'Validate',
  runTest: 'Start instance',
  save: 'Save',
}

function makeContext(overrides: Partial<WorkflowCommandContext> = {}): WorkflowCommandContext {
  return {
    readOnly: false,
    canUndo: true,
    canRedo: true,
    hasNodes: true,
    hasSelection: true,
    canRunTest: true,
    stepTypes: [
      { nodeType: 'userTask', typeLabel: 'User Task' },
      { nodeType: 'automated', typeLabel: 'Automated' },
    ],
    steps: [
      { id: 'approve', label: 'Approve order', typeLabel: 'User Task' },
      { id: 'charge', label: 'Charge card', typeLabel: 'Automated' },
    ],
    labels,
    actions: makeActions(),
    ...overrides,
  }
}

const byId = (commands: WorkflowEditorCommand[], id: string) =>
  commands.find((command) => command.id === id)!

describe('buildWorkflowEditorCommands', () => {
  it('exposes every editor operation so the palette is a complete non-pointer path', () => {
    const commands = buildWorkflowEditorCommands(makeContext())
    const ids = commands.map((command) => command.id)
    expect(ids).toEqual(expect.arrayContaining([
      'edit.undo', 'edit.redo', 'edit.delete', 'edit.copy', 'edit.paste', 'edit.duplicate',
      'add.step.userTask', 'add.step.automated', 'add.note', 'add.group',
      'navigate.step.approve', 'navigate.step.charge',
      'view.tidy', 'view.togglePalette', 'view.toggleMetadata', 'view.toggleFocus', 'view.toggleProblems',
      'run.validate', 'run.test', 'run.save',
    ]))
  })

  it('dispatches each command to its own action', () => {
    const actions = makeActions()
    const commands = buildWorkflowEditorCommands(makeContext({ actions }))

    byId(commands, 'edit.undo').run()
    byId(commands, 'edit.redo').run()
    byId(commands, 'edit.delete').run()
    byId(commands, 'edit.copy').run()
    byId(commands, 'edit.paste').run()
    byId(commands, 'edit.duplicate').run()
    byId(commands, 'add.note').run()
    byId(commands, 'add.group').run()
    byId(commands, 'view.tidy').run()
    byId(commands, 'run.validate').run()
    byId(commands, 'run.test').run()
    byId(commands, 'run.save').run()

    expect(actions.undo).toHaveBeenCalledTimes(1)
    expect(actions.redo).toHaveBeenCalledTimes(1)
    expect(actions.deleteSelection).toHaveBeenCalledTimes(1)
    expect(actions.copy).toHaveBeenCalledTimes(1)
    expect(actions.paste).toHaveBeenCalledTimes(1)
    expect(actions.duplicate).toHaveBeenCalledTimes(1)
    expect(actions.addNote).toHaveBeenCalledTimes(1)
    expect(actions.addGroup).toHaveBeenCalledTimes(1)
    expect(actions.tidy).toHaveBeenCalledTimes(1)
    expect(actions.validate).toHaveBeenCalledTimes(1)
    expect(actions.runTest).toHaveBeenCalledTimes(1)
    expect(actions.save).toHaveBeenCalledTimes(1)
  })

  it('passes the node type and the step id through to their actions', () => {
    const actions = makeActions()
    const commands = buildWorkflowEditorCommands(makeContext({ actions }))

    byId(commands, 'add.step.automated').run()
    byId(commands, 'navigate.step.charge').run()

    expect(actions.addStep).toHaveBeenCalledWith('automated')
    expect(actions.goToStep).toHaveBeenCalledWith('charge')
  })

  it('disables rather than hides commands that cannot run right now', () => {
    const commands = buildWorkflowEditorCommands(makeContext({
      canUndo: false,
      canRedo: false,
      hasSelection: false,
      hasNodes: false,
      canRunTest: false,
    }))
    expect(byId(commands, 'edit.undo').disabled).toBe(true)
    expect(byId(commands, 'edit.redo').disabled).toBe(true)
    expect(byId(commands, 'edit.delete').disabled).toBe(true)
    expect(byId(commands, 'edit.copy').disabled).toBe(true)
    expect(byId(commands, 'edit.duplicate').disabled).toBe(true)
    expect(byId(commands, 'view.tidy').disabled).toBe(true)
    expect(byId(commands, 'run.test').disabled).toBe(true)
    expect(byId(commands, 'run.validate').disabled).toBe(false)
  })

  it('disables every mutating command on a read-only (code-defined) workflow', () => {
    const commands = buildWorkflowEditorCommands(makeContext({ readOnly: true }))
    for (const id of ['edit.undo', 'edit.redo', 'edit.delete', 'edit.paste', 'edit.duplicate', 'add.step.userTask', 'add.note', 'add.group', 'view.tidy', 'run.save']) {
      expect(byId(commands, id).disabled).toBe(true)
    }
    expect(byId(commands, 'run.validate').disabled).toBe(false)
    expect(byId(commands, 'navigate.step.approve').disabled).toBe(false)
    expect(byId(commands, 'view.toggleFocus').disabled).toBe(false)
  })

  it('labels navigation entries with the step name and its type', () => {
    const commands = buildWorkflowEditorCommands(makeContext())
    const goTo = byId(commands, 'navigate.step.approve')
    expect(goTo.label).toBe('Go to step: Approve order')
    expect(goTo.description).toBe('User Task')
  })

  it('mints a unique id per command', () => {
    const ids = buildWorkflowEditorCommands(makeContext()).map((command) => command.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('groupWorkflowEditorCommands', () => {
  it('groups in the declared order and drops empty groups', () => {
    const sections = groupWorkflowEditorCommands(buildWorkflowEditorCommands(makeContext()))
    expect(sections.map((section) => section.group)).toEqual(WORKFLOW_COMMAND_GROUP_ORDER)

    const withoutSteps = groupWorkflowEditorCommands(buildWorkflowEditorCommands(makeContext({ steps: [] })))
    expect(withoutSteps.map((section) => section.group)).not.toContain('navigate')
  })
})
