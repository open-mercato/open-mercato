//@ts-nocheck

import React, { useState, useCallback } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import Table from './index';
import { TableEvents } from './events/types';
import { dispatch, useMediator } from './events/events';
import { CellEditSaveEvent, CellSaveStartEvent, CellSaveSuccessEvent, CellSaveErrorEvent, NewRowSaveEvent, NewRowSaveSuccessEvent, NewRowSaveErrorEvent } from './events/types';
import { ApiCallResult } from '../utils/apiCall';
import { emailValidator } from "./validators";
import { ColumnSortEvent, SearchEvent } from './events/types';

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


  return (
    <div className="space-y-4">
      <Table
        tableRef={tableRef}
        data={data}
        columns={columns}
        colHeaders={true}
        rowHeaders={true}
      />
    </div>
  );
};

export const Interactive: StoryObj = {
  render: () => <DynamicTableExample />,
};