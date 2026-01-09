// types/index.ts

export type CellId = `${number}:${number}`;

export interface SelectionState {
  type: 'cell' | 'range' | 'row' | 'column' | 'rowRange' | 'colRange' | null;
  anchor: { row: number; col: number } | null;
  focus: { row: number; col: number } | null;
}

export interface SelectionBounds {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

export interface RangeEdges {
  top?: boolean;
  bottom?: boolean;
  left?: boolean;
  right?: boolean;
}

export interface CellState {
  value: any;
  isSelected: boolean;
  isInRange: boolean;
  rangeEdges: RangeEdges;
  isEditing: boolean;
  saveState: SaveStateType;
  isNewRow: boolean;
}

export type SaveStateType = 'saving' | 'success' | 'error' | null;

export type CellSubscriber = () => void;

export interface ColumnDef {
  data: string;
  title?: string;
  width?: number;
  type?: 'text' | 'numeric' | 'date' | 'dropdown' | 'boolean';
  readOnly?: boolean;
  sticky?: 'left' | 'right';
  source?: any[];
  renderer?: (value: any, rowData: any, col: any, rowIndex: number, colIndex: number) => React.ReactNode;
  editor?: (
    value: any,
    onChange: (v: any) => void,
    onSave: () => void,
    onCancel: () => void,
    rowData: any,
    col: any,
    rowIndex: number,
    colIndex: number
  ) => React.ReactNode;
}

export interface DragState {
  isDragging: boolean;
  type: 'cell' | 'row' | 'column' | null;
  start: { row: number; col: number } | null;
}

export interface SortState {
  columnIndex: number | null;
  direction: 'asc' | 'desc' | null;
}

export interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  actions: ContextMenuAction[];
  type: 'column' | 'row' | null;
  index: number | null;
}

export interface ContextMenuAction {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  separator?: boolean;
}

export interface FilterRow {
  id: string;
  field: string;
  operator: string;
  values: any[];
}

export type FilterColor = 'blue' | 'green' | 'purple' | 'orange' | 'pink' | 'teal' | 'yellow' | 'red';

export interface SavedFilter {
  id: string;
  name: string;
  rows: FilterRow[];
  color?: FilterColor;
}

// Event types
export interface CellEditSaveEvent {
  rowIndex: number;
  colIndex: number;
  oldValue: any;
  newValue: any;
  prop: string;
  rowData: any;
  id?: string;
}

export interface CellSaveStartEvent {
  rowIndex: number;
  colIndex: number;
}

export interface CellSaveSuccessEvent {
  rowIndex: number;
  colIndex: number;
}

export interface CellSaveErrorEvent {
  rowIndex: number;
  colIndex: number;
  error?: string;
}

export interface NewRowSaveEvent {
  rowIndex: number;
  rowData: any;
}

export interface NewRowSaveStartEvent {
  rowIndex: number;
}

export interface NewRowSaveSuccessEvent {
  rowIndex: number;
  savedRowData: any;
}

export interface NewRowSaveErrorEvent {
  rowIndex: number;
  error?: string;
}

export interface ColumnSortEvent {
  columnIndex: number;
  columnName: string;
  direction: 'asc' | 'desc' | null;
}

export interface SearchEvent {
  query: string;
  timestamp: number;
}

export interface FilterChangeEvent {
  filters: FilterRow[];
  savedFilterId?: string | null;
}

export interface FilterSaveEvent {
  filter: SavedFilter;
}

export interface FilterSelectEvent {
  id: string | null;
  filterRows: FilterRow[];
}

export interface FilterRenameEvent {
  id: string;
  newName: string;
}

export interface FilterDeleteEvent {
  id: string;
}

export interface ColumnContextMenuEvent {
  columnIndex: number;
  columnName: string;
  actionId: string;
}

export interface RowContextMenuEvent {
  rowIndex: number;
  rowData: any;
  actionId: string;
}

export const TableEvents = {
  CELL_EDIT_SAVE: 'table:cell:edit:save',
  CELL_SAVE_START: 'table:cell:save:start',
  CELL_SAVE_SUCCESS: 'table:cell:save:success',
  CELL_SAVE_ERROR: 'table:cell:save:error',
  NEW_ROW_SAVE: 'table:new:row:save',
  NEW_ROW_SAVE_START: 'table:new:row:save:start',
  NEW_ROW_SAVE_SUCCESS: 'table:new:row:save:success',
  NEW_ROW_SAVE_ERROR: 'table:new:row:save:error',
  FILTER_CHANGE: 'table:filter:change',
  FILTER_SAVE: 'table:filter:save',
  FILTER_SELECT: 'table:filter:select',
  FILTER_RENAME: 'table:filter:rename',
  FILTER_DELETE: 'table:filter:delete',
  COLUMN_SORT: 'table:column:sort',
  SEARCH: 'table:search',
  COLUMN_CONTEXT_MENU_ACTION: 'table:column:context:action',
  ROW_CONTEXT_MENU_ACTION: 'table:row:context:action',
  // Perspective events
  PERSPECTIVE_SAVE: 'table:perspective:save',
  PERSPECTIVE_SELECT: 'table:perspective:select',
  PERSPECTIVE_RENAME: 'table:perspective:rename',
  PERSPECTIVE_DELETE: 'table:perspective:delete',
  PERSPECTIVE_CHANGE: 'table:perspective:change',
} as const;

// Type mapping for event payloads - maps event names to their payload types
export type TableEventPayloads = {
  [TableEvents.CELL_EDIT_SAVE]: CellEditSaveEvent;
  [TableEvents.CELL_SAVE_START]: CellSaveStartEvent;
  [TableEvents.CELL_SAVE_SUCCESS]: CellSaveSuccessEvent;
  [TableEvents.CELL_SAVE_ERROR]: CellSaveErrorEvent;
  [TableEvents.NEW_ROW_SAVE]: NewRowSaveEvent;
  [TableEvents.NEW_ROW_SAVE_START]: NewRowSaveStartEvent;
  [TableEvents.NEW_ROW_SAVE_SUCCESS]: NewRowSaveSuccessEvent;
  [TableEvents.NEW_ROW_SAVE_ERROR]: NewRowSaveErrorEvent;
  [TableEvents.FILTER_CHANGE]: FilterChangeEvent;
  [TableEvents.FILTER_SAVE]: FilterSaveEvent;
  [TableEvents.FILTER_SELECT]: FilterSelectEvent;
  [TableEvents.FILTER_RENAME]: FilterRenameEvent;
  [TableEvents.FILTER_DELETE]: FilterDeleteEvent;
  [TableEvents.COLUMN_SORT]: ColumnSortEvent;
  [TableEvents.SEARCH]: SearchEvent;
  [TableEvents.COLUMN_CONTEXT_MENU_ACTION]: ColumnContextMenuEvent;
  [TableEvents.ROW_CONTEXT_MENU_ACTION]: RowContextMenuEvent;
  // Perspective event payloads (types imported from ./perspective)
  [TableEvents.PERSPECTIVE_SAVE]: import('./perspective').PerspectiveSaveEvent;
  [TableEvents.PERSPECTIVE_SELECT]: import('./perspective').PerspectiveSelectEvent;
  [TableEvents.PERSPECTIVE_RENAME]: import('./perspective').PerspectiveRenameEvent;
  [TableEvents.PERSPECTIVE_DELETE]: import('./perspective').PerspectiveDeleteEvent;
  [TableEvents.PERSPECTIVE_CHANGE]: import('./perspective').PerspectiveChangeEvent;
};

// Type for event handler map - each key is an event name, value is handler function
export type EventHandlers = {
  [K in keyof TableEventPayloads]?: (payload: TableEventPayloads[K]) => void;
};

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  limit: number;
  limitOptions?: number[];
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

export interface TableUIConfig {
  /** Hide the entire toolbar (header with title, search, buttons) */
  hideToolbar?: boolean;
  /** Hide just the search bar */
  hideSearch?: boolean;
  /** Hide the "Build Filter" button */
  hideFilterButton?: boolean;
  /** Hide the "Add Row" button */
  hideAddRowButton?: boolean;
  /** Hide the bottom row containing filter tabs and pagination */
  hideBottomBar?: boolean;
  /** Hide the Actions column */
  hideActionsColumn?: boolean;
  /** Position of Columns/Filter/Sort buttons. Default: 'top' */
  toolbarPosition?: 'top' | 'bottom';
  /** Custom content rendered at the start of the top bar (before title) */
  topBarStart?: React.ReactNode;
  /** Custom content rendered at the end of the top bar (after add button) */
  topBarEnd?: React.ReactNode;
  /** Custom content rendered at the start of the bottom bar (before tabs) */
  bottomBarStart?: React.ReactNode;
  /** Custom content rendered at the end of the bottom bar (after pagination) */
  bottomBarEnd?: React.ReactNode;
  /** Enable fullscreen toggle button. Default: false */
  enableFullscreen?: boolean;
  /** Callback when fullscreen state changes */
  onFullscreenChange?: (isFullscreen: boolean) => void;
}

export interface DynamicTableProps {
  data?: any[];
  columns?: ColumnDef[];
  colHeaders?: boolean;
  rowHeaders?: boolean;
  height?: string | number;
  width?: string | number;
  idColumnName?: string;
  tableName?: string;
  tableRef: React.RefObject<HTMLDivElement | null>;
  columnActions?: (column: ColumnDef, colIndex: number) => ContextMenuAction[];
  rowActions?: (rowData: any, rowIndex: number) => ContextMenuAction[];
  actionsRenderer?: (rowData: any, rowIndex: number) => React.ReactNode;
  pagination?: PaginationProps;
  // Filter management (controlled externally, events dispatched for changes)
  savedFilters?: SavedFilter[];
  activeFilterId?: string | null;
  // Debug mode - shows floating event log panel
  debug?: boolean;
  // Hidden columns - array of column data/id values to hide
  hiddenColumns?: string[];
  // UI visibility configuration
  uiConfig?: TableUIConfig;
}

// Re-export filter types
export * from './filters';

// Re-export perspective types
export * from './perspective';
