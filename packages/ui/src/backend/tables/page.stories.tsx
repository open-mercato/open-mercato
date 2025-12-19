//@ts-nocheck

import React, { useState, useCallback } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import Table from './index';
import { TableEvents } from './events/types';
import { dispatch, useMediator } from './events/events';
import { CellEditSaveEvent, CellSaveStartEvent, CellSaveSuccessEvent, CellSaveErrorEvent, NewRowSaveEvent, NewRowSaveSuccessEvent, NewRowSaveErrorEvent,  ColumnContextMenuEvent,
  RowContextMenuEvent } from './events/types';
import { ApiCallResult } from '../utils/apiCall';
import { emailValidator } from "./validators";
import { ColumnSortEvent, SearchEvent } from './events/types';
import { ContextMenuAction } from './components/context-menu/ContextMenu';

const meta: Meta<typeof Table> = {
  title: 'Backend/Tables/Dynamic Example',
  component: Table,
  parameters: {
    layout: 'padded',
  },
};

export default meta;

const mockApiSave = (rowIndex: number, colIndex: number, value: any): Promise<ApiCallResult<{ success: boolean; data?: any; error?: string }>> => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      // 80% success rate for demo
      if (Math.random() > 0.2) {
        resolve({
          ok: true,
          status: 200,
          result: {
            success: true,
            data: {
              rowIndex,
              colIndex,
              value,
              updatedAt: new Date().toISOString(),
            }
          },
          response: new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }),
          cacheStatus: null
        });
      } else {
        // Error response (but resolved, not rejected)
        resolve({
          ok: false,
          status: 400,
          result: {
            success: false,
            error: 'Validation failed: Value must be non-empty'
          },
          response: new Response(
            JSON.stringify({
              error: 'Validation failed: Value must be non-empty',
              fieldErrors: { [colIndex]: 'Invalid value' }
            }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            }
          ),
          cacheStatus: null
        });
      }
    }, 1500); // 1.5 second delay
  });
};

const mockApiNewRowSave = (rowIndex: number, rowData: any): Promise<ApiCallResult<{ success: boolean; data?: any; error?: string }>> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      // 80% success rate for demo (same as cell save)
      if (Math.random() > 0.2) {
        resolve({
          ok: true,
          status: 201,
          result: {
            success: true,
            data: {
              rowIndex,
              rowData,
              id: Math.floor(Math.random() * 10000), // Generate mock ID
              createdAt: new Date().toISOString(),
            }
          },
          response: new Response(JSON.stringify({ success: true }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
          }),
          cacheStatus: null
        });
      } else {
        resolve({
          ok: false,
          status: 400,
          result: {
            success: false,
            error: 'Validation failed: Required fields missing'
          },
          response: new Response(
            JSON.stringify({
              error: 'Validation failed: Required fields missing'
            }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            }
          ),
          cacheStatus: null
        });
      }
    }, 1500);
  });
};

// Generate random data
const generateData = (count: number) => {
  const departments = ['Engineering', 'Marketing', 'Sales', 'HR', 'Finance', 'Design', 'Operations', 'Legal'];
  const roles = ['Manager', 'Developer', 'Designer', 'Analyst', 'Director', 'Lead', 'Specialist', 'Coordinator'];
  const locations = ['New York', 'Los Angeles', 'Chicago', 'San Francisco', 'Boston', 'Seattle', 'Austin', 'Miami'];
  const countries = ['USA', 'UK', 'Canada', 'Germany', 'France', 'Japan', 'Australia'];

  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Person ${i + 1}`,
    email: `person${i + 1}@example.com`,
    phone: `+1-555-${String(i).padStart(4, '0')}`,
    age: 25 + Math.floor(Math.random() * 30),
    role: roles[Math.floor(Math.random() * roles.length)],
    department: departments[Math.floor(Math.random() * departments.length)],
    location: locations[Math.floor(Math.random() * locations.length)],
    country: countries[Math.floor(Math.random() * countries.length)],
    startDate: `20${15 + Math.floor(Math.random() * 10)}-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`,
    rating: +(3.5 + Math.random() * 1.5).toFixed(1),
    salary: 50000 + Math.floor(Math.random() * 80000),
    active: Math.random() > 0.2,
    notes: `Notes for person ${i + 1}`
  }));
};

const DynamicTableExample = () => {
  const tableRef = React.useRef<HTMLDivElement>(null);
  const [data, setData] = useState(() => generateData(50));
  const [filterText, setFilterText] = useState('');
  const [editLog, setEditLog] = useState<Array<{ timestamp: string; row: number; col: number; value: any }>>([]);

  const columns = [
    { data: 'id', width: 60, title: 'ID', readOnly: true, sticky: 'left' },
    { data: 'name', width: 150, title: 'Name', },
    { data: 'email', width: 220, title: 'Email', validator: emailValidator },
    { data: 'phone', width: 130, title: 'Phone' },
    { data: 'age', width: 70, title: 'Age' },
    { data: 'role', width: 180, title: 'Role' },
    { data: 'department', width: 120, title: 'Department' },
    { data: 'location', width: 130, title: 'Location' },
    { data: 'country', width: 100, title: 'Country' },
    { data: 'startDate', width: 120, title: 'Start Date' },
    {
      data: 'rating', width: 90, title: 'Rating', renderer: (value: number) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span>{'⭐'.repeat(Math.floor(value))}</span>
          <span style={{ fontSize: '12px', color: '#666' }}>{value}</span>
        </div>
      )
    },
    {
      data: 'salary', width: 110, title: 'Salary', type: 'numeric', numericFormat: {
        style: 'currency',
        currency: 'USD',
        locale: 'en-US'
      }
    },
    {
      data: 'active', width: 100, title: 'Status', renderer: (value: boolean) => (
        <span style={{
          color: value ? '#10b981' : '#ef4444',
          fontWeight: 'bold',
          padding: '2px 8px',
          borderRadius: '4px',
          backgroundColor: value ? '#d1fae5' : '#fee2e2',
          fontSize: '11px'
        }}>
          {value ? '✓ Active' : '✗ Inactive'}
        </span>
      )
    },
    { data: 'notes', width: 250, title: 'Notes' },
  ];

  // Handle cell edits (not for new rows)
  useMediator<CellEditSaveEvent>(
    TableEvents.CELL_EDIT_SAVE,
    useCallback(async (payload: CellEditSaveEvent) => {
      console.log('CELL_EDIT_SAVE event received:', payload);

      dispatch(
        tableRef.current as HTMLElement,
        TableEvents.CELL_SAVE_START,
        {
          rowIndex: payload.rowIndex,
          colIndex: payload.colIndex,
        } as CellSaveStartEvent
      );

      try {
        const response = await mockApiSave(payload.rowIndex, payload.colIndex, payload.value);

        if (response.ok) {
          dispatch(
            tableRef.current as HTMLElement,
            TableEvents.CELL_SAVE_SUCCESS,
            {
              rowIndex: payload.rowIndex,
              colIndex: payload.colIndex,
            } as CellSaveSuccessEvent
          );
        } else {
          console.error('Save failed', response.result?.error);

          dispatch(
            tableRef.current as HTMLElement,
            TableEvents.CELL_SAVE_ERROR,
            {
              rowIndex: payload.rowIndex,
              colIndex: payload.colIndex,
              error: response.result?.error,
            } as CellSaveErrorEvent
          );
        }
      } catch (error) {
        console.error('Save exception', error);

        dispatch(
          tableRef.current as HTMLElement,
          TableEvents.CELL_SAVE_ERROR,
          {
            rowIndex: payload.rowIndex,
            colIndex: payload.colIndex,
            error: error instanceof Error ? error.message : 'Unknown error',
          } as CellSaveErrorEvent
        );
      }
    }, []),
    tableRef as React.RefObject<HTMLElement>
  );

  // Handle new row save
  useMediator<NewRowSaveEvent>(
    TableEvents.NEW_ROW_SAVE,
    useCallback(async (payload: NewRowSaveEvent) => {
      console.log('NEW_ROW_SAVE event received:', payload);

      try {
        const response = await mockApiNewRowSave(payload.rowIndex, payload.rowData);

        if (response.ok) {
          console.log('New row saved successfully:', response.result);

          // Dispatch success event with saved data including new ID
          dispatch(
            tableRef.current as HTMLElement,
            TableEvents.NEW_ROW_SAVE_SUCCESS,
            {
              rowIndex: payload.rowIndex,
              savedRowData: {
                ...payload.rowData,
                id: response.result.data.id, // Update with generated ID
              }
            } as NewRowSaveSuccessEvent
          );
        } else {
          console.error('New row save failed', response.result?.error);

          dispatch(
            tableRef.current as HTMLElement,
            TableEvents.NEW_ROW_SAVE_ERROR,
            {
              rowIndex: payload.rowIndex,
              error: response.result?.error,
            } as NewRowSaveErrorEvent
          );
        }
      } catch (error) {
        console.error('New row save exception', error);

        dispatch(
          tableRef.current as HTMLElement,
          TableEvents.NEW_ROW_SAVE_ERROR,
          {
            rowIndex: payload.rowIndex,
            error: error instanceof Error ? error.message : 'Unknown error',
          } as NewRowSaveErrorEvent
        );
      }
    }, []),
    tableRef as React.RefObject<HTMLElement>
  );

  useMediator<ColumnSortEvent>(
    TableEvents.COLUMN_SORT,
    useCallback((payload: ColumnSortEvent) => {
      console.log('Sort triggered:', payload);
      
      // Make your API call here
      if (payload.direction) {
        console.log('Sort triggered:', payload);
      } else {
        // direction is null, clear sorting
        console.log('Sort cleared');
      }
    }, []),
    tableRef
  );

  useMediator<SearchEvent>(
    TableEvents.SEARCH,
    useCallback((payload: SearchEvent) => {
      console.log('Search event received:', payload);
      // Perform your search logic here
      // For example, filter data or make an API call
      if (payload.query) {
        // Filter logic or API call
        console.log('Searching for:', payload.query);
      } else {
        // Clear search
        console.log('Search cleared');
      }
    }, []),
    tableRef
  );
  const columnActions = useCallback((column: any, colIndex: number): ContextMenuAction[] => {
    return [
      { id: 'sort-asc', label: 'Sort Ascending', icon: '↑' },
      { id: 'sort-desc', label: 'Sort Descending', icon: '↓' },
      { id: 'separator-1', label: '', separator: true },
      { id: 'filter', label: 'Filter by this column', icon: '🔍' },
      { id: 'hide', label: 'Hide column', icon: '👁️' },
      { id: 'separator-2', label: '', separator: true },
      { id: 'freeze', label: 'Freeze column', icon: '📌' },
    ];
  }, []);

  const rowActions = useCallback((rowData: any, rowIndex: number): ContextMenuAction[] => {
    return [
      { id: 'edit', label: 'Edit row', icon: '✏️' },
      { id: 'duplicate', label: 'Duplicate row', icon: '📋' },
      { id: 'separator-1', label: '', separator: true },
      { id: 'delete', label: 'Delete row', icon: '🗑️' },
      { id: 'separator-2', label: '', separator: true },
      { id: 'insert-above', label: 'Insert row above', icon: '⬆️' },
      { id: 'insert-below', label: 'Insert row below', icon: '⬇️' },
    ];
  }, []);


  // Example of handling column context menu actions
  useMediator<ColumnContextMenuEvent>(
    TableEvents.COLUMN_CONTEXT_MENU_ACTION,
    useCallback((payload: ColumnContextMenuEvent) => {
      console.log('Column context menu action:', payload);
      
      switch (payload.actionId) {
        case 'sort-asc':
          console.log(`Sorting column ${payload.columnName} (index ${payload.columnIndex}) ascending`);
          // Trigger your sort logic here
          break;
        case 'sort-desc':
          console.log(`Sorting column ${payload.columnName} (index ${payload.columnIndex}) descending`);
          // Trigger your sort logic here
          break;
        case 'filter':
          console.log(`Filtering by column ${payload.columnName}`);
          // Open filter dialog for this column
          break;
        case 'hide':
          console.log(`Hiding column ${payload.columnName}`);
          // Hide column logic
          break;
        case 'freeze':
          console.log(`Freezing column ${payload.columnName}`);
          // Make column sticky
          break;
        default:
          console.log(`Unknown action: ${payload.actionId}`);
      }
    }, []),
    tableRef
  );


  // Example of handling row context menu actions
  useMediator<RowContextMenuEvent>(
    TableEvents.ROW_CONTEXT_MENU_ACTION,
    useCallback((payload: RowContextMenuEvent) => {
      console.log('Row context menu action:', payload);
      
      switch (payload.actionId) {
        case 'edit':
          console.log(`Editing row ${payload.rowIndex}:`, payload.rowData);
          // Open edit modal or enable edit mode for the row
          break;
        case 'duplicate':
          console.log(`Duplicating row ${payload.rowIndex}:`, payload.rowData);
          setData(prevData => {
            const newRow = { ...payload.rowData, id: Math.max(...prevData.map(r => r.id)) + 1 };
            return [...prevData, newRow];
          });
          break;
        case 'delete':
          console.log(`Deleting row ${payload.rowIndex}:`, payload.rowData);
          // Confirm and delete
          if (confirm(`Are you sure you want to delete ${payload.rowData.name}?`)) {
            setData(prevData => prevData.filter(row => row.id !== payload.rowData.id));
          }
          break;
        case 'insert-above':
          console.log(`Inserting row above ${payload.rowIndex}`);
          setData(prevData => {
            const newData = [...prevData];
            const newRow = {
              id: Math.max(...prevData.map(r => r.id)) + 1,
              name: 'New Person',
              email: '',
              phone: '',
              age: 25,
              role: '',
              department: '',
              location: '',
              country: '',
              startDate: new Date().toISOString().split('T')[0],
              rating: 0,
              salary: 0,
              active: true,
              notes: ''
            };
            newData.splice(payload.rowIndex, 0, newRow);
            return newData;
          });
          break;
        case 'insert-below':
          console.log(`Inserting row below ${payload.rowIndex}`);
          setData(prevData => {
            const newData = [...prevData];
            const newRow = {
              id: Math.max(...prevData.map(r => r.id)) + 1,
              name: 'New Person',
              email: '',
              phone: '',
              age: 25,
              role: '',
              department: '',
              location: '',
              country: '',
              startDate: new Date().toISOString().split('T')[0],
              rating: 0,
              salary: 0,
              active: true,
              notes: ''
            };
            newData.splice(payload.rowIndex + 1, 0, newRow);
            return newData;
          });
          break;
        default:
          console.log(`Unknown action: ${payload.actionId}`);
      }
    }, []),
    tableRef
  );



  return (
    <div className="space-y-4">
      <Table
        tableRef={tableRef}
        data={data}
        columns={columns}
        colHeaders={true}
        rowHeaders={true}
        columnActions={columnActions}
        rowActions={rowActions}
      />
    </div>
  );
};

export const Interactive: StoryObj = {
  render: () => <DynamicTableExample />,
};