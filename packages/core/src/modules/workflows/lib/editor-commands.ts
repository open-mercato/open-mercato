/**
 * The command list behind the Studio's Cmd+K palette (spec section 4.6).
 *
 * "Every canvas operation is reachable without a pointer: the command palette +
 * inspector + Problems panel + Code view together form a complete non-pointer
 * authoring path, and this is an explicit acceptance criterion." The palette is
 * therefore not a convenience layer over the toolbar — it is the surface that
 * makes the toolbar optional, which is why every mutating action the page
 * exposes appears here and why a command that cannot run right now is DISABLED
 * with its reason rather than hidden (a missing entry reads as "unsupported",
 * a disabled one as "not now").
 *
 * PURE: descriptors in, descriptors out. The palette component only renders
 * them and the page owns the effects, so dispatch is unit-testable without a
 * dialog, a canvas or a keyboard.
 */

export type WorkflowCommandGroupId = 'edit' | 'add' | 'navigate' | 'view' | 'run'

export const WORKFLOW_COMMAND_GROUP_ORDER: WorkflowCommandGroupId[] = ['edit', 'add', 'navigate', 'view', 'run']

export interface WorkflowEditorCommand {
  id: string
  group: WorkflowCommandGroupId
  label: string
  description?: string
  shortcut?: string
  disabled: boolean
  run: () => void
}

export interface WorkflowCommandStepOption {
  id: string
  label: string
  typeLabel: string
}

export interface WorkflowCommandPaletteLabels {
  undo: string
  redo: string
  deleteSelection: string
  copy: string
  paste: string
  duplicate: string
  addStep: (typeLabel: string) => string
  addNote: string
  addGroup: string
  goToStep: string
  tidy: string
  togglePalette: string
  toggleMetadata: string
  toggleFocus: string
  toggleProblems: string
  toggleCodeView: string
  toggleCompensation: string
  validate: string
  runTest: string
  save: string
  aiDraft: string
}

export interface WorkflowCommandPaletteActions {
  undo: () => void
  redo: () => void
  deleteSelection: () => void
  copy: () => void
  paste: () => void
  duplicate: () => void
  addStep: (nodeType: string) => void
  addNote: () => void
  addGroup: () => void
  goToStep: (stepId: string) => void
  tidy: () => void
  togglePalette: () => void
  toggleMetadata: () => void
  toggleFocus: () => void
  toggleProblems: () => void
  toggleCodeView: () => void
  toggleCompensation: () => void
  validate: () => void
  runTest: () => void
  aiDraft: () => void
  save: () => void
}

export interface WorkflowCommandContext {
  readOnly: boolean
  canUndo: boolean
  canRedo: boolean
  hasNodes: boolean
  hasSelection: boolean
  canRunTest: boolean
  stepTypes: Array<{ nodeType: string; typeLabel: string }>
  steps: WorkflowCommandStepOption[]
  labels: WorkflowCommandPaletteLabels
  actions: WorkflowCommandPaletteActions
}

export function buildWorkflowEditorCommands(context: WorkflowCommandContext): WorkflowEditorCommand[] {
  const { readOnly, labels, actions } = context
  const commands: WorkflowEditorCommand[] = [
    {
      id: 'edit.undo',
      group: 'edit',
      label: labels.undo,
      shortcut: 'Cmd+Z',
      disabled: readOnly || !context.canUndo,
      run: actions.undo,
    },
    {
      id: 'edit.redo',
      group: 'edit',
      label: labels.redo,
      shortcut: 'Cmd+Shift+Z',
      disabled: readOnly || !context.canRedo,
      run: actions.redo,
    },
    {
      id: 'edit.delete',
      group: 'edit',
      label: labels.deleteSelection,
      shortcut: 'Del',
      disabled: readOnly || !context.hasSelection,
      run: actions.deleteSelection,
    },
    {
      id: 'edit.copy',
      group: 'edit',
      label: labels.copy,
      shortcut: 'Cmd+C',
      disabled: !context.hasSelection,
      run: actions.copy,
    },
    {
      id: 'edit.paste',
      group: 'edit',
      label: labels.paste,
      shortcut: 'Cmd+V',
      disabled: readOnly,
      run: actions.paste,
    },
    {
      id: 'edit.duplicate',
      group: 'edit',
      label: labels.duplicate,
      shortcut: 'Cmd+D',
      disabled: readOnly || !context.hasSelection,
      run: actions.duplicate,
    },
  ]

  for (const stepType of context.stepTypes) {
    commands.push({
      id: `add.step.${stepType.nodeType}`,
      group: 'add',
      label: labels.addStep(stepType.typeLabel),
      disabled: readOnly,
      run: () => actions.addStep(stepType.nodeType),
    })
  }

  commands.push(
    { id: 'add.note', group: 'add', label: labels.addNote, disabled: readOnly, run: actions.addNote },
    { id: 'add.group', group: 'add', label: labels.addGroup, disabled: readOnly, run: actions.addGroup },
  )

  for (const step of context.steps) {
    commands.push({
      id: `navigate.step.${step.id}`,
      group: 'navigate',
      label: `${labels.goToStep}: ${step.label}`,
      description: step.typeLabel,
      disabled: false,
      run: () => actions.goToStep(step.id),
    })
  }

  commands.push(
    { id: 'view.tidy', group: 'view', label: labels.tidy, disabled: readOnly || !context.hasNodes, run: actions.tidy },
    { id: 'view.togglePalette', group: 'view', label: labels.togglePalette, disabled: false, run: actions.togglePalette },
    { id: 'view.toggleMetadata', group: 'view', label: labels.toggleMetadata, disabled: false, run: actions.toggleMetadata },
    { id: 'view.toggleFocus', group: 'view', label: labels.toggleFocus, shortcut: 'F', disabled: false, run: actions.toggleFocus },
    { id: 'view.toggleProblems', group: 'view', label: labels.toggleProblems, disabled: false, run: actions.toggleProblems },
    { id: 'view.toggleCodeView', group: 'view', label: labels.toggleCodeView, disabled: false, run: actions.toggleCodeView },
    { id: 'view.toggleCompensation', group: 'view', label: labels.toggleCompensation, disabled: false, run: actions.toggleCompensation },
    // Prompt-to-draft (spec section 9). Present here for the same reason every
    // other mutating action is: the palette is the complete non-pointer path,
    // and a missing entry reads as "unsupported".
    { id: 'add.aiDraft', group: 'add', label: labels.aiDraft, disabled: readOnly, run: actions.aiDraft },
    { id: 'run.validate', group: 'run', label: labels.validate, disabled: false, run: actions.validate },
    { id: 'run.test', group: 'run', label: labels.runTest, disabled: !context.canRunTest, run: actions.runTest },
    { id: 'run.save', group: 'run', label: labels.save, shortcut: 'Cmd+S', disabled: readOnly, run: actions.save },
  )

  return commands
}

/** Group commands for rendering, preserving `WORKFLOW_COMMAND_GROUP_ORDER`. */
export function groupWorkflowEditorCommands(
  commands: WorkflowEditorCommand[],
): Array<{ group: WorkflowCommandGroupId; commands: WorkflowEditorCommand[] }> {
  return WORKFLOW_COMMAND_GROUP_ORDER
    .map((group) => ({ group, commands: commands.filter((command) => command.group === group) }))
    .filter((section) => section.commands.length > 0)
}
