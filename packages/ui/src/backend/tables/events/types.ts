export interface CellEditSaveEvent {
    rowIndex: number;
    colIndex: number;
    value: string;
    id: string;
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
  
  export interface FilterChangeEvent {
    filters: any[];
    savedFilterId?: string | null;
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

  // Event names constants
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
    ROW_CONTEXT_MENU_ACTION: 'table:row:context:action'
  } as const;