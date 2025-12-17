import React, { useState, useCallback } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import Table from './index';
import { TableEvents } from './events/types';
import { useMediator } from './events/events';
import { CellEditSaveEvent } from './events/types';

const meta: Meta<typeof Table> = {
    title: 'Backend/Tables/Dynamic Example',
    component: Table,
    parameters: {
        layout: 'padded',
    },
};

export default meta;

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

    const columns = [
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
        useCallback((payload) => {
        console.log('CELL_EDIT_SAVE', payload);
        
        // API CALL na debouncie
        }, []),
        tableRef
    );



    // This would be called from the table's event system
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