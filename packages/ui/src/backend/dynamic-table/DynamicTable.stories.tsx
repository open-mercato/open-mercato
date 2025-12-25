// DynamicTable.stories.tsx

import React, { useState, useCallback, useRef } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import DynamicTable from './DynamicTable';
import { TableEvents } from './types/index';
import { dispatch, useEventHandlers } from './events/events';
import type {
    ContextMenuAction,
    ColumnDef,
    SavedFilter,
} from './types/index';

const meta: Meta<typeof DynamicTable> = {
    title: 'Components/DynamicTable',
    component: DynamicTable,
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
// DRAWER COMPONENT
// ============================================================================

interface DrawerProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
}

const Drawer: React.FC<DrawerProps> = ({ isOpen, onClose, title, children }) => {
    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                onClick={onClose}
                style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(0, 0, 0, 0.3)',
                    zIndex: 10000,
                }}
            />
            {/* Drawer Panel */}
            <div
                style={{
                    position: 'fixed',
                    top: 0,
                    right: 0,
                    bottom: 0,
                    width: 420,
                    background: 'white',
                    boxShadow: '-4px 0 12px rgba(0, 0, 0, 0.15)',
                    zIndex: 10001,
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                {/* Header */}
                <div
                    style={{
                        padding: '16px 20px',
                        borderBottom: '1px solid #e5e7eb',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}
                >
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#111827' }}>
                        {title}
                    </h3>
                    <button
                        onClick={onClose}
                        style={{
                            width: 32,
                            height: 32,
                            border: 'none',
                            background: '#f3f4f6',
                            borderRadius: 6,
                            cursor: 'pointer',
                            fontSize: 18,
                            color: '#6b7280',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        ×
                    </button>
                </div>
                {/* Content */}
                <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
                    {children}
                </div>
            </div>
        </>
    );
};

// ============================================================================
// VIEW DETAILS ICON BUTTON
// ============================================================================

const ViewDetailsButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
    <button
        onClick={(e) => {
            e.stopPropagation();
            onClick();
        }}
        style={{
            width: 28,
            height: 28,
            border: '1px solid #e5e7eb',
            background: 'white',
            borderRadius: 6,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s',
        }}
        onMouseEnter={(e) => {
            e.currentTarget.style.background = '#f3f4f6';
            e.currentTarget.style.borderColor = '#d1d5db';
        }}
        onMouseLeave={(e) => {
            e.currentTarget.style.background = 'white';
            e.currentTarget.style.borderColor = '#e5e7eb';
        }}
        title="View details"
    >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    </button>
);

// ============================================================================
// STORY 1: FULL FEATURED DEMO (DEFAULT)
// ============================================================================

const FullFeaturedDemo = () => {
    const tableRef = useRef<HTMLDivElement>(null);
    const [allData] = useState(() => generateData(250));
    const [currentPage, setCurrentPage] = useState(1);
    const [limit, setLimit] = useState(25);

    // Drawer state
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [selectedRowData, setSelectedRowData] = useState<any>(null);

    const handleViewDetails = useCallback((rowData: any) => {
        setSelectedRowData(rowData);
        setDrawerOpen(true);
    }, []);

    // Columns with view details
    const columns: ColumnDef[] = [
        ...getColumns(),
        {
            data: '_viewDetails',
            width: 60,
            title: '',
            readOnly: true,
            renderer: (_value: any, rowData: any) => (
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <ViewDetailsButton onClick={() => handleViewDetails(rowData)} />
                </div>
            ),
        },
    ];

    // Filter state (managed locally, would typically come from API)
    // Pre-populate with color-coded filters for demo
    const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([
        { id: 'engineering', name: 'Engineering', rows: [{ id: '1', field: 'department', operator: 'equals', values: ['Engineering'] }], color: 'blue' },
        { id: 'active-only', name: 'Active Only', rows: [{ id: '2', field: 'active', operator: 'equals', values: [true] }], color: 'green' },
        { id: 'high-salary', name: 'High Salary', rows: [{ id: '3', field: 'salary', operator: 'greaterThan', values: [80000] }], color: 'purple' },
        { id: 'us-employees', name: 'US Employees', rows: [{ id: '4', field: 'country', operator: 'equals', values: ['USA'] }], color: 'orange' },
        { id: 'seniors', name: 'Seniors', rows: [{ id: '5', field: 'role', operator: 'contains', values: ['Senior', 'Lead'] }], color: 'teal' },
    ]);
    const [activeFilterId, setActiveFilterId] = useState<string | null>(null);

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

    // Event handlers
    useEventHandlers({
        [TableEvents.CELL_EDIT_SAVE]: async (payload) => {
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
        },
        [TableEvents.NEW_ROW_SAVE]: async (payload) => {
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
        },
        [TableEvents.COLUMN_SORT]: (payload) => {
            if (payload.direction) {
                console.log('Sort:', payload.columnName, payload.direction);
            }
        },
        [TableEvents.ROW_CONTEXT_MENU_ACTION]: (payload) => {
            if (payload.actionId === 'delete') {
                console.log('Delete row:', payload.rowIndex);
            } else if (payload.actionId === 'duplicate') {
                console.log('Duplicate row:', payload.rowIndex);
            }
        },
        [TableEvents.FILTER_SAVE]: (payload) => {
            setSavedFilters(prev => [...prev, payload.filter]);
            setActiveFilterId(payload.filter.id);
        },
        [TableEvents.FILTER_SELECT]: (payload) => {
            setActiveFilterId(payload.id);
            console.log('Filter selected:', payload.id, payload.filterRows);
        },
        [TableEvents.FILTER_RENAME]: (payload) => {
            setSavedFilters(prev => prev.map(f => f.id === payload.id ? { ...f, name: payload.newName } : f));
        },
        [TableEvents.FILTER_DELETE]: (payload) => {
            setSavedFilters(prev => prev.filter(f => f.id !== payload.id));
            if (activeFilterId === payload.id) {
                setActiveFilterId(null);
            }
        },
    }, tableRef);

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
                <h3 style={{ margin: '0 0 8px' }}>DynamicTable - Full Featured Demo</h3>
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

            <DynamicTable
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
                savedFilters={savedFilters}
                activeFilterId={activeFilterId}
            />

            {/* Row Details Drawer */}
            <Drawer
                isOpen={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                title={selectedRowData ? `Employee: ${selectedRowData.name}` : 'Details'}
            >
                {selectedRowData && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {Object.entries(selectedRowData).map(([key, value]) => (
                            <div key={key} style={{ borderBottom: '1px solid #f3f4f6', paddingBottom: 12 }}>
                                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, textTransform: 'capitalize' }}>
                                    {key.replace(/([A-Z])/g, ' $1').trim()}
                                </div>
                                <div style={{ fontSize: 14, color: '#111827' }}>
                                    {typeof value === 'boolean' ? (
                                        <span style={{
                                            padding: '2px 8px',
                                            borderRadius: 4,
                                            background: value ? '#d1fae5' : '#fee2e2',
                                            color: value ? '#059669' : '#dc2626',
                                            fontSize: 12,
                                        }}>
                                            {value ? 'Yes' : 'No'}
                                        </span>
                                    ) : key === 'salary' ? (
                                        `$${(value as number).toLocaleString()}`
                                    ) : (
                                        String(value ?? '-')
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Drawer>
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

    // Filter state with color-coded demo filters
    const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([
        { id: 'pending-review', name: 'Pending Review', rows: [{ id: '1', field: 'status', operator: 'equals', values: ['Pending'] }], color: 'yellow' },
        { id: 'on-leave', name: 'On Leave', rows: [{ id: '2', field: 'status', operator: 'equals', values: ['On Leave'] }], color: 'red' },
    ]);
    const [activeFilterId, setActiveFilterId] = useState<string | null>(null);
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

    // Event handlers - all table events in one place
    useEventHandlers({
        [TableEvents.CELL_EDIT_SAVE]: (payload) => {
            const colName = columns[payload.colIndex]?.data || `col${payload.colIndex}`;
            addLog(
                'CELL_EDIT_SAVE',
                `Row ${payload.rowIndex}, ${colName}: "${payload.oldValue}" → "${payload.newValue}"`,
                '#60a5fa'
            );

            dispatch(tableRef.current!, TableEvents.CELL_SAVE_START, {
                rowIndex: payload.rowIndex,
                colIndex: payload.colIndex,
            });

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
        },
        [TableEvents.CELL_SAVE_START]: (payload) => {
            const colName = columns[payload.colIndex]?.data || `col${payload.colIndex}`;
            addLog('CELL_SAVE_START', `Saving row ${payload.rowIndex}, ${colName}...`, '#fbbf24');
        },
        [TableEvents.CELL_SAVE_SUCCESS]: (payload) => {
            const colName = columns[payload.colIndex]?.data || `col${payload.colIndex}`;
            addLog('CELL_SAVE_SUCCESS', `Row ${payload.rowIndex}, ${colName} saved!`, '#4ade80');
        },
        [TableEvents.CELL_SAVE_ERROR]: (payload) => {
            const colName = columns[payload.colIndex]?.data || `col${payload.colIndex}`;
            addLog('CELL_SAVE_ERROR', `Row ${payload.rowIndex}, ${colName} - ${payload.error}`, '#f87171');
        },
        [TableEvents.NEW_ROW_SAVE]: (payload) => {
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
        },
        [TableEvents.NEW_ROW_SAVE_SUCCESS]: (payload) => {
            addLog('NEW_ROW_SAVE_SUCCESS', `New row saved with ID ${payload.savedRowData?.id}`, '#4ade80');
        },
        [TableEvents.NEW_ROW_SAVE_ERROR]: (payload) => {
            addLog('NEW_ROW_SAVE_ERROR', `Failed: ${payload.error}`, '#f87171');
        },
        [TableEvents.COLUMN_SORT]: (payload) => {
            addLog(
                'COLUMN_SORT',
                `Column "${payload.columnName}" - ${payload.direction || 'cleared'}`,
                '#a78bfa'
            );
            if (payload.direction) {
                setAllData((prev) =>
                    [...prev].sort((a, b) => {
                        const aVal = (a as Record<string, any>)[payload.columnName];
                        const bVal = (b as Record<string, any>)[payload.columnName];
                        if (aVal < bVal) return payload.direction === 'asc' ? -1 : 1;
                        if (aVal > bVal) return payload.direction === 'asc' ? 1 : -1;
                        return 0;
                    })
                );
            }
        },
        [TableEvents.SEARCH]: (payload) => {
            addLog('SEARCH', `Query: "${payload.query || '(empty)'}"`, '#38bdf8');
        },
        [TableEvents.FILTER_CHANGE]: (payload) => {
            addLog('FILTER_CHANGE', `${payload.filters.length} filter(s) applied`, '#fb923c');
        },
        [TableEvents.COLUMN_CONTEXT_MENU_ACTION]: (payload) => {
            addLog('COLUMN_MENU', `"${payload.actionId}" on column "${payload.columnName}"`, '#e879f9');
        },
        [TableEvents.ROW_CONTEXT_MENU_ACTION]: (payload) => {
            addLog('ROW_MENU', `"${payload.actionId}" on row ${payload.rowIndex}`, '#e879f9');

            if (payload.actionId === 'delete') {
                setAllData((prev) => prev.filter((_, i) => i !== payload.rowIndex));
            } else if (payload.actionId === 'duplicate') {
                setAllData((prev) => {
                    const newRow = { ...payload.rowData, id: Math.max(...prev.map((r: any) => r.id)) + 1 };
                    const newData = [...prev];
                    newData.splice(payload.rowIndex + 1, 0, newRow);
                    return newData;
                });
            }
        },
        [TableEvents.FILTER_SAVE]: (payload) => {
            setSavedFilters(prev => [...prev, payload.filter]);
            setActiveFilterId(payload.filter.id);
            addLog('FILTER_SAVE', `Saved filter: "${payload.filter.name}"`, '#10b981');
        },
        [TableEvents.FILTER_SELECT]: (payload) => {
            setActiveFilterId(payload.id);
            addLog('FILTER_SELECT', payload.id ? `Selected filter: ${payload.id}` : 'Cleared filter', '#10b981');
        },
        [TableEvents.FILTER_RENAME]: (payload) => {
            setSavedFilters(prev => prev.map(f => f.id === payload.id ? { ...f, name: payload.newName } : f));
            addLog('FILTER_RENAME', `Renamed filter to: "${payload.newName}"`, '#10b981');
        },
        [TableEvents.FILTER_DELETE]: (payload) => {
            const filter = savedFilters.find(f => f.id === payload.id);
            setSavedFilters(prev => prev.filter(f => f.id !== payload.id));
            if (activeFilterId === payload.id) {
                setActiveFilterId(null);
            }
            addLog('FILTER_DELETE', `Deleted filter: "${filter?.name}"`, '#10b981');
        },
    }, tableRef);

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
                <DynamicTable
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
                    savedFilters={savedFilters}
                    activeFilterId={activeFilterId}
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

// ============================================================================
// STORY 3: DEBUG MODE DEMO
// ============================================================================

const DebugModeDemo = () => {
    const tableRef = useRef<HTMLDivElement>(null);
    const [allData] = useState(() => generateData(100));
    const [currentPage, setCurrentPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const columns = getColumns();

    // Filter state with color-coded demo filters
    const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([
        { id: 'marketing', name: 'Marketing', rows: [{ id: '1', field: 'department', operator: 'equals', values: ['Marketing'] }], color: 'pink' },
        { id: 'managers', name: 'Managers', rows: [{ id: '2', field: 'role', operator: 'equals', values: ['Manager'] }], color: 'blue' },
        { id: 'new-hires', name: 'New Hires (2024)', rows: [{ id: '3', field: 'startDate', operator: 'contains', values: ['2024'] }], color: 'green' },
    ]);
    const [activeFilterId, setActiveFilterId] = useState<string | null>(null);

    // Pagination calculations
    const totalPages = Math.ceil(allData.length / limit);
    const startIndex = (currentPage - 1) * limit;
    const data = allData.slice(startIndex, startIndex + limit);

    // Event handlers for filter management
    useEventHandlers({
        [TableEvents.CELL_EDIT_SAVE]: async (payload) => {
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
        },
        [TableEvents.FILTER_SAVE]: (payload) => {
            setSavedFilters(prev => [...prev, payload.filter]);
            setActiveFilterId(payload.filter.id);
        },
        [TableEvents.FILTER_SELECT]: (payload) => {
            setActiveFilterId(payload.id);
        },
        [TableEvents.FILTER_RENAME]: (payload) => {
            setSavedFilters(prev => prev.map(f => f.id === payload.id ? { ...f, name: payload.newName } : f));
        },
        [TableEvents.FILTER_DELETE]: (payload) => {
            setSavedFilters(prev => prev.filter(f => f.id !== payload.id));
            if (activeFilterId === payload.id) {
                setActiveFilterId(null);
            }
        },
    }, tableRef);

    return (
        <div>
            <div
                style={{
                    padding: 16,
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    borderRadius: 8,
                    marginBottom: 16,
                    color: 'white',
                }}
            >
                <h3 style={{ margin: '0 0 8px' }}>Debug Mode Demo</h3>
                <p style={{ margin: 0, fontSize: 13, opacity: 0.9 }}>
                    Click the bug icon in the bottom-right corner to open the event debugger.
                    All table events will be logged there in real-time.
                </p>
            </div>

            <DynamicTable
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
                    onPageChange: (page) => setCurrentPage(Math.max(1, Math.min(page, totalPages))),
                    onLimitChange: (newLimit) => { setLimit(newLimit); setCurrentPage(1); },
                }}
                savedFilters={savedFilters}
                activeFilterId={activeFilterId}
                debug={true}
                hiddenColumns={['id', 'status', 'department']}
            />
        </div>
    );
};

export const DebugMode: StoryObj = {
    render: () => <DebugModeDemo />,
};

// ============================================================================
// STORY 4: MINIMAL TABLE (UI CONFIG DEMO)
// ============================================================================

const MinimalTableDemo = () => {
    const tableRef = useRef<HTMLDivElement>(null);
    const [data] = useState(() => generateData(50));
    const columns = getColumns();

    return (
        <div>
            <div
                style={{
                    padding: 16,
                    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                    borderRadius: 8,
                    marginBottom: 16,
                    color: 'white',
                }}
            >
                <h3 style={{ margin: '0 0 8px' }}>Minimal Table - UI Config Demo</h3>
                <p style={{ margin: 0, fontSize: 13, opacity: 0.9 }}>
                    This table hides all UI elements: toolbar, search, filter button, add row button, and bottom bar.
                    Only the table data and column headers are visible.
                </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                {/* Minimal - Hide Everything */}
                <div>
                    <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#374151' }}>
                        Hide All UI (uiConfig.hideToolbar + hideBottomBar)
                    </h4>
                    <DynamicTable
                        tableRef={tableRef}
                        data={data.slice(0, 10)}
                        columns={columns}
                        colHeaders={true}
                        rowHeaders={false}
                        height={300}
                        tableName="Minimal Table"
                        idColumnName="id"
                        uiConfig={{
                            hideToolbar: true,
                            hideBottomBar: true,
                        }}
                    />
                </div>

                {/* Hide only filter and add buttons */}
                <div>
                    <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#374151' }}>
                        Hide Filter + Add Row Buttons Only
                    </h4>
                    <DynamicTable
                        tableRef={useRef<HTMLDivElement>(null)}
                        data={data.slice(0, 10)}
                        columns={columns}
                        colHeaders={true}
                        rowHeaders={false}
                        height={300}
                        tableName="Search Only Table"
                        idColumnName="id"
                        uiConfig={{
                            hideFilterButton: true,
                            hideAddRowButton: true,
                            hideBottomBar: true,
                        }}
                    />
                </div>

                {/* Hide search only */}
                <div>
                    <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#374151' }}>
                        Hide Search Bar Only
                    </h4>
                    <DynamicTable
                        tableRef={useRef<HTMLDivElement>(null)}
                        data={data.slice(0, 10)}
                        columns={columns}
                        colHeaders={true}
                        rowHeaders={false}
                        height={300}
                        tableName="No Search Table"
                        idColumnName="id"
                        savedFilters={[
                            { id: 'active', name: 'Active', rows: [], color: 'green' },
                            { id: 'pending', name: 'Pending', rows: [], color: 'yellow' },
                        ]}
                        uiConfig={{
                            hideSearch: true,
                        }}
                    />
                </div>

                {/* Full featured for comparison */}
                <div>
                    <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#374151' }}>
                        Full Featured (Default)
                    </h4>
                    <DynamicTable
                        tableRef={useRef<HTMLDivElement>(null)}
                        data={data.slice(0, 10)}
                        columns={columns}
                        colHeaders={true}
                        rowHeaders={true}
                        height={300}
                        tableName="Full Featured Table"
                        idColumnName="id"
                        savedFilters={[
                            { id: 'engineering', name: 'Engineering', rows: [], color: 'blue' },
                            { id: 'sales', name: 'Sales', rows: [], color: 'purple' },
                        ]}
                        pagination={{
                            currentPage: 1,
                            totalPages: 5,
                            limit: 10,
                            onPageChange: () => {},
                            onLimitChange: () => {},
                        }}
                    />
                </div>
            </div>
        </div>
    );
};

export const MinimalTable: StoryObj = {
    render: () => <MinimalTableDemo />,
};
