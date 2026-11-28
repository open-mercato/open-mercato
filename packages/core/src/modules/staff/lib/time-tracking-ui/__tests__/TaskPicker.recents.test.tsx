/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { TaskPicker, type TaskPickerItem } from '../TaskPicker'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

function task(id: string, title: string, projectId: string): TaskPickerItem {
  return {
    id,
    reference: id.toUpperCase(),
    title,
    projectId,
    projectName: projectId,
    customerName: null,
    statusId: null,
    assigneeInitials: null,
    assigneeName: null,
    loggedMinutes: null,
  }
}

const items: TaskPickerItem[] = [
  task('a-1', 'Alpha one', 'alpha'),
  task('a-2', 'Alpha two', 'alpha'),
  task('b-1', 'Bench', 'beta'),
]

/**
 * A recent task is listed twice: once under Recent and again under its project.
 * Both rows hold the same item, so anything that finds a row by item rather than
 * by position lands on the Recent copy at the top of the list.
 */
describe('TaskPicker — a task listed under Recent and under its project', () => {
  const scrollIntoView = jest.fn()

  beforeAll(() => {
    Element.prototype.scrollIntoView = scrollIntoView
  })

  beforeEach(() => {
    scrollIntoView.mockClear()
  })

  it('keeps the hovered project row active instead of scrolling to its Recent copy', () => {
    render(<TaskPicker value={null} onChange={() => {}} items={items} recentTaskIds={['b-1']} />)
    fireEvent.focus(screen.getByTestId('task-picker-input'))

    const [recentRow, projectRow] = screen.getAllByTestId('task-picker-option-b-1')
    scrollIntoView.mockClear()
    fireEvent.mouseEnter(projectRow)

    expect(projectRow).toHaveAttribute('data-active', 'true')
    expect(recentRow).toHaveAttribute('data-active', 'false')
    expect(scrollIntoView.mock.contexts).not.toContain(recentRow)
  })

  it('counts each task once in the footer', () => {
    render(<TaskPicker value={null} onChange={() => {}} items={items} recentTaskIds={['b-1']} />)
    fireEvent.focus(screen.getByTestId('task-picker-input'))

    expect(screen.getByText('3 of 3')).toBeInTheDocument()
  })
})
