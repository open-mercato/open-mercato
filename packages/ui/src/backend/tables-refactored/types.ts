// types.ts

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

export interface SavedFilter {
  id: string;
  name: string;
  rows: FilterRow[];
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
  COLUMN_SORT: 'table:column:sort',
  SEARCH: 'table:search',
  COLUMN_CONTEXT_MENU_ACTION: 'table:column:context:action',
  ROW_CONTEXT_MENU_ACTION: 'table:row:context:action',
} as const;

export interface HOTProps {
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
}
