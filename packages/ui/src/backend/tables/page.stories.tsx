import React, { useState, useCallback } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import Table from './index';
import { TableEvents } from './events/types';
import { dispatch, useMediator } from './events/events';
import { CellEditSaveEvent, CellSaveStartEvent, CellSaveSuccessEvent, CellSaveErrorEvent } from './events/types';
import { ColumnConfig } from './renderers';
import { ApiCallResult } from '../utils/apiCall';

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
  });        }
      }, 1500); // 1.5 second delay
    });
  }; 

const DynamicTableExample = () => {
    const tableRef = React.useRef<HTMLDivElement>(null);

    const initialData = [
        { id: 1, name: 'John Doe', email: 'john@example.com', age: 28, department: 'Engineering', salary: 75000, active: true },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com', age: 34, department: 'Marketing', salary: 68000, active: true },
        { id: 3, name: 'Bob Johnson', email: 'bob@example.com', age: 45, department: 'Sales', salary: 82000, active: false },
        { id: 4, name: 'Alice Brown', email: 'alice@example.com', age: 29, department: 'Engineering', salary: 79000, active: true },
        { id: 5, name: 'Charlie Davis', email: 'charlie@example.com', age: 38, department: 'HR', salary: 65000, active: true },
    ];

    const [data, setData] = useState(initialData);
    const [filterText, setFilterText] = useState('');
    const [editLog, setEditLog] = useState<Array<{ timestamp: string; row: number; col: number; value: any }>>([]);

    const columns: ColumnConfig[] = [
        { data: 'id', width: 60, title: 'ID', readOnly: true },
        { data: 'name', width: 150, title: 'Name' },
        { data: 'email', width: 200, title: 'Email' },
        { data: 'age', width: 80, title: 'Age' },
        { data: 'department', width: 120, title: 'Department' },
        { data: 'salary', width: 100, title: 'Salary', type: 'numeric', numericFormat: {
            style: 'currency',
            currency: 'USD',
            locale: 'en-US'
        }},
        { data: 'active', width: 100, title: 'Active', renderer: (value: boolean) => (
            <span style={{ 
                color: value ? '#10b981' : '#ef4444',
                fontWeight: 'bold',
                padding: '2px 8px',
                borderRadius: '4px',
                backgroundColor: value ? '#d1fae5' : '#fee2e2'
            }}>
                {value ? '✓ Active' : '✗ Inactive'}
            </span>
        )},
    ];

    useMediator<CellEditSaveEvent>(
        TableEvents.CELL_EDIT_SAVE,
        useCallback(async (payload: CellEditSaveEvent) => {

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
                
                // Dispatch success event
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
                
                // Dispatch error event
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
            
            // Dispatch error event for exceptions
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

    return (
        <div className="space-y-4">
            <div className="bg-white p-4 rounded-lg shadow">
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">

                    <div className="space-y-2">
                        <h3 className="font-semibold text-lg">Filter</h3>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={filterText}
                                onChange={(e) => setFilterText(e.target.value)}
                                placeholder="Search anything..."
                                className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                </div>
            </div>

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