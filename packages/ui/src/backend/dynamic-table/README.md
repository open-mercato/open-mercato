# DynamicTable

A high-performance, feature-rich data table component for React with virtualization, inline editing, event-driven architecture, and extensive customization options.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Basic Usage](#basic-usage)
- [Props](#props)
- [UI Customization](#tableuiconfig)
- [Column Configuration](#column-configuration)
- [Perspectives](#perspectives)
- [Events System](#events-system)
- [Custom Renderers](#custom-renderers)
- [Custom Editors](#custom-editors)
- [Pagination](#pagination)
- [Context Menus](#context-menus)
- [Debug Mode](#debug-mode)
- [Keyboard Navigation](#keyboard-navigation)
- [Examples](#examples)

## Features

- **Virtualized rendering** - Efficiently handles large datasets using `@tanstack/react-virtual`
- **Inline editing** - Double-click to edit cells with type-specific editors
- **Event-driven architecture** - Decoupled communication via custom events
- **Column types** - Text, numeric, date, dropdown, and boolean
- **Custom renderers** - Full control over cell rendering
- **Custom editors** - Define custom editing experiences
- **Sticky columns** - Pin columns to left or right
- **Column resizing** - Drag to resize columns with immediate visual feedback
- **Perspectives** - Save and switch between table views with custom columns, filters, and sorting
- **Column visibility** - Show/hide columns via the Columns popover
- **Column reordering** - Drag-and-drop to reorder columns
- **Multi-sort** - Sort by multiple columns with priority ordering
- **Filtering** - Build complex filters with debounced input
- **Pagination** - Built-in pagination support
- **Context menus** - Right-click menus for rows and columns
- **Keyboard navigation** - Arrow keys, Enter, Escape support
- **Copy support** - Ctrl+C to copy selected cells
- **Row/column/range selection** - Click and drag to select
- **New row creation** - Add new rows with save/cancel actions
- **Save state indicators** - Visual feedback for saving, success, and error states
- **Debug mode** - Built-in event debugger panel with all events including perspectives
- **Flexible UI customization** - Hide/show components, move toolbar position, add custom content slots
- **Content slots** - Inject custom React components into top bar and bottom bar

## Installation

```tsx
import { DynamicTable } from '@open-mercato/ui/backend/dynamic-table';
```

## Basic Usage

```tsx
import React, { useRef } from 'react';
import { DynamicTable } from '@open-mercato/ui/backend/dynamic-table';

const MyTable = () => {
  const tableRef = useRef<HTMLDivElement>(null);

  const data = [
    { id: 1, name: 'John Doe', email: 'john@example.com', age: 30 },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com', age: 25 },
  ];

  const columns = [
    { data: 'id', title: 'ID', width: 60, readOnly: true },
    { data: 'name', title: 'Name', width: 150 },
    { data: 'email', title: 'Email', width: 200 },
    { data: 'age', title: 'Age', width: 80, type: 'numeric' },
  ];

  return (
    <DynamicTable
      tableRef={tableRef}
      data={data}
      columns={columns}
      tableName="Users"
      height={400}
    />
  );
};
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `tableRef` | `RefObject<HTMLDivElement>` | **required** | Ref to the table container (used for event dispatching) |
| `data` | `any[]` | `[]` | Array of row data objects |
| `columns` | `ColumnDef[]` | `[]` | Column definitions (auto-generated from data if not provided) |
| `colHeaders` | `boolean` | `true` | Show column headers |
| `rowHeaders` | `boolean` | `false` | Show row numbers |
| `height` | `string \| number` | `'auto'` | Table height |
| `width` | `string \| number` | `'auto'` | Table width |
| `idColumnName` | `string` | `'id'` | Name of the ID column (included in edit events) |
| `tableName` | `string` | `'Table Name'` | Default display name (changes to perspective name when one is selected) |
| `columnActions` | `(column, colIndex) => ContextMenuAction[]` | - | Column context menu actions |
| `rowActions` | `(rowData, rowIndex) => ContextMenuAction[]` | - | Row context menu actions |
| `pagination` | `PaginationProps` | - | Pagination configuration |
| `savedPerspectives` | `PerspectiveConfig[]` | `[]` | Pre-saved perspective configurations |
| `activePerspectiveId` | `string \| null` | - | Currently active perspective ID |
| `defaultHiddenColumns` | `string[]` | `[]` | Array of column `data` values to hide by default |
| `debug` | `boolean` | `false` | Enable debug mode with event log panel |
| `uiConfig` | `TableUIConfig` | `{}` | UI visibility configuration (see below) |

### Deprecated Props (Backward Compatible)

| Prop | Type | Description |
|------|------|-------------|
| `savedFilters` | `SavedFilter[]` | Use `savedPerspectives` instead |
| `activeFilterId` | `string \| null` | Use `activePerspectiveId` instead |
| `hiddenColumns` | `string[]` | Use `defaultHiddenColumns` instead |

### TableUIConfig

Control which UI elements are visible and customize the layout:

```typescript
interface TableUIConfig {
  // Visibility options
  hideToolbar?: boolean;        // Hide entire toolbar (title, search, buttons)
  hideSearch?: boolean;         // Hide just the search bar
  hideFilterButton?: boolean;   // Hide the perspective toolbar (Columns, Filter, Sort buttons)
  hideAddRowButton?: boolean;   // Hide the "Add Row" button
  hideBottomBar?: boolean;      // Hide perspective tabs and pagination
  hideActionsColumn?: boolean;  // Hide the Actions column

  // Layout options
  toolbarPosition?: 'top' | 'bottom';  // Position of Columns/Filter/Sort buttons (default: 'top')

  // Custom content slots
  topBarStart?: React.ReactNode;    // Content at the start of top bar (before title)
  topBarEnd?: React.ReactNode;      // Content at the end of top bar (after search/add button)
  bottomBarStart?: React.ReactNode; // Content at the start of bottom bar (before tabs)
  bottomBarEnd?: React.ReactNode;   // Content at the end of bottom bar (after pagination)
}
```

#### Hiding the Actions Column

For read-only tables or when you don't need row actions:

```tsx
<DynamicTable
  uiConfig={{ hideActionsColumn: true }}
  /* ... */
/>
```

#### Moving Toolbar to Bottom

Place the Columns/Filter/Sort buttons in the bottom bar:

```tsx
<DynamicTable
  uiConfig={{ toolbarPosition: 'bottom' }}
  /* ... */
/>
```

#### Adding Custom Content

Add custom buttons or content to the top or bottom bars:

```tsx
<DynamicTable
  uiConfig={{
    // Add a button to the right side of the top bar
    topBarEnd: (
      <Button onClick={() => setDrawerOpen(true)}>
        <Plus className="h-4 w-4 mr-1" />
        New Item
      </Button>
    ),
    // Add custom content to the bottom bar
    bottomBarEnd: (
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm">Export</Button>
        <Button variant="outline" size="sm">Import</Button>
      </div>
    ),
  }}
  /* ... */
/>
```

#### Minimal Table for Detail Views

For embedding tables in detail pages or drawers:

```tsx
<DynamicTable
  uiConfig={{
    hideToolbar: true,
    hideSearch: true,
    hideFilterButton: true,
    hideAddRowButton: true,
    hideBottomBar: true,
    hideActionsColumn: true,
  }}
  height={100}
  /* ... */
/>
```

## Column Configuration

### ColumnDef Interface

```typescript
interface ColumnDef {
  data: string;                    // Property name in row data
  title?: string;                  // Header display text
  width?: number;                  // Column width in pixels
  type?: 'text' | 'numeric' | 'date' | 'dropdown' | 'boolean';
  readOnly?: boolean;              // Prevent editing
  sticky?: 'left' | 'right';       // Pin column to side
  source?: any[];                  // Options for dropdown type
  renderer?: (value, rowData, col, rowIndex, colIndex) => ReactNode;
  editor?: (value, onChange, onSave, onCancel, rowData, col, rowIndex, colIndex) => ReactNode;
}
```

### Column Types

#### Text (default)
```tsx
{ data: 'name', title: 'Name', type: 'text' }
```

#### Numeric
```tsx
{ data: 'age', title: 'Age', type: 'numeric' }
```

#### Date
```tsx
{ data: 'startDate', title: 'Start Date', type: 'date' }
```

#### Dropdown
```tsx
// Simple array
{
  data: 'status',
  title: 'Status',
  type: 'dropdown',
  source: ['Active', 'Inactive', 'Pending']
}

// Object array with value/label
{
  data: 'country',
  title: 'Country',
  type: 'dropdown',
  source: [
    { value: 'US', label: 'United States' },
    { value: 'UK', label: 'United Kingdom' },
  ]
}
```

#### Boolean
```tsx
{ data: 'active', title: 'Active', type: 'boolean' }
```

### Sticky Columns

```tsx
const columns = [
  { data: 'id', title: 'ID', sticky: 'left' },   // Pinned to left
  { data: 'name', title: 'Name' },
  { data: 'actions', title: '', sticky: 'right' } // Pinned to right
];
```

## Perspectives

Perspectives allow users to save and switch between different table views. Each perspective includes:

- **Column visibility** - Which columns are shown/hidden
- **Column order** - The display order of visible columns
- **Filters** - Active filter rules
- **Sorting** - Multi-column sort configuration

### Perspective Toolbar

The toolbar displays three buttons:
- **Columns** - Toggle column visibility and reorder via drag-drop
- **Filter** - Build filter rules with field, operator, and value (with 500ms debounce)
- **Sort** - Configure multi-column sorting with priority

When changes are made, a **Save Perspective** button appears to save the current configuration.

### PerspectiveConfig Interface

```typescript
interface PerspectiveConfig {
  id: string;
  name: string;
  color?: FilterColor;  // 'blue' | 'green' | 'teal' | 'purple' | 'pink' | 'red' | 'orange' | 'yellow'
  columns: {
    visible: string[];  // Column data keys in display order
    hidden: string[];   // Hidden column data keys
  };
  filters: FilterRow[];
  sorting: SortRule[];
}

interface SortRule {
  id: string;
  field: string;
  direction: 'asc' | 'desc';
}

interface FilterRow {
  id: string;
  field: string;
  operator: FilterOperator;
  values: any[];
}
```

### Dynamic Table Title

When a perspective is selected, the table title automatically changes to the perspective name. When "All" is selected (no active perspective), it shows the default `tableName` prop.

### Perspective Tabs

At the bottom of the table, tabs allow switching between:
- **All** - Default view with all columns, no filters, no sorting
- **Saved perspectives** - Click to apply, double-click to rename, X to delete

### Managing Perspectives

```tsx
const [savedPerspectives, setSavedPerspectives] = useState<PerspectiveConfig[]>([]);
const [activePerspectiveId, setActivePerspectiveId] = useState<string | null>(null);

useEventHandlers({
  [TableEvents.PERSPECTIVE_SAVE]: async (payload) => {
    // Save to API
    const saved = await api.savePerspective(payload.perspective);
    setSavedPerspectives(prev => [...prev, saved]);
    setActivePerspectiveId(saved.id);
  },

  [TableEvents.PERSPECTIVE_SELECT]: (payload) => {
    setActivePerspectiveId(payload.id);
    // payload.config contains the full perspective if selected, null if "All"
  },

  [TableEvents.PERSPECTIVE_RENAME]: async (payload) => {
    await api.renamePerspective(payload.id, payload.newName);
    setSavedPerspectives(prev =>
      prev.map(p => p.id === payload.id ? { ...p, name: payload.newName } : p)
    );
  },

  [TableEvents.PERSPECTIVE_DELETE]: async (payload) => {
    await api.deletePerspective(payload.id);
    setSavedPerspectives(prev => prev.filter(p => p.id !== payload.id));
    if (activePerspectiveId === payload.id) {
      setActivePerspectiveId(null);
    }
  },

  [TableEvents.PERSPECTIVE_CHANGE]: (payload) => {
    // Called when columns, filters, or sorting change
    // payload.config contains the changed parts
    console.log('Perspective changed:', payload.config);
  },
}, tableRef);

<DynamicTable
  savedPerspectives={savedPerspectives}
  activePerspectiveId={activePerspectiveId}
  defaultHiddenColumns={['internalId', 'createdAt']}
  /* ... */
/>
```

## Events System

DynamicTable uses a custom event system for decoupled communication. Events are dispatched on the table container element and can be listened to using the provided hooks.

### Available Events

```typescript
const TableEvents = {
  // Cell editing
  CELL_EDIT_SAVE: 'table:cell:edit:save',
  CELL_SAVE_START: 'table:cell:save:start',
  CELL_SAVE_SUCCESS: 'table:cell:save:success',
  CELL_SAVE_ERROR: 'table:cell:save:error',

  // New row
  NEW_ROW_SAVE: 'table:new:row:save',
  NEW_ROW_SAVE_START: 'table:new:row:save:start',
  NEW_ROW_SAVE_SUCCESS: 'table:new:row:save:success',
  NEW_ROW_SAVE_ERROR: 'table:new:row:save:error',

  // Perspectives
  PERSPECTIVE_SAVE: 'table:perspective:save',
  PERSPECTIVE_SELECT: 'table:perspective:select',
  PERSPECTIVE_RENAME: 'table:perspective:rename',
  PERSPECTIVE_DELETE: 'table:perspective:delete',
  PERSPECTIVE_CHANGE: 'table:perspective:change',

  // Filtering (legacy - still emitted for backward compatibility)
  FILTER_CHANGE: 'table:filter:change',
  FILTER_SAVE: 'table:filter:save',
  FILTER_SELECT: 'table:filter:select',
  FILTER_RENAME: 'table:filter:rename',
  FILTER_DELETE: 'table:filter:delete',

  // Sorting & Search
  COLUMN_SORT: 'table:column:sort',
  SEARCH: 'table:search',

  // Context menus
  COLUMN_CONTEXT_MENU_ACTION: 'table:column:context:action',
  ROW_CONTEXT_MENU_ACTION: 'table:row:context:action',
};
```

### Event Payloads

#### CellEditSaveEvent
```typescript
interface CellEditSaveEvent {
  rowIndex: number;
  colIndex: number;
  oldValue: any;
  newValue: any;
  prop: string;      // Column data property name
  rowData: any;      // Full row data
  id?: string;       // Row ID (from idColumnName)
}
```

#### NewRowSaveEvent
```typescript
interface NewRowSaveEvent {
  rowIndex: number;
  rowData: any;
}
```

#### PerspectiveSaveEvent
```typescript
interface PerspectiveSaveEvent {
  perspective: PerspectiveConfig;  // Full perspective config ready for API
}
```

#### PerspectiveSelectEvent
```typescript
interface PerspectiveSelectEvent {
  id: string | null;
  config: PerspectiveConfig | null;
}
```

#### PerspectiveChangeEvent
```typescript
interface PerspectiveChangeEvent {
  config: Partial<PerspectiveConfig>;  // Only changed parts
}
```

#### ColumnSortEvent
```typescript
interface ColumnSortEvent {
  columnIndex: number;
  columnName: string;
  direction: 'asc' | 'desc' | null;
}
```

#### FilterChangeEvent
```typescript
interface FilterChangeEvent {
  filters: FilterRow[];
  savedFilterId?: string | null;
}
```

### Listening to Events

Use the `useEventHandlers` hook to listen to multiple events:

```tsx
import { useEventHandlers, dispatch, TableEvents } from '@open-mercato/ui/backend/dynamic-table';

const MyTable = () => {
  const tableRef = useRef<HTMLDivElement>(null);

  useEventHandlers({
    [TableEvents.CELL_EDIT_SAVE]: async (payload) => {
      dispatch(tableRef.current!, TableEvents.CELL_SAVE_START, {
        rowIndex: payload.rowIndex,
        colIndex: payload.colIndex,
      });

      const result = await saveToApi(payload);

      if (result.ok) {
        dispatch(tableRef.current!, TableEvents.CELL_SAVE_SUCCESS, {
          rowIndex: payload.rowIndex,
          colIndex: payload.colIndex,
        });
      } else {
        dispatch(tableRef.current!, TableEvents.CELL_SAVE_ERROR, {
          rowIndex: payload.rowIndex,
          colIndex: payload.colIndex,
          error: result.error,
        });
      }
    },

    [TableEvents.PERSPECTIVE_SAVE]: async (payload) => {
      await api.savePerspective(payload.perspective);
    },

    [TableEvents.COLUMN_SORT]: (payload) => {
      console.log('Sort:', payload.columnName, payload.direction);
    },

    [TableEvents.SEARCH]: (payload) => {
      console.log('Search:', payload.query);
    },
  }, tableRef);

  return <DynamicTable tableRef={tableRef} /* ... */ />;
};
```

### Dispatching Events

```tsx
import { dispatch, TableEvents } from '@open-mercato/ui/backend/dynamic-table';

// Dispatch a save success event
dispatch(tableRef.current!, TableEvents.CELL_SAVE_SUCCESS, {
  rowIndex: 0,
  colIndex: 1,
});
```

## Custom Renderers

Custom renderers allow you to control how cell values are displayed:

```tsx
const columns = [
  {
    data: 'salary',
    title: 'Salary',
    renderer: (value: number) => `$${value.toLocaleString()}`,
  },
  {
    data: 'status',
    title: 'Status',
    renderer: (value: string, rowData: any) => (
      <span style={{
        padding: '2px 8px',
        borderRadius: 4,
        background: value === 'Active' ? '#d1fae5' : '#fee2e2',
        color: value === 'Active' ? '#059669' : '#dc2626',
      }}>
        {value}
      </span>
    ),
  },
];
```

### Renderer Function Signature

```typescript
renderer: (
  value: any,           // Cell value
  rowData: any,         // Full row data object
  col: ColumnDef,       // Column definition
  rowIndex: number,     // Row index
  colIndex: number      // Column index
) => React.ReactNode;
```

## Custom Editors

Custom editors allow you to define custom editing experiences:

```tsx
const columns = [
  {
    data: 'color',
    title: 'Color',
    editor: (value, onChange, onSave, onCancel) => (
      <div style={{ display: 'flex', gap: 4 }}>
        {['red', 'green', 'blue'].map(color => (
          <button
            key={color}
            onClick={() => { onChange(color); onSave(); }}
            style={{
              width: 24,
              height: 24,
              background: color,
              border: value === color ? '2px solid black' : 'none',
            }}
          />
        ))}
        <button onClick={onCancel}>Cancel</button>
      </div>
    ),
  },
];
```

### Editor Function Signature

```typescript
editor: (
  value: any,                        // Current cell value
  onChange: (newValue: any) => void, // Update value
  onSave: () => void,                // Commit changes
  onCancel: () => void,              // Cancel editing
  rowData: any,                      // Full row data
  col: ColumnDef,                    // Column definition
  rowIndex: number,                  // Row index
  colIndex: number                   // Column index
) => React.ReactNode;
```

## Pagination

```tsx
const [currentPage, setCurrentPage] = useState(1);
const [limit, setLimit] = useState(25);
const totalPages = Math.ceil(totalCount / limit);

<DynamicTable
  data={paginatedData}
  pagination={{
    currentPage,
    totalPages,
    limit,
    limitOptions: [10, 25, 50, 100],
    onPageChange: (page) => setCurrentPage(page),
    onLimitChange: (newLimit) => {
      setLimit(newLimit);
      setCurrentPage(1);
    },
  }}
/>
```

### PaginationProps Interface

```typescript
interface PaginationProps {
  currentPage: number;
  totalPages: number;
  limit: number;
  limitOptions?: number[];
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}
```

## Context Menus

### Column Context Menu

Double-click on column headers to show custom actions:

```tsx
const columnActions = (column: ColumnDef, colIndex: number): ContextMenuAction[] => [
  { id: 'sort-asc', label: 'Sort Ascending', icon: '↑' },
  { id: 'sort-desc', label: 'Sort Descending', icon: '↓' },
  { id: 'separator', label: '', separator: true },
  { id: 'hide', label: 'Hide Column' },
];

useEventHandlers({
  [TableEvents.COLUMN_CONTEXT_MENU_ACTION]: (payload) => {
    if (payload.actionId === 'hide') {
      // Handle hiding column
    }
  },
}, tableRef);

<DynamicTable columnActions={columnActions} /* ... */ />
```

### Row Context Menu

Double-click on row headers to show custom actions:

```tsx
const rowActions = (rowData: any, rowIndex: number): ContextMenuAction[] => [
  { id: 'edit', label: 'Edit Row' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'separator', label: '', separator: true },
  { id: 'delete', label: 'Delete Row' },
];

useEventHandlers({
  [TableEvents.ROW_CONTEXT_MENU_ACTION]: (payload) => {
    if (payload.actionId === 'delete') {
      await deleteRow(payload.rowData.id);
    }
  },
}, tableRef);

<DynamicTable rowActions={rowActions} rowHeaders={true} /* ... */ />
```

### ContextMenuAction Interface

```typescript
interface ContextMenuAction {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  separator?: boolean;  // Renders a divider line
}
```

## Debug Mode

Enable debug mode to see a floating event log panel:

```tsx
<DynamicTable debug={true} /* ... */ />
```

Features:
- Click the bug icon (bottom-right) to open/close the panel
- All table events are logged in real-time, including perspective events
- Click any event to expand and see the full payload
- Color-coded events for easy identification
- Clear button to reset the log

Events tracked in debug mode:
- Cell events (edit, save start/success/error)
- New row events
- Perspective events (save, select, rename, delete, change)
- Filter events (legacy)
- Sort and search events
- Context menu actions

## Keyboard Navigation

| Key | Action |
|-----|--------|
| Arrow keys | Navigate between cells |
| Enter | Start editing / Confirm edit |
| Escape | Cancel editing |
| Tab | Move to next cell |
| Shift+Tab | Move to previous cell |
| Ctrl+C | Copy selected cells |

## Examples

### Complete Example with Perspectives

```tsx
import React, { useState, useRef } from 'react';
import {
  DynamicTable,
  useEventHandlers,
  dispatch,
  TableEvents,
  ColumnDef,
  PerspectiveConfig,
} from '@open-mercato/ui/backend/dynamic-table';

const EmployeeTable = () => {
  const tableRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [savedPerspectives, setSavedPerspectives] = useState<PerspectiveConfig[]>([]);
  const [activePerspectiveId, setActivePerspectiveId] = useState<string | null>(null);

  const columns: ColumnDef[] = [
    { data: 'id', title: 'ID', width: 60, readOnly: true, sticky: 'left' },
    { data: 'name', title: 'Name', width: 150 },
    { data: 'email', title: 'Email', width: 200 },
    { data: 'department', title: 'Department', type: 'dropdown', source: ['Engineering', 'Sales', 'HR'] },
    { data: 'country', title: 'Country', width: 120 },
    { data: 'startDate', title: 'Start Date', type: 'date', width: 120 },
    { data: 'salary', title: 'Salary', type: 'numeric', renderer: (v) => `$${v?.toLocaleString()}` },
    { data: 'status', title: 'Status', type: 'dropdown', source: ['Active', 'Inactive', 'On Leave'] },
  ];

  useEventHandlers({
    // Cell editing
    [TableEvents.CELL_EDIT_SAVE]: async (payload) => {
      dispatch(tableRef.current!, TableEvents.CELL_SAVE_START, payload);
      try {
        await api.updateEmployee(payload.id, { [payload.prop]: payload.newValue });
        dispatch(tableRef.current!, TableEvents.CELL_SAVE_SUCCESS, payload);
      } catch (error) {
        dispatch(tableRef.current!, TableEvents.CELL_SAVE_ERROR, { ...payload, error: error.message });
      }
    },

    // New row
    [TableEvents.NEW_ROW_SAVE]: async (payload) => {
      try {
        const saved = await api.createEmployee(payload.rowData);
        dispatch(tableRef.current!, TableEvents.NEW_ROW_SAVE_SUCCESS, {
          rowIndex: payload.rowIndex,
          savedRowData: saved,
        });
      } catch (error) {
        dispatch(tableRef.current!, TableEvents.NEW_ROW_SAVE_ERROR, {
          rowIndex: payload.rowIndex,
          error: error.message,
        });
      }
    },

    // Perspectives
    [TableEvents.PERSPECTIVE_SAVE]: async (payload) => {
      const saved = await api.savePerspective(payload.perspective);
      setSavedPerspectives(prev => [...prev, saved]);
      setActivePerspectiveId(saved.id);
    },

    [TableEvents.PERSPECTIVE_SELECT]: (payload) => {
      setActivePerspectiveId(payload.id);
    },

    [TableEvents.PERSPECTIVE_RENAME]: async (payload) => {
      await api.renamePerspective(payload.id, payload.newName);
      setSavedPerspectives(prev =>
        prev.map(p => p.id === payload.id ? { ...p, name: payload.newName } : p)
      );
    },

    [TableEvents.PERSPECTIVE_DELETE]: async (payload) => {
      await api.deletePerspective(payload.id);
      setSavedPerspectives(prev => prev.filter(p => p.id !== payload.id));
      if (activePerspectiveId === payload.id) {
        setActivePerspectiveId(null);
      }
    },

    // Sorting
    [TableEvents.COLUMN_SORT]: (payload) => {
      fetchData({ sort: payload.columnName, order: payload.direction });
    },

    // Search
    [TableEvents.SEARCH]: (payload) => {
      fetchData({ search: payload.query });
    },

    // Filter changes (from perspective)
    [TableEvents.FILTER_CHANGE]: (payload) => {
      fetchData({ filters: payload.filters });
    },
  }, tableRef);

  return (
    <DynamicTable
      tableRef={tableRef}
      data={data}
      columns={columns}
      tableName="Employees"
      height={600}
      rowHeaders={true}
      idColumnName="id"
      pagination={{
        currentPage,
        totalPages: Math.ceil(totalCount / limit),
        limit,
        limitOptions: [10, 25, 50, 100],
        onPageChange: setCurrentPage,
        onLimitChange: (l) => { setLimit(l); setCurrentPage(1); },
      }}
      savedPerspectives={savedPerspectives}
      activePerspectiveId={activePerspectiveId}
      defaultHiddenColumns={['createdAt', 'updatedAt']}
      columnActions={(col) => [
        { id: 'sort-asc', label: 'Sort A-Z' },
        { id: 'sort-desc', label: 'Sort Z-A' },
      ]}
      rowActions={(row) => [
        { id: 'edit', label: 'Edit' },
        { id: 'delete', label: 'Delete' },
      ]}
      debug={process.env.NODE_ENV === 'development'}
    />
  );
};
```

## Exports

```tsx
// Main component
export { DynamicTable } from './DynamicTable';

// Skeleton loader
export { TableSkeleton } from './components/TableSkeleton';

// Debugger (standalone)
export { Debugger } from './components/Debugger';

// Store
export { createCellStore } from './store';
export type { CellStore } from './store';

// Hooks
export {
  CellStoreContext,
  useCellStore,
  useCellState,
  useStoreRevision,
  useSelectionRevision,
  useSelection,
  useDragHandling,
  useKeyboardNavigation,
  useCopyHandler,
  useStickyOffsets,
} from './hooks';

// Events
export { dispatch, useMediator, useListener, useEventHandlers } from './events/events';

// Types
export * from './types';
export * from './types/perspective';

// Validators
export * from './validators';
```
