/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Node } from '@xyflow/react'

const apiCallMock = jest.fn()
const flashMock = jest.fn()
const routerPushMock = jest.fn()
let capturedWorkflowSave: ((event?: unknown) => unknown) | null = null

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: <T,>(_headers: Record<string, string>, run: () => Promise<T>) => run(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => flashMock(...args) }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock, refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams('id=def-1'),
  usePathname: () => '/backend/definitions/visual-editor',
}))
jest.mock('@open-mercato/ui/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
jest.mock('@open-mercato/ui/backend/injection/recordContext', () => ({
  buildRecordInjectionContext: (value: unknown) => value,
  useSetCurrentRecordInjectionContext: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn(async () => true),
    ConfirmDialogElement: null,
  }),
}))
jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
}))
jest.mock('@open-mercato/ui/backend/forms', () => ({
  FormHeader: ({ title, actionsContent }: { title: string; actionsContent?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actionsContent}
    </header>
  ),
}))
jest.mock('@open-mercato/ui/backend/inputs/TagsInput', () => ({
  TagsInput: () => <div data-testid="tags-input" />,
}))
jest.mock('../../../components/DefinitionTriggersEditor', () => ({
  DefinitionTriggersEditor: () => <div data-testid="triggers-editor" />,
}))
jest.mock('../../../components/mobile/MobileVisualEditor', () => ({
  MobileVisualEditor: () => <div data-testid="mobile-editor" />,
}))
jest.mock('../../../components/EdgeEditDialog', () => ({
  EdgeEditDialog: () => null,
}))
jest.mock('../../../components/EdgeEditDialogCrudForm', () => ({
  EdgeEditDialogCrudForm: () => null,
}))
jest.mock('../../../components/NodeEditDialogCrudForm', () => ({
  NodeEditDialogCrudForm: () => null,
}))
jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => {
    if (props['aria-label'] === 'workflows.common.update') {
      capturedWorkflowSave = onClick ?? null
    }
    return (
      <button type="button" onClick={onClick} {...props}>
        {children}
      </button>
    )
  },
}))
jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))
jest.mock('@open-mercato/ui/primitives/textarea', () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}))
jest.mock('@open-mercato/ui/primitives/label', () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label>,
}))
jest.mock('@open-mercato/ui/primitives/switch', () => ({
  Switch: ({ checked, onCheckedChange }: { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) => (
    <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange?.(event.target.checked)} />
  ),
}))
jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))
jest.mock('@open-mercato/ui/primitives/alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertTitle: ({ children }: { children: React.ReactNode }) => <strong>{children}</strong>,
}))
jest.mock('../../../components/WorkflowGraph', () => ({
  WorkflowGraph: ({
    initialNodes,
    onNodeClick,
  }: {
    initialNodes?: Node[]
    onNodeClick?: (event: React.MouseEvent, node: Node) => void
  }) => (
    <button
      type="button"
      data-testid="open-user-task"
      onClick={(event) => onNodeClick?.(event as unknown as React.MouseEvent, initialNodes?.find((node) => node.type === 'userTask')!)}
    >
      open user task
    </button>
  ),
}))
jest.mock('../../../components/NodeEditDialog', () => ({
  NodeEditDialog: ({
    isOpen,
    node,
    onSave,
    onClose,
  }: {
    isOpen: boolean
    node: Node | null
    onSave: (nodeId: string, updates: Partial<Node['data']>) => void
    onClose: () => void
  }) => {
    if (!isOpen || !node) return null
    return (
      <button
        type="button"
        data-testid="save-node"
        onClick={() => {
          onSave(node.id, {
            assignedToRoles: ['Sales Representative'],
            formKey: 'initial_contact_form',
            userTaskConfig: {
              assignedToRoles: ['Sales Representative'],
              formSchema: {
                fields: [
                  {
                    name: 'conversation_summary',
                    type: 'textarea',
                    label: 'Conversation summary',
                    required: true,
                    placeholder: 'Please fill in the details of the conversation',
                  },
                ],
              },
            },
          })
          onClose()
        }}
      >
        save node
      </button>
    )
  },
}))

import VisualEditorPage from '../visual-editor/page'

function workflowRecord() {
  return {
    id: 'def-1',
    workflowId: 'webform_sales_flow2',
    workflowName: 'Webform sales flow 2',
    description: null,
    version: 1,
    enabled: true,
    updatedAt: '2026-07-08T14:00:00.000Z',
    source: 'user',
    metadata: null,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'usertask_1783512016144_4if0hfs4s',
          stepName: 'Initial contact',
          stepType: 'USER_TASK',
          userTaskConfig: {},
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start_to_user_task', fromStepId: 'start', toStepId: 'usertask_1783512016144_4if0hfs4s', trigger: 'auto' },
        { transitionId: 'user_task_to_end', fromStepId: 'usertask_1783512016144_4if0hfs4s', toStepId: 'end', trigger: 'manual' },
      ],
    },
  }
}

describe('VisualEditorPage user task node state', () => {
  beforeEach(() => {
    capturedWorkflowSave = null
    apiCallMock.mockReset()
    apiCallMock.mockResolvedValueOnce({ ok: true, result: { data: workflowRecord() } })
    apiCallMock.mockResolvedValue({ ok: true, result: { data: { id: 'def-1' } } })
    flashMock.mockReset()
    routerPushMock.mockReset()
  })

  it('serializes dialog-updated user task data even when final save runs before React re-renders', async () => {
    render(<VisualEditorPage />)

    await waitFor(() => expect(screen.getByTestId('open-user-task')).toBeInTheDocument())
    expect(capturedWorkflowSave).toBeTruthy()

    const staleWorkflowSave = capturedWorkflowSave!
    fireEvent.click(screen.getByTestId('open-user-task'))
    fireEvent.click(screen.getByTestId('save-node'))

    await act(async () => {
      await staleWorkflowSave()
    })

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(2))
    const [, putInit] = apiCallMock.mock.calls[1]
    expect(apiCallMock.mock.calls[1][0]).toBe('/api/workflows/definitions/def-1')

    const body = JSON.parse((putInit as RequestInit).body as string) as {
      definition: {
        steps: Array<{
          stepId: string
          userTaskConfig?: Record<string, unknown>
        }>
      }
    }
    const userTask = body.definition.steps.find((step) => step.stepId === 'usertask_1783512016144_4if0hfs4s')
    expect(userTask.userTaskConfig).toMatchObject({
      assignedToRoles: ['Sales Representative'],
      formKey: 'initial_contact_form',
      formSchema: {
        fields: [
          expect.objectContaining({
            name: 'conversation_summary',
            type: 'textarea',
            label: 'Conversation summary',
            required: true,
            placeholder: 'Please fill in the details of the conversation',
          }),
        ],
      },
    })
  })
})
