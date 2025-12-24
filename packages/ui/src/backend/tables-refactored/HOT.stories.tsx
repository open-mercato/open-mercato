// HOT.stories.tsx
// @ts-nocheck

import React, { useState, useCallback, useRef } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import HOT from './HOT';
import { TableEvents } from './types';
import { dispatch, useMediator } from './events/events';
import type {
    CellEditSaveEvent,
    CellSaveStartEvent,
    CellSaveSuccessEvent,
    CellSaveErrorEvent,
    NewRowSaveEvent,
    NewRowSaveSuccessEvent,
    NewRowSaveErrorEvent,
    ColumnSortEvent,
    SearchEvent,
    ColumnContextMenuEvent,
    RowContextMenuEvent,
    ContextMenuAction,
} from './types';

const meta: Meta<typeof HOT> = {
    title: 'Components/HOT Table (Refactored)',
    component: HOT,
    parameters: {
        layout: 'padded',
    },
};

export default meta;

// Mock API helpers
const mockApiSave = (rowIndex: number, colIndex: number, value: any) => {
    return new Promise((resolve) => {
        setTimeout(() => {
            if (Math.random() > 0.2) {
                resolve({ ok: true, data: { rowIndex, colIndex, value } });
            } else {
                resolve({ ok: false, error: 'Validation failed' });
            }
        }, 1000);
    });
};

const mockApiNewRowSave = (rowIndex: number, rowData: any) => {
    return new Promise((resolve) => {
        setTimeout(() => {
            if (Math.random() > 0.2) {
                resolve({
                    ok: true,
                    data: { ...rowData, id: Math.floor(Math.random() * 10000) },
                });
            } else {
                resolve({ ok: false, error: 'Failed to save row' });
            }
        }, 1000);
    });
};

// Data generator
const generateData = (count: number) => {
    const departments = ['Engineering', 'Marketing', 'Sales', 'HR', 'Finance'];
    const statuses = ['Active', 'Inactive', 'Pending'];
    const countries = ['USA', 'UK', 'Canada', 'Germany', 'France'];

    return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        name: `Person ${i + 1}`,
        email: `person${i + 1}@example.com`,
        age: 25 + Math.floor(Math.random() * 30),
        department: departments[Math.floor(Math.random() * departments.length)],
        country: countries[Math.floor(Math.random() * countries.length)],
        startDate: `202${Math.floor(Math.random() * 5)}-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-15`,
        salary: 50000 + Math.floor(Math.random() * 50000),
        active: Math.random() > 0.3,
        status: statuses[Math.floor(Math.random() * statuses.length)],
    }));
};

// Custom Tags Editor
const TagsEditor = ({ value, onChange, onSave, onCancel }: any) => {
    const [localValue, setLocalValue] = useState(Array.isArray(value) ? value.join(', ') : '');
    const inputRef = useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    const handleSave = () => {
        const tags = localValue.split(',').map((t) => t.trim()).filter(Boolean);
        onSave(tags);
    };

    return (
        <input
            ref={inputRef}
            type="text"
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSave();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onCancel();
                }
            }}
            onBlur={handleSave}
            className="hot-cell-editor"
            placeholder="tag1, tag2, tag3"
        />
    );
};

// Main demo component
const TableDemo = () => {
    const tableRef = useRef<HTMLDivElement>(null);
    const [data, setData] = useState(() => generateData(100));

    const columns = [
        { data: 'id', width: 60, title: 'ID', readOnly: true, sticky: 'left' },
        { data: 'name', width: 150, title: 'Name' },
        { data: 'email', width: 200, title: 'Email' },
        { data: 'age', width: 70, title: 'Age', type: 'numeric' },
        {
            data: 'department',
            width: 130,
            title: 'Department',
            type: 'dropdown',
            source: ['Engineering', 'Marketing', 'Sales', 'HR', 'Finance'],
        },
        {
            data: 'country',
            width: 120,
            title: 'Country',
            type: 'dropdown',
            source: [
                { value: 'USA', label: '🇺🇸 USA' },
                { value: 'UK', label: '🇬🇧 UK' },
                { value: 'Canada', label: '🇨🇦 Canada' },
                { value: 'Germany', label: '🇩🇪 Germany' },
                { value: 'France', label: '🇫🇷 France' },
            ],
        },
        { data: 'startDate', width: 120, title: 'Start Date', type: 'date' },
        {
            data: 'salary',
            width: 100,
            title: 'Salary',
            type: 'numeric',
            renderer: (value: number) => `$${value?.toLocaleString() ?? 0}`,
        },
        {
            data: 'active',
            width: 90,
            title: 'Active',
            type: 'boolean',
            renderer: (value: boolean) => (
                <span
                    style={{
                        color: value ? '#10b981' : '#ef4444',
                        fontWeight: 'bold',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: value ? '#d1fae5' : '#fee2e2',
                        fontSize: '11px',
                    }}
                >
                    {value ? '✓ Active' : '✗ Inactive'}
                </span>
            ),
        },
        {
            data: 'status',
            width: 100,
            title: 'Status',
            type: 'dropdown',
            source: ['Active', 'Inactive', 'Pending'],
        },
    ];

    // Cell edit handler
    useMediator<CellEditSaveEvent>(
        TableEvents.CELL_EDIT_SAVE,
        useCallback(async (payload) => {
            console.log('Cell edit:', payload);

            dispatch(tableRef.current!, TableEvents.CELL_SAVE_START, {
                rowIndex: payload.rowIndex,
                colIndex: payload.colIndex,
            });

            const result = await mockApiSave(payload.rowIndex, payload.colIndex, payload.newValue);

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
        }, []),
        tableRef
    );

    // New row save handler
    useMediator<NewRowSaveEvent>(
        TableEvents.NEW_ROW_SAVE,
        useCallback(async (payload) => {
            console.log('New row save:', payload);

            const result = await mockApiNewRowSave(payload.rowIndex, payload.rowData);

            if (result.ok) {
                dispatch(tableRef.current!, TableEvents.NEW_ROW_SAVE_SUCCESS, {
                    rowIndex: payload.rowIndex,
                    savedRowData: result.data,
                });
            } else {
                dispatch(tableRef.current!, TableEvents.NEW_ROW_SAVE_ERROR, {
                    rowIndex: payload.rowIndex,
                    error: result.error,
                });
            }
        }, []),
        tableRef
    );

    // Sort handler
    useMediator<ColumnSortEvent>(
        TableEvents.COLUMN_SORT,
        useCallback((payload) => {
            console.log('Sort:', payload);
        }, []),
        tableRef
    );

    // Search handler
    useMediator<SearchEvent>(
        TableEvents.SEARCH,
        useCallback((payload) => {
            console.log('Search:', payload.query);
        }, []),
        tableRef
    );

    // Column context menu actions
    const columnActions = useCallback(
        (column: any, colIndex: number): ContextMenuAction[] => [
            { id: 'sort-asc', label: 'Sort Ascending', icon: '↑' },
            { id: 'sort-desc', label: 'Sort Descending', icon: '↓' },
            { id: 'separator-1', label: '', separator: true },
            { id: 'hide', label: 'Hide column', icon: '👁️' },
            { id: 'freeze', label: 'Freeze column', icon: '📌' },
        ],
        []
    );

    // Row context menu actions
    const rowActions = useCallback(
        (rowData: any, rowIndex: number): ContextMenuAction[] => [
            { id: 'edit', label: 'Edit row', icon: '✏️' },
            { id: 'duplicate', label: 'Duplicate', icon: '📋' },
            { id: 'separator-1', label: '', separator: true },
            { id: 'delete', label: 'Delete row', icon: '🗑️' },
        ],
        []
    );

    // Column context menu handler
    useMediator<ColumnContextMenuEvent>(
        TableEvents.COLUMN_CONTEXT_MENU_ACTION,
        useCallback((payload) => {
            console.log('Column action:', payload.actionId, payload.columnName);
        }, []),
        tableRef
    );

    // Row context menu handler
    useMediator<RowContextMenuEvent>(
        TableEvents.ROW_CONTEXT_MENU_ACTION,
        useCallback(
            (payload) => {
                console.log('Row action:', payload.actionId, payload.rowData);

                if (payload.actionId === 'delete') {
                    setData((prev) => prev.filter((_, i) => i !== payload.rowIndex));
                } else if (payload.actionId === 'duplicate') {
                    setData((prev) => {
                        const newRow = { ...payload.rowData, id: Math.max(...prev.map((r) => r.id)) + 1 };
                        const newData = [...prev];
                        newData.splice(payload.rowIndex + 1, 0, newRow);
                        return newData;
                    });
                }
            },
            []
        ),
        tableRef
    );

    return (
        <div>
            <div style={{ padding: 16, background: '#f5f5f5', borderRadius: 8, marginBottom: 16 }}>
                <h3 style={{ margin: '0 0 8px' }}>Refactored Table - Cell-Level State</h3>
                <p style={{ margin: 0, fontSize: 13, color: '#666' }}>
                    Each cell subscribes individually to the store. Selection and editing only re-render affected cells.
                </p>
            </div>

            <HOT
                tableRef={tableRef}
                data={data}
                columns={columns}
                colHeaders={true}
                rowHeaders={true}
                height={500}
                tableName="Employees"
                idColumnName="id"
                columnActions={columnActions}
                rowActions={rowActions}
            />
        </div>
    );
};

export const Default: StoryObj = {
    render: () => <TableDemo />,
};

// Minimal example
const MinimalDemo = () => {
    const tableRef = useRef<HTMLDivElement>(null);
    const data = [
        { id: 1, name: 'Alice', role: 'Developer' },
        { id: 2, name: 'Bob', role: 'Designer' },
        { id: 3, name: 'Charlie', role: 'Manager' },
    ];

    return (
        <HOT
            tableRef={tableRef}
            data={data}
            columns={[
                { data: 'id', title: 'ID', width: 60, readOnly: true },
                { data: 'name', title: 'Name', width: 150 },
                { data: 'role', title: 'Role', width: 150 },
            ]}
            colHeaders={true}
            rowHeaders={true}
            height={300}
            tableName="Simple Table"
        />
    );
};

export const Minimal: StoryObj = {
    render: () => <MinimalDemo />,
};

// Large dataset
const LargeDataDemo = () => {
    const tableRef = useRef<HTMLDivElement>(null);
    const data = generateData(10000);

    return (
        <div>
            <p style={{ marginBottom: 16, color: '#666' }}>10,000 rows - virtualized rendering</p>
            <HOT
                tableRef={tableRef}
                data={data}
                columns={[
                    { data: 'id', title: 'ID', width: 80, readOnly: true },
                    { data: 'name', title: 'Name', width: 150 },
                    { data: 'email', title: 'Email', width: 200 },
                    { data: 'department', title: 'Department', width: 120 },
                    { data: 'salary', title: 'Salary', width: 100, type: 'numeric' },
                ]}
                colHeaders={true}
                rowHeaders={true}
                height={600}
                tableName="Large Dataset"
            />
        </div>
    );
};

export const LargeDataset: StoryObj = {
    render: () => <LargeDataDemo />,
};