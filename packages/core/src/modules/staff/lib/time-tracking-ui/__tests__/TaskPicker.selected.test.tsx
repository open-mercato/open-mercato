/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import { TaskPicker, type TaskPickerItem } from '../TaskPicker'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

function item(overrides: Partial<TaskPickerItem> = {}): TaskPickerItem {
  return {
    id: 'task-1',
    reference: 'AWR-6',
    title: 'Migracja koszyka B2B',
    projectId: 'project-1',
    projectName: 'migracja B2B',
    customerName: 'Nordvik',
    statusId: null,
    assigneeInitials: null,
    assigneeName: null,
    loggedMinutes: null,
    ...overrides,
  }
}

function renderSelected(selected: TaskPickerItem, scopedProjectName?: string | null) {
  return render(
    <TaskPicker value={selected.id} onChange={jest.fn()} items={[selected]} scopedProjectName={scopedProjectName} />,
  )
}

describe('TaskPicker — the chosen task', () => {
  it('keeps the title, the project and the Change action inside one box', () => {
    renderSelected(item())

    const box = screen.getByTestId('task-picker-selected')
    expect(within(box).getByText('Migracja koszyka B2B')).toHaveAttribute('title', 'Migracja koszyka B2B')
    const project = within(box).getByTestId('task-picker-selected-project')
    expect(project.textContent).toBe('migracja B2B · Nordvik')
    expect(project).toHaveAttribute('title', 'migracja B2B · Nordvik')
    expect(project.className.split(/\s+/)).toContain('truncate')
    expect(within(box).getByTestId('task-picker-change')).toBeInTheDocument()
  })

  it('names only the project when it has no customer', () => {
    renderSelected(item({ customerName: null }))

    expect(screen.getByTestId('task-picker-selected-project').textContent).toBe('migracja B2B')
  })

  it('drops the project line when the picker is already scoped to that project', () => {
    renderSelected(item(), 'migracja B2B')

    expect(screen.getByTestId('task-picker-selected')).toBeInTheDocument()
    expect(screen.queryByTestId('task-picker-selected-project')).toBeNull()
  })

  it('drops the project line when the task has no project', () => {
    renderSelected(item({ projectId: null, projectName: null, customerName: null }))

    expect(screen.queryByTestId('task-picker-selected-project')).toBeNull()
  })
})
