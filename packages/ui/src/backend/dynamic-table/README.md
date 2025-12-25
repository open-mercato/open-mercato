# DynamicTable

A high-performance, feature-rich data table component for React with virtualization, inline editing, event-driven architecture, and extensive customization options.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Basic Usage](#basic-usage)
- [Props](#props)
- [Column Configuration](#column-configuration)
- [Events System](#events-system)
- [Custom Renderers](#custom-renderers)
- [Custom Editors](#custom-editors)
- [Filtering](#filtering)
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
- **Column resizing** - Drag to resize columns
- **Sorting** - Click headers to sort
- **Filtering** - Build and save complex filters
- **Pagination** - Built-in pagination support
- **Context menus** - Right-click menus for rows and columns
- **Keyboard navigation** - Arrow keys, Enter, Escape support
- **Copy support** - Ctrl+C to copy selected cells
- **Row/column/range selection** - Click and drag to select
- **New row creation** - Add new rows with save/cancel actions
- **Save state indicators** - Visual feedback for saving, success, and error states
- **Debug mode** - Built-in event debugger panel

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
| `tableName` | `string` | `'Table Name'` | Display name shown in toolbar |
| `columnActions` | `(column, colIndex) => ContextMenuAction[]` | - | Column context menu actions |
| `rowActions` | `(rowData, rowIndex) => ContextMenuAction[]` | - | Row context menu actions |
| `pagination` | `PaginationProps` | - | Pagination configuration |
| `savedFilters` | `SavedFilter[]` | `[]` | Pre-saved filter configurations |
| `activeFilterId` | `string \| null` | - | Currently active filter ID |
| `hiddenColumns` | `string[]` | `[]` | Array of column `data` values to hide |
| `debug` | `boolean` | `false` | Enable debug mode with event log panel |
| `uiConfig` | `TableUIConfig` | `{}` | UI visibility configuration (see below) |

### TableUIConfig

Control which UI elements are visible:

```typescript
interface TableUIConfig {
  hideToolbar?: boolean;      // Hide entire toolbar (title, search, buttons)
  hideSearch?: boolean;       // Hide just the search bar
  hideFilterButton?: boolean; // Hide the "Build Filter" button
  hideAddRowButton?: boolean; // Hide the "Add Row" button
  hideBottomBar?: boolean;    // Hide filter tabs and pagination
}
```

#### Examples

```tsx
// Minimal table - only data, no chrome
<DynamicTable
  tableRef={tableRef}
  data={data}
  columns={columns}
  uiConfig={{
    hideToolbar: true,
    hideBottomBar: true,
  }}
/>

// Search only - no filters or add row
<DynamicTable
  tableRef={tableRef}
  data={data}
  columns={columns}
  uiConfig={{
    hideFilterButton: true,
    hideAddRowButton: true,
    hideBottomBar: true,
  }}
/>

// Read-only view with pagination
<DynamicTable
  tableRef={tableRef}
  data={data}
  columns={columns}
  pagination={paginationConfig}
  uiConfig={{
    hideSearch: true,
    hideFilterButton: true,
    hideAddRowButton: true,
  }}
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

### Hidden Columns

```tsx
<DynamicTable
  columns={columns}
  hiddenColumns={['internalId', 'createdAt', 'updatedAt']}
/>
```

## Events System

DynamicTable uses a custom event system for decoupled communication. Events are dispatched on the table container element and can be listened to using the provided hooks.

### Available Events

```typescript
const TableEvents = {
  // Cell editing
  CELL_EDIT_SAVE: 'table:cell:edit:save',      // Cell value changed
  CELL_SAVE_START: 'table:cell:save:start',    // Start saving indicator
  CELL_SAVE_SUCCESS: 'table:cell:save:success', // Save succeeded
  CELL_SAVE_ERROR: 'table:cell:save:error',    // Save failed

  // New row
  NEW_ROW_SAVE: 'table:new:row:save',          // New row save requested
  NEW_ROW_SAVE_START: 'table:new:row:save:start',
  NEW_ROW_SAVE_SUCCESS: 'table:new:row:save:success',
  NEW_ROW_SAVE_ERROR: 'table:new:row:save:error',

  // Filtering
  FILTER_CHANGE: 'table:filter:change',        // Filter criteria changed
  FILTER_SAVE: 'table:filter:save',            // Filter saved
  FILTER_SELECT: 'table:filter:select',        // Filter tab selected
  FILTER_RENAME: 'table:filter:rename',        // Filter renamed
  FILTER_DELETE: 'table:filter:delete',        // Filter deleted

  // Sorting & Search
  COLUMN_SORT: 'table:column:sort',            // Column sort changed
  SEARCH: 'table:search',                      // Search query changed

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
      // Show saving indicator
      dispatch(tableRef.current!, TableEvents.CELL_SAVE_START, {
        rowIndex: payload.rowIndex,
        colIndex: payload.colIndex,
      });

      // Call your API
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
  {
    data: '_actions',
    title: '',
    readOnly: true,
    renderer: (_value: any, rowData: any) => (
      <button onClick={() => openDetails(rowData)}>
        View
      </button>
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

## Filtering

### Filter Builder

The table includes a built-in filter builder accessible via the "Build Filter" button. Users can:

- Add multiple filter conditions
- Select field, operator, and values
- Save filters for reuse
- Switch between saved filters via tabs

### Filter Events

```tsx
useEventHandlers({
  [TableEvents.FILTER_CHANGE]: (payload) => {
    // Called whenever filter criteria changes
    console.log('Filters:', payload.filters);
    console.log('Active filter ID:', payload.savedFilterId);
    // Typically used to refetch data with new filters
  },

  [TableEvents.FILTER_SAVE]: (payload) => {
    // Called when user saves a new filter
    // Persist to your backend
    await saveFilter(payload.filter);
  },

  [TableEvents.FILTER_SELECT]: (payload) => {
    // Called when user selects a saved filter tab
    setActiveFilterId(payload.id);
  },

  [TableEvents.FILTER_RENAME]: (payload) => {
    // Called when user renames a filter
    await renameFilter(payload.id, payload.newName);
  },

  [TableEvents.FILTER_DELETE]: (payload) => {
    // Called when user deletes a filter
    await deleteFilter(payload.id);
  },
}, tableRef);
```

### Managing Saved Filters

```tsx
const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
const [activeFilterId, setActiveFilterId] = useState<string | null>(null);

useEventHandlers({
  [TableEvents.FILTER_SAVE]: (payload) => {
    setSavedFilters(prev => [...prev, payload.filter]);
    setActiveFilterId(payload.filter.id);
  },
  [TableEvents.FILTER_SELECT]: (payload) => {
    setActiveFilterId(payload.id);
  },
  [TableEvents.FILTER_DELETE]: (payload) => {
    setSavedFilters(prev => prev.filter(f => f.id !== payload.id));
    if (activeFilterId === payload.id) setActiveFilterId(null);
  },
}, tableRef);

<DynamicTable
  savedFilters={savedFilters}
  activeFilterId={activeFilterId}
  /* ... */
/>
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

Right-click on column headers to show custom actions:

```tsx
const columnActions = (column: ColumnDef, colIndex: number): ContextMenuAction[] => [
  { id: 'sort-asc', label: 'Sort Ascending', icon: '↑' },
  { id: 'sort-desc', label: 'Sort Descending', icon: '↓' },
  { id: 'separator', label: '', separator: true },
  { id: 'hide', label: 'Hide Column', icon: '👁' },
];

useEventHandlers({
  [TableEvents.COLUMN_CONTEXT_MENU_ACTION]: (payload) => {
    if (payload.actionId === 'hide') {
      setHiddenColumns(prev => [...prev, payload.columnName]);
    }
  },
}, tableRef);

<DynamicTable columnActions={columnActions} /* ... */ />
```

### Row Context Menu

Double-click on row headers to show custom actions:

```tsx
const rowActions = (rowData: any, rowIndex: number): ContextMenuAction[] => [
  { id: 'edit', label: 'Edit Row', icon: '✏️' },
  { id: 'duplicate', label: 'Duplicate', icon: '📋' },
  { id: 'separator', label: '', separator: true },
  { id: 'delete', label: 'Delete Row', icon: '🗑️' },
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
- All table events are logged in real-time
- Click any event to expand and see the full payload
- Clear button to reset the log

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

### Complete Example with API Integration

```tsx
import React, { useState, useRef } from 'react';
import {
  DynamicTable,
  useEventHandlers,
  dispatch,
  TableEvents,
  ColumnDef,
  SavedFilter,
} from '@open-mercato/ui/backend/dynamic-table';

const EmployeeTable = () => {
  const tableRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [activeFilterId, setActiveFilterId] = useState<string | null>(null);

  const columns: ColumnDef[] = [
    { data: 'id', title: 'ID', width: 60, readOnly: true, sticky: 'left' },
    { data: 'name', title: 'Name', width: 150 },
    { data: 'email', title: 'Email', width: 200 },
    { data: 'department', title: 'Department', type: 'dropdown', source: ['Engineering', 'Sales', 'HR'] },
    { data: 'salary', title: 'Salary', type: 'numeric', renderer: (v) => `$${v?.toLocaleString()}` },
    { data: 'active', title: 'Status', type: 'boolean' },
  ];

  // Handle all table events
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

    // Sorting
    [TableEvents.COLUMN_SORT]: (payload) => {
      fetchData({ sort: payload.columnName, order: payload.direction });
    },

    // Search
    [TableEvents.SEARCH]: (payload) => {
      fetchData({ search: payload.query });
    },

    // Filters
    [TableEvents.FILTER_CHANGE]: (payload) => {
      fetchData({ filters: payload.filters });
    },
    [TableEvents.FILTER_SAVE]: (payload) => {
      setSavedFilters(prev => [...prev, payload.filter]);
      setActiveFilterId(payload.filter.id);
    },
    [TableEvents.FILTER_SELECT]: (payload) => setActiveFilterId(payload.id),
    [TableEvents.FILTER_DELETE]: (payload) => {
      setSavedFilters(prev => prev.filter(f => f.id !== payload.id));
      if (activeFilterId === payload.id) setActiveFilterId(null);
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
      savedFilters={savedFilters}
      activeFilterId={activeFilterId}
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

// Validators
export * from './validators';
```
