import * as React from 'react'
import { BoardScreen } from '../demos/screens/board'
import { RecordDetailScreen } from '../demos/screens/record-detail'
import { RecordFormScreen } from '../demos/screens/record-form'
import { RecordListScreen } from '../demos/screens/record-list'
import { SetupWizardScreen } from '../demos/screens/setup-wizard'
import type { GalleryEntry } from '../types'
import { boardCode, recordDetailCode, recordFormCode, recordListCode, setupWizardCode } from './screens-snippets'

const recordListEntry: GalleryEntry = {
  id: 'screen-record-list',
  title: 'Record list',
  importPath: 'packages/core/src/modules/design_system/gallery/demos/screens/record-list.tsx',
  descriptionKey: 'design_system.entries.screen-record-list.description',
  keywords: ['screen', 'page', 'list', 'table', 'index', 'search', 'filters', 'bulk actions', 'selection', 'composition'],
  usage: {
    do: [
      'Start here for any page whose job is to find records and act on several at once',
      'Keep search, filters, the active view and the selection in the page and pass them down to the blocks',
      'Replace the fixture rows with your query result and keep the checkbox column first',
      'Give the header one primary action; put import, export and column settings in the toolbar',
      'Reserve space under the list while the bulk bar is shown so it never covers the last row',
    ],
    dont: [
      'Do not show the record count in the header, the toolbar and a table footer at once',
      'Do not keep rows selected that the current filters hide',
      'Do not run a destructive bulk action without asking first',
    ],
  },
  accessibility: [
    'Render the screen inside the main landmark of the app; the header title is the only h1',
    'The toolbar and the bulk bar are separate toolbars, so each one has its own label',
    'The table has a name, the header checkbox selects every visible row and reports a partial selection as mixed',
    'The bulk bar appears without taking focus and announces the selection count; Escape clears the selection',
    'When filters leave no rows, the empty state names the reason and offers one button that restores the list',
  ],
  variants: [
    {
      id: 'default',
      title: 'Default',
      description: 'Search, quick filters and the view switch work on local rows. Select rows to show the bulk bar.',
      render: () => <RecordListScreen />,
      code: recordListCode(),
    },
    {
      id: 'filtered-with-selection',
      title: 'Applied filters and selection',
      description: 'Two applied filters narrow the list and two rows are selected, so the bulk bar is visible.',
      render: () => <RecordListScreen initialChipIds={['priority-high', 'due-soon']} initialSelectedIds={['req-1041', 'req-1038']} />,
      code: recordListCode({ chips: true, selected: true }),
    },
    {
      id: 'empty-results',
      title: 'Empty results',
      description: 'The search and filters match nothing. The button in the empty state clears them.',
      render: () => <RecordListScreen initialQuery="warranty" initialChipIds={['priority-high']} />,
      code: recordListCode({ query: 'warranty', chips: true, empty: true }),
    },
  ],
}

const recordDetailEntry: GalleryEntry = {
  id: 'screen-record-detail',
  title: 'Record detail',
  importPath: 'packages/core/src/modules/design_system/gallery/demos/screens/record-detail.tsx',
  descriptionKey: 'design_system.entries.screen-record-detail.description',
  keywords: ['screen', 'page', 'detail', 'record', 'tabs', 'overview', 'activity', 'history', 'composition'],
  usage: {
    do: [
      'Start here for a page about one record: who or what it is, its fields and what happened to it',
      'Pass tabs to the header as data and render the active panel yourself below it',
      'Replace the field list and the activity items with your record data',
      'Let people edit single fields in place and move long forms to an edit page',
      'Pass the same status to every block while the record loads so the page keeps its shape',
    ],
    dont: [
      'Do not repeat header facts such as the owner or the status inside the field list',
      'Do not add a second row of tabs under the header',
      'Do not put more than one primary action in the header',
    ],
  },
  accessibility: [
    'The header title is the h1 and each section in a panel starts with an h2',
    'The tabs follow the tablist pattern; give the panel the ids from entityHeaderTabIds so the active tab names it',
    'Arrow keys move between tabs and the panel is the next stop in the tab order',
    'An edited field returns focus to its edit button after saving or cancelling',
    'While loading, every block marks itself busy and exposes one "Loading" text to screen readers',
  ],
  variants: [
    {
      id: 'default',
      title: 'Default',
      description: 'The overview tab: editable fields next to the three latest events.',
      render: () => <RecordDetailScreen />,
      code: recordDetailCode(),
    },
    {
      id: 'activity',
      title: 'Activity tab',
      description: 'The full history, grouped by day, with a filter by kind of event.',
      render: () => <RecordDetailScreen initialTab="activity" />,
      code: recordDetailCode({ tab: 'activity' }),
    },
    {
      id: 'loading',
      title: 'Loading',
      description: 'The header, the field list and the timeline each show their own loading state.',
      render: () => <RecordDetailScreen loading />,
      code: recordDetailCode({ loading: true }),
    },
  ],
}

const recordFormEntry: GalleryEntry = {
  id: 'screen-record-form',
  title: 'Record form',
  importPath: 'packages/core/src/modules/design_system/gallery/demos/screens/record-form.tsx',
  descriptionKey: 'design_system.entries.screen-record-form.description',
  keywords: ['screen', 'page', 'form', 'edit', 'save', 'unsaved changes', 'sections', 'composition'],
  usage: {
    do: [
      'Start here for an edit page with a handful of sections and one save for the whole form',
      'Compare the draft with the last saved values and derive the save state from that',
      'Point the save bar at the form with formId so Enter in a field and the Save button do the same thing',
      'Replace the sections and fields with your own; keep one topic per section',
      'Add bottom space while the floating bar is visible so it never covers the last field',
    ],
    dont: [
      'Do not add a second Save button in the header or at the end of the form',
      'Do not clear what the person typed when saving fails',
      'Do not use this page for a form that fits in a dialog',
    ],
  },
  accessibility: [
    'The header title is the h1 and every form section is a labelled region with an h2',
    'Each field has a visible label; a required field is marked and its error is tied to the input',
    'The save bar appears without taking focus and announces "Unsaved changes", "Saving" and "Saved"',
    'A failed save is announced as an alert and the typed values stay in the form',
    'When the bar hides after Reset or a save, focus returns to the form',
  ],
  variants: [
    {
      id: 'clean',
      title: 'Clean',
      description: 'Nothing has changed, so there is no save bar. Edit any field to show it.',
      render: () => <RecordFormScreen />,
      code: recordFormCode(),
    },
    {
      id: 'unsaved-changes',
      title: 'Unsaved changes',
      description: 'Save takes a moment and then confirms. Reset restores the last saved values.',
      render: () => <RecordFormScreen initial="dirty" />,
      code: recordFormCode({ initial: 'dirty' }),
    },
    {
      id: 'save-failed',
      title: 'Save failed',
      description: 'The changes stay in the form and Save can be tried again.',
      render: () => <RecordFormScreen initial="failed" />,
      code: recordFormCode({ initial: 'failed' }),
    },
  ],
}

const boardEntry: GalleryEntry = {
  id: 'screen-board',
  title: 'Pipeline board',
  importPath: 'packages/core/src/modules/design_system/gallery/demos/screens/board.tsx',
  descriptionKey: 'design_system.entries.screen-board.description',
  keywords: ['screen', 'page', 'board', 'kanban', 'pipeline', 'stages', 'drag and drop', 'composition'],
  usage: {
    do: [
      'Start here when records move through a short, fixed set of stages',
      'Keep the same header and toolbar as the table view so switching views changes only the body',
      'Filter the cards in the page and pass the filtered columns to the board',
      'Show a count and one summary per column, computed from the cards you pass',
      'Load columns separately and give each one its own loading and error state',
    ],
    dont: [
      'Do not use a board for more than about seven stages; use the table view instead',
      'Do not add a bulk bar here; cards are moved one at a time',
      'Do not block the whole board when one column fails to load',
    ],
  },
  accessibility: [
    'The header title is the h1 and every column title is an h3 inside the board',
    'Cards can be moved without a pointer through the move menu on each card',
    'Every move is announced through a live region with the card and the target stage',
    'A column that fails shows its own message and a retry button; the other columns stay usable',
    'On phones columns snap one at a time and the board scrolls sideways inside its own area',
  ],
  variants: [
    {
      id: 'default',
      title: 'Default',
      description: 'Drag a card to another stage; the counts and totals follow. The view switch shows the same deals as a table.',
      render: () => <BoardScreen />,
      code: boardCode(),
    },
    {
      id: 'column-states',
      title: 'Column loading and error',
      description: 'One stage failed and one is still loading. Try again reloads them.',
      render: () => <BoardScreen initialColumnStates={{ new: 'error', qualified: 'loading' }} />,
      code: boardCode({ columnStates: true }),
    },
  ],
}

const setupWizardEntry: GalleryEntry = {
  id: 'screen-setup-wizard',
  title: 'Setup wizard',
  importPath: 'packages/core/src/modules/design_system/gallery/demos/screens/setup-wizard.tsx',
  descriptionKey: 'design_system.entries.screen-setup-wizard.description',
  keywords: ['screen', 'page', 'wizard', 'steps', 'setup', 'onboarding', 'multi-step', 'result', 'composition'],
  usage: {
    do: [
      'Start here when setup needs three to five steps that depend on each other',
      'Keep every value in the page so going back never loses what was typed',
      'Validate the current step in onNext and return false to stay on it',
      'Finish with a result that says what was created and what to do next',
      'Replace the fields in each step and keep the last step as a review',
    ],
    dont: [
      'Do not split a short form into steps; use the record form screen',
      'Do not let people skip ahead past a step that has not been checked',
      'Do not repeat the step title in the page header',
    ],
  },
  accessibility: [
    'The header title is the h1 and the active step title is the h2',
    'Moving to another step puts focus on the step content so the new title is read',
    'A step with a problem is listed in an alert above the fields and the field carries its own message',
    'Next and Finish show a pending state while their promise runs and cannot be pressed twice',
    'The final result moves focus to its title',
  ],
  variants: [
    {
      id: 'first-step',
      title: 'First step',
      description: 'Enter a name to continue. Finishing the last step shows the result.',
      render: () => <SetupWizardScreen />,
      code: setupWizardCode(),
    },
    {
      id: 'step-error',
      title: 'Step with an error',
      description: 'The email address is incomplete, so Next keeps the person on this step.',
      render: () => <SetupWizardScreen initial="step-error" />,
      code: setupWizardCode({ stepError: true }),
    },
  ],
}

export const entries: GalleryEntry[] = [recordListEntry, recordDetailEntry, recordFormEntry, boardEntry, setupWizardEntry]
