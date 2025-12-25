// HOT.stories.tsx

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
    NewRowSaveStartEvent,
    NewRowSaveSuccessEvent,
    NewRowSaveErrorEvent,
    ColumnSortEvent,
    SearchEvent,
    FilterChangeEvent,
    ColumnContextMenuEvent,
    RowContextMenuEvent,
    ContextMenuAction,
    ColumnDef,
} from './types';

const meta: Meta<typeof HOT> = {
    title: 'Components/HOT Table',
    component: HOT,
    parameters: {
        layout: 'padded',
    },
};

export default meta;

// ============================================================================
// MOCK API HELPERS
// ============================================================================

const mockApiSave = (rowIndex: number, colIndex: number, value: any) => {
    return new Promise<{ ok: boolean; data?: any; error?: string }>((resolve) => {
        setTimeout(() => {
            // 80% success rate
            if (Math.random() > 0.2) {
                resolve({ ok: true, data: { rowIndex, colIndex, value } });
            } else {
                resolve({ ok: false, error: 'Server validation failed' });
            }
        }, 800 + Math.random() * 700);
    });
};

const mockApiNewRowSave = (rowIndex: number, rowData: any) => {
    return new Promise<{ ok: boolean; data?: any; error?: string }>((resolve) => {
        setTimeout(() => {
            if (Math.random() > 0.2) {
                resolve({
                    ok: true,
                    data: { ...rowData, id: Math.floor(Math.random() * 10000) + 1000 },
                });
            } else {
                resolve({ ok: false, error: 'Failed to save row' });
            }
        }, 1200);
    });
};

// ============================================================================
// DATA GENERATOR
// ============================================================================

const generateData = (count: number) => {
    const departments = ['Engineering', 'Marketing', 'Sales', 'HR', 'Finance', 'Operations', 'Legal'];
    const statuses = ['Active', 'Inactive', 'Pending', 'On Leave'];
    const countries = ['USA', 'UK', 'Canada', 'Germany', 'France', 'Japan', 'Australia'];
    const roles = ['Junior', 'Mid', 'Senior', 'Lead', 'Manager', 'Director'];

    return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        name: `Person ${i + 1}`,
        email: `person${i + 1}@company.com`,
        age: 22 + Math.floor(Math.random() * 40),
        department: departments[Math.floor(Math.random() * departments.length)],
        country: countries[Math.floor(Math.random() * countries.length)],
        role: roles[Math.floor(Math.random() * roles.length)],
        startDate: `202${Math.floor(Math.random() * 5)}-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`,
        salary: 45000 + Math.floor(Math.random() * 80000),
        active: Math.random() > 0.25,
        status: statuses[Math.floor(Math.random() * statuses.length)],
    }));
};

// ============================================================================
// COLUMNS CONFIG
// ============================================================================

const getColumns = (): ColumnDef[] => [
    { data: 'id', width: 60, title: 'ID', readOnly: true, sticky: 'left' },
    { data: 'name', width: 150, title: 'Name' },
    { data: 'email', width: 220, title: 'Email' },
    { data: 'age', width: 70, title: 'Age', type: 'numeric' },
    {
        data: 'department',
        width: 130,
        title: 'Department',
        type: 'dropdown',
        source: ['Engineering', 'Marketing', 'Sales', 'HR', 'Finance', 'Operations', 'Legal'],
    },
    {
        data: 'country',
        width: 120,
        title: 'Country',
        type: 'dropdown',
        source: [
            { value: 'USA', label: 'USA' },
            { value: 'UK', label: 'UK' },
            { value: 'Canada', label: 'Canada' },
            { value: 'Germany', label: 'Germany' },
            { value: 'France', label: 'France' },
            { value: 'Japan', label: 'Japan' },
            { value: 'Australia', label: 'Australia' },
        ],
    },
    { data: 'startDate', width: 120, title: 'Start Date', type: 'date' },
    {
        data: 'salary',
        width: 110,
        title: 'Salary',
        type: 'numeric',
        renderer: (value: number) => `$${(value ?? 0).toLocaleString()}`,
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
                    borderRadius: 4,
                    backgroundColor: value ? '#d1fae5' : '#fee2e2',
                    fontSize: 11,
                }}
            >
                {value ? 'Active' : 'Inactive'}
            </span>
        ),
    },
    {
        data: 'status',
        width: 100,
        title: 'Status',
        type: 'dropdown',
        source: ['Active', 'Inactive', 'Pending', 'On Leave'],
    },
];

// ============================================================================
// CONTEXT MENU ACTIONS
// ============================================================================

const getColumnActions = (column: ColumnDef, colIndex: number): ContextMenuAction[] => [
    { id: 'sort-asc', label: 'Sort Ascending', icon: '↑' },
    { id: 'sort-desc', label: 'Sort Descending', icon: '↓' },
    { id: 'separator-1', label: '', separator: true },
    { id: 'hide', label: 'Hide Column', icon: '👁️' },
    { id: 'freeze', label: 'Freeze Column', icon: '📌' },
];

const getRowActions = (rowData: any, rowIndex: number): ContextMenuAction[] => [
    { id: 'edit', label: 'Edit Row', icon: '✏️' },
    { id: 'duplicate', label: 'Duplicate', icon: '📋' },
    { id: 'separator-1', label: '', separator: true },
    { id: 'delete', label: 'Delete Row', icon: '🗑️' },
];

// ============================================================================
// STORY 1: FULL FEATURED DEMO (DEFAULT)
// ============================================================================

const FullFeaturedDemo = () => {
    const tableRef = useRef<HTMLDivElement>(null);
    const [allData] = useState(() => generateData(250));
    const [currentPage, setCurrentPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const columns = getColumns();

    // Pagination calculations
    const totalPages = Math.ceil(allData.length / limit);
    const startIndex = (currentPage - 1) * limit;
    const data = allData.slice(startIndex, startIndex + limit);

    const handlePageChange = (page: number) => {
        setCurrentPage(Math.max(1, Math.min(page, totalPages)));
    };

    const handleLimitChange = (newLimit: number) => {
        setLimit(newLimit);
        setCurrentPage(1); // Reset to first page when limit changes
    };

    // Cell edit handler with save states
    useMediator<CellEditSaveEvent>(
        TableEvents.CELL_EDIT_SAVE,
        useCallback(async (payload) => {
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
            const result = await mockApiNewRowSave(payload.rowIndex, payload.rowData);

            if (result.ok) {
                dispatch(tableRef.current!, TableEvents.NEW_ROW_SAVE_SUCCESS, {
                    rowIndex: payload.rowIndex,
                    savedRowData: result.data,
                });
                setData((prev) => [...prev, result.data]);
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
            if (payload.direction) {
                setData((prev) =>
                    [...prev].sort((a, b) => {
                        const aVal = a[payload.columnName];
                        const bVal = b[payload.columnName];
                        if (aVal < bVal) return payload.direction === 'asc' ? -1 : 1;
                        if (aVal > bVal) return payload.direction === 'asc' ? 1 : -1;
                        return 0;
                    })
                );
            }
        }, []),
        tableRef
    );

    // Row context menu handler
    useMediator<RowContextMenuEvent>(
        TableEvents.ROW_CONTEXT_MENU_ACTION,
        useCallback((payload) => {
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
        }, []),
        tableRef
    );

    return (
        <div>
            <div
                style={{
                    padding: 16,
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    borderRadius: 8,
                    marginBottom: 16,
                    color: 'white',
                }}
            >
                <h3 style={{ margin: '0 0 8px' }}>HOT Table - Full Featured Demo</h3>
                <p style={{ margin: 0, fontSize: 13, opacity: 0.9 }}>
                    {allData.length} total rows with pagination ({limit} per page). Features: editing, sorting, filtering,
                    context menus, keyboard navigation, new row creation. API saving with 80% success rate.
                </p>
            </div>

            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', fontSize: 11 }}>
                <span style={{ padding: '4px 8px', background: '#dbeafe', borderRadius: 4 }}>
                    Double-click to edit
                </span>
                <span style={{ padding: '4px 8px', background: '#dcfce7', borderRadius: 4 }}>
                    Click headers to sort
                </span>
                <span style={{ padding: '4px 8px', background: '#fef3c7', borderRadius: 4 }}>
                    Right-click for menus
                </span>
                <span style={{ padding: '4px 8px', background: '#f3e8ff', borderRadius: 4 }}>
                    Arrow keys to navigate
                </span>
                <span style={{ padding: '4px 8px', background: '#fee2e2', borderRadius: 4 }}>
                    ~20% saves fail (demo)
                </span>
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
                columnActions={getColumnActions}
                rowActions={getRowActions}
                pagination={{
                    currentPage,
                    totalPages,
                    limit,
                    limitOptions: [10, 25, 50, 100],
                    onPageChange: handlePageChange,
                    onLimitChange: handleLimitChange,
                }}
            />
        </div>
    );
};

export const Default: StoryObj = {
    render: () => <FullFeaturedDemo />,
};

// ============================================================================
// STORY 2: EVENT LOG DEMO
// ============================================================================

interface LogEntry {
    id: number;
    timestamp: string;
    type: string;
    message: string;
    color: string;
}

const EventLogDemo = () => {
    const tableRef = useRef<HTMLDivElement>(null);
    const [allData, setAllData] = useState(() => generateData(50));
    const [currentPage, setCurrentPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [eventLog, setEventLog] = useState<LogEntry[]>([]);
    const logIdRef = useRef(0);
    const columns = getColumns();

    // Pagination calculations
    const totalPages = Math.ceil(allData.length / limit);
    const startIndex = (currentPage - 1) * limit;
    const data = allData.slice(startIndex, startIndex + limit);

    const addLog = useCallback((type: string, message: string, color: string = '#d4d4d4') => {
        const timestamp = new Date().toLocaleTimeString();
        logIdRef.current++;
        setEventLog((prev) => [
            { id: logIdRef.current, timestamp, type, message, color },
            ...prev,
        ].slice(0, 50));
    }, []);

    const handlePageChange = useCallback((page: number) => {
        setCurrentPage(Math.max(1, Math.min(page, totalPages)));
        addLog('PAGE_CHANGE', `Navigated to page ${page}`, '#22d3ee');
    }, [totalPages, addLog]);

    const handleLimitChange = useCallback((newLimit: number) => {
        setLimit(newLimit);
        setCurrentPage(1);
        addLog('LIMIT_CHANGE', `Changed rows per page to ${newLimit}`, '#22d3ee');
    }, [addLog]);

    // Cell edit save event - log and start save
    useMediator<CellEditSaveEvent>(
        TableEvents.CELL_EDIT_SAVE,
        useCallback((payload) => {
            const colName = columns[payload.colIndex]?.data || `col${payload.colIndex}`;
            addLog(
                'CELL_EDIT_SAVE',
                `Row ${payload.rowIndex}, ${colName}: "${payload.oldValue}" → "${payload.newValue}"`,
                '#60a5fa'
            );

            // Dispatch save start
            dispatch(tableRef.current!, TableEvents.CELL_SAVE_START, {
                rowIndex: payload.rowIndex,
                colIndex: payload.colIndex,
            });

            // Simulate API call
            mockApiSave(payload.rowIndex, payload.colIndex, payload.newValue).then((result) => {
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
            });
        }, [columns, addLog]),
        tableRef
    );

    // Cell save start
    useMediator<CellSaveStartEvent>(
        TableEvents.CELL_SAVE_START,
        useCallback((payload) => {
            const colName = columns[payload.colIndex]?.data || `col${payload.colIndex}`;
            addLog('CELL_SAVE_START', `Saving row ${payload.rowIndex}, ${colName}...`, '#fbbf24');
        }, [columns, addLog]),
        tableRef
    );

    // Cell save success
    useMediator<CellSaveSuccessEvent>(
        TableEvents.CELL_SAVE_SUCCESS,
        useCallback((payload) => {
            const colName = columns[payload.colIndex]?.data || `col${payload.colIndex}`;
            addLog('CELL_SAVE_SUCCESS', `Row ${payload.rowIndex}, ${colName} saved!`, '#4ade80');
        }, [columns, addLog]),
        tableRef
    );

    // Cell save error
    useMediator<CellSaveErrorEvent>(
        TableEvents.CELL_SAVE_ERROR,
        useCallback((payload) => {
            const colName = columns[payload.colIndex]?.data || `col${payload.colIndex}`;
            addLog('CELL_SAVE_ERROR', `Row ${payload.rowIndex}, ${colName} - ${payload.error}`, '#f87171');
        }, [columns, addLog]),
        tableRef
    );

    // New row save
    useMediator<NewRowSaveEvent>(
        TableEvents.NEW_ROW_SAVE,
        useCallback((payload) => {
            addLog('NEW_ROW_SAVE', `Saving new row at index ${payload.rowIndex}...`, '#fbbf24');

            mockApiNewRowSave(payload.rowIndex, payload.rowData).then((result) => {
                if (result.ok) {
                    dispatch(tableRef.current!, TableEvents.NEW_ROW_SAVE_SUCCESS, {
                        rowIndex: payload.rowIndex,
                        savedRowData: result.data,
                    });
                    setAllData((prev) => [...prev, result.data]);
                } else {
                    dispatch(tableRef.current!, TableEvents.NEW_ROW_SAVE_ERROR, {
                        rowIndex: payload.rowIndex,
                        error: result.error,
                    });
                }
            });
        }, [addLog]),
        tableRef
    );

    // New row save success
    useMediator<NewRowSaveSuccessEvent>(
        TableEvents.NEW_ROW_SAVE_SUCCESS,
        useCallback((payload) => {
            addLog('NEW_ROW_SAVE_SUCCESS', `New row saved with ID ${payload.savedRowData?.id}`, '#4ade80');
        }, [addLog]),
        tableRef
    );

    // New row save error
    useMediator<NewRowSaveErrorEvent>(
        TableEvents.NEW_ROW_SAVE_ERROR,
        useCallback((payload) => {
            addLog('NEW_ROW_SAVE_ERROR', `Failed: ${payload.error}`, '#f87171');
        }, [addLog]),
        tableRef
    );

    // Column sort
    useMediator<ColumnSortEvent>(
        TableEvents.COLUMN_SORT,
        useCallback((payload) => {
            addLog(
                'COLUMN_SORT',
                `Column "${payload.columnName}" - ${payload.direction || 'cleared'}`,
                '#a78bfa'
            );
            if (payload.direction) {
                setAllData((prev) =>
                    [...prev].sort((a, b) => {
                        const aVal = a[payload.columnName];
                        const bVal = b[payload.columnName];
                        if (aVal < bVal) return payload.direction === 'asc' ? -1 : 1;
                        if (aVal > bVal) return payload.direction === 'asc' ? 1 : -1;
                        return 0;
                    })
                );
            }
        }, [addLog]),
        tableRef
    );

    // Search
    useMediator<SearchEvent>(
        TableEvents.SEARCH,
        useCallback((payload) => {
            addLog('SEARCH', `Query: "${payload.query || '(empty)'}"`, '#38bdf8');
        }, [addLog]),
        tableRef
    );

    // Filter change
    useMediator<FilterChangeEvent>(
        TableEvents.FILTER_CHANGE,
        useCallback((payload) => {
            addLog('FILTER_CHANGE', `${payload.filters.length} filter(s) applied`, '#fb923c');
        }, [addLog]),
        tableRef
    );

    // Column context menu
    useMediator<ColumnContextMenuEvent>(
        TableEvents.COLUMN_CONTEXT_MENU_ACTION,
        useCallback((payload) => {
            addLog('COLUMN_MENU', `"${payload.actionId}" on column "${payload.columnName}"`, '#e879f9');
        }, [addLog]),
        tableRef
    );

    // Row context menu
    useMediator<RowContextMenuEvent>(
        TableEvents.ROW_CONTEXT_MENU_ACTION,
        useCallback((payload) => {
            addLog('ROW_MENU', `"${payload.actionId}" on row ${payload.rowIndex}`, '#e879f9');

            if (payload.actionId === 'delete') {
                setAllData((prev) => prev.filter((_, i) => i !== payload.rowIndex));
            } else if (payload.actionId === 'duplicate') {
                setAllData((prev) => {
                    const newRow = { ...payload.rowData, id: Math.max(...prev.map((r) => r.id)) + 1 };
                    const newData = [...prev];
                    newData.splice(payload.rowIndex + 1, 0, newRow);
                    return newData;
                });
            }
        }, [addLog]),
        tableRef
    );

    return (
        <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 16 }}>
                    <h3 style={{ margin: '0 0 8px' }}>Event Log Demo</h3>
                    <p style={{ margin: 0, fontSize: 13, color: '#666' }}>
                        Interact with the table to see all events in the log panel. Edit cells, sort columns,
                        use search, add new rows, or right-click for context menus.
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
                    columnActions={getColumnActions}
                    rowActions={getRowActions}
                    pagination={{
                        currentPage,
                        totalPages,
                        limit,
                        limitOptions: [10, 25, 50],
                        onPageChange: handlePageChange,
                        onLimitChange: handleLimitChange,
                    }}
                />
            </div>
            <div
                style={{
                    width: 400,
                    background: '#1e1e1e',
                    borderRadius: 8,
                    padding: 16,
                    fontFamily: 'Monaco, Consolas, monospace',
                    fontSize: 11,
                    color: '#d4d4d4',
                    height: 560,
                    overflow: 'auto',
                }}
            >
                <div
                    style={{
                        marginBottom: 12,
                        paddingBottom: 8,
                        borderBottom: '1px solid #333',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}
                >
                    <span style={{ color: '#569cd6', fontWeight: 'bold' }}>Event Log</span>
                    <button
                        onClick={() => setEventLog([])}
                        style={{
                            background: '#333',
                            border: 'none',
                            color: '#999',
                            padding: '4px 8px',
                            borderRadius: 4,
                            cursor: 'pointer',
                            fontSize: 10,
                        }}
                    >
                        Clear
                    </button>
                </div>
                {eventLog.length === 0 ? (
                    <div style={{ color: '#666', fontStyle: 'italic' }}>
                        Interact with the table to see events...
                    </div>
                ) : (
                    eventLog.map((entry) => (
                        <div
                            key={entry.id}
                            style={{
                                marginBottom: 8,
                                paddingBottom: 8,
                                borderBottom: '1px solid #2d2d2d',
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                <span style={{ color: entry.color, fontWeight: 'bold' }}>{entry.type}</span>
                                <span style={{ color: '#666', fontSize: 10 }}>{entry.timestamp}</span>
                            </div>
                            <div style={{ color: '#ccc', wordBreak: 'break-word' }}>{entry.message}</div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export const EventLog: StoryObj = {
    render: () => <EventLogDemo />,
};
