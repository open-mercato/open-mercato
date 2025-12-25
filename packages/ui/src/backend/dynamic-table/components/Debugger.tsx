// Debugger.tsx

import React, { useState, useRef, useCallback } from 'react';
import { useEventHandlers } from '../events/events';
import { TableEvents } from '../types/index';

interface LogEntry {
  id: number;
  timestamp: string;
  type: string;
  message: string;
  color: string;
  payload: any;
}

interface DebuggerProps {
  tableRef: React.RefObject<HTMLElement | null>;
}

const EVENT_COLORS: Record<string, string> = {
  // Cell events
  [TableEvents.CELL_EDIT_SAVE]: '#60a5fa',
  [TableEvents.CELL_SAVE_START]: '#fbbf24',
  [TableEvents.CELL_SAVE_SUCCESS]: '#4ade80',
  [TableEvents.CELL_SAVE_ERROR]: '#f87171',
  // New row events
  [TableEvents.NEW_ROW_SAVE]: '#fbbf24',
  [TableEvents.NEW_ROW_SAVE_START]: '#fbbf24',
  [TableEvents.NEW_ROW_SAVE_SUCCESS]: '#4ade80',
  [TableEvents.NEW_ROW_SAVE_ERROR]: '#f87171',
  // Filter events
  [TableEvents.FILTER_CHANGE]: '#fb923c',
  [TableEvents.FILTER_SAVE]: '#10b981',
  [TableEvents.FILTER_SELECT]: '#10b981',
  [TableEvents.FILTER_RENAME]: '#10b981',
  [TableEvents.FILTER_DELETE]: '#10b981',
  // Sort & search
  [TableEvents.COLUMN_SORT]: '#a78bfa',
  [TableEvents.SEARCH]: '#38bdf8',
  // Context menu
  [TableEvents.COLUMN_CONTEXT_MENU_ACTION]: '#e879f9',
  [TableEvents.ROW_CONTEXT_MENU_ACTION]: '#e879f9',
};

const formatEventName = (eventName: string): string => {
  return eventName.replace('table:', '').replace(/:/g, '_').toUpperCase();
};

const formatPayload = (eventName: string, payload: any): string => {
  switch (eventName) {
    case TableEvents.CELL_EDIT_SAVE:
      return `Row ${payload.rowIndex}, ${payload.prop}: "${payload.oldValue}" → "${payload.newValue}"`;
    case TableEvents.CELL_SAVE_START:
    case TableEvents.CELL_SAVE_SUCCESS:
      return `Row ${payload.rowIndex}, Col ${payload.colIndex}`;
    case TableEvents.CELL_SAVE_ERROR:
      return `Row ${payload.rowIndex}, Col ${payload.colIndex} - ${payload.error || 'Failed'}`;
    case TableEvents.NEW_ROW_SAVE:
      return `Saving row at index ${payload.rowIndex}`;
    case TableEvents.NEW_ROW_SAVE_SUCCESS:
      return `Row saved with ID ${payload.savedRowData?.id}`;
    case TableEvents.NEW_ROW_SAVE_ERROR:
      return `Failed: ${payload.error || 'Unknown error'}`;
    case TableEvents.FILTER_CHANGE:
      return `${payload.filters?.length || 0} filter(s) applied`;
    case TableEvents.FILTER_SAVE:
      return `Saved: "${payload.filter?.name}"`;
    case TableEvents.FILTER_SELECT:
      return payload.id ? `Selected: ${payload.id}` : 'Cleared filter';
    case TableEvents.FILTER_RENAME:
      return `Renamed to: "${payload.newName}"`;
    case TableEvents.FILTER_DELETE:
      return `Deleted: ${payload.id}`;
    case TableEvents.COLUMN_SORT:
      return `${payload.columnName} - ${payload.direction || 'cleared'}`;
    case TableEvents.SEARCH:
      return `Query: "${payload.query || ''}"`;
    case TableEvents.COLUMN_CONTEXT_MENU_ACTION:
      return `"${payload.actionId}" on "${payload.columnName}"`;
    case TableEvents.ROW_CONTEXT_MENU_ACTION:
      return `"${payload.actionId}" on row ${payload.rowIndex}`;
    default:
      return JSON.stringify(payload).slice(0, 100);
  }
};

const LogEntryItem: React.FC<{ entry: LogEntry }> = ({ entry }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      style={{
        marginBottom: 8,
        paddingBottom: 8,
        borderBottom: '1px solid #2d2d2d',
      }}
    >
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
          <span style={{ color: entry.color, fontWeight: 'bold', fontSize: 10 }}>
            <span style={{
              display: 'inline-block',
              width: 12,
              color: '#666',
              transition: 'transform 0.2s',
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            }}>
              ▶
            </span>
            {entry.type}
          </span>
          <span style={{ color: '#666', fontSize: 9 }}>{entry.timestamp}</span>
        </div>
        <div style={{ color: '#ccc', wordBreak: 'break-word', fontSize: 11, paddingLeft: 12 }}>
          {entry.message}
        </div>
      </div>

      {isExpanded && (
        <div
          style={{
            marginTop: 8,
            marginLeft: 12,
            padding: 8,
            background: '#252525',
            borderRadius: 4,
            fontSize: 10,
            lineHeight: 1.5,
            overflow: 'auto',
            maxHeight: 200,
          }}
        >
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {JSON.stringify(entry.payload, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

const Debugger: React.FC<DebuggerProps> = ({ tableRef }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [eventLog, setEventLog] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);

  const addLog = useCallback((eventName: string, payload: any) => {
    const timestamp = new Date().toLocaleTimeString();
    logIdRef.current++;
    const type = formatEventName(eventName);
    const message = formatPayload(eventName, payload);
    const color = EVENT_COLORS[eventName] || '#d4d4d4';

    setEventLog((prev) => [
      { id: logIdRef.current, timestamp, type, message, color, payload },
      ...prev,
    ].slice(0, 100));
  }, []);

  // Listen to all table events
  useEventHandlers({
    [TableEvents.CELL_EDIT_SAVE]: (p) => addLog(TableEvents.CELL_EDIT_SAVE, p),
    [TableEvents.CELL_SAVE_START]: (p) => addLog(TableEvents.CELL_SAVE_START, p),
    [TableEvents.CELL_SAVE_SUCCESS]: (p) => addLog(TableEvents.CELL_SAVE_SUCCESS, p),
    [TableEvents.CELL_SAVE_ERROR]: (p) => addLog(TableEvents.CELL_SAVE_ERROR, p),
    [TableEvents.NEW_ROW_SAVE]: (p) => addLog(TableEvents.NEW_ROW_SAVE, p),
    [TableEvents.NEW_ROW_SAVE_START]: (p) => addLog(TableEvents.NEW_ROW_SAVE_START, p),
    [TableEvents.NEW_ROW_SAVE_SUCCESS]: (p) => addLog(TableEvents.NEW_ROW_SAVE_SUCCESS, p),
    [TableEvents.NEW_ROW_SAVE_ERROR]: (p) => addLog(TableEvents.NEW_ROW_SAVE_ERROR, p),
    [TableEvents.FILTER_CHANGE]: (p) => addLog(TableEvents.FILTER_CHANGE, p),
    [TableEvents.FILTER_SAVE]: (p) => addLog(TableEvents.FILTER_SAVE, p),
    [TableEvents.FILTER_SELECT]: (p) => addLog(TableEvents.FILTER_SELECT, p),
    [TableEvents.FILTER_RENAME]: (p) => addLog(TableEvents.FILTER_RENAME, p),
    [TableEvents.FILTER_DELETE]: (p) => addLog(TableEvents.FILTER_DELETE, p),
    [TableEvents.COLUMN_SORT]: (p) => addLog(TableEvents.COLUMN_SORT, p),
    [TableEvents.SEARCH]: (p) => addLog(TableEvents.SEARCH, p),
    [TableEvents.COLUMN_CONTEXT_MENU_ACTION]: (p) => addLog(TableEvents.COLUMN_CONTEXT_MENU_ACTION, p),
    [TableEvents.ROW_CONTEXT_MENU_ACTION]: (p) => addLog(TableEvents.ROW_CONTEXT_MENU_ACTION, p),
  }, tableRef, { stopPropagation: false });

  const handleClear = useCallback(() => {
    setEventLog([]);
  }, []);

  return (
    <>
      {/* Debug Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: isOpen ? '#ef4444' : '#3b82f6',
          border: 'none',
          color: 'white',
          fontSize: 20,
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          transition: 'background 0.2s, transform 0.2s',
        }}
        title={isOpen ? 'Close debugger' : 'Open debugger'}
      >
        {isOpen ? '✕' : '🐛'}
      </button>

      {/* Floating Event Log Panel */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            bottom: 80,
            width: 420,
            background: '#1e1e1e',
            borderRadius: 8,
            fontFamily: 'Monaco, Consolas, monospace',
            fontSize: 11,
            color: '#d4d4d4',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            zIndex: 9998,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #333',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <span style={{ color: '#569cd6', fontWeight: 'bold', fontSize: 13 }}>
              Event Log
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: '#666', fontSize: 10 }}>
                {eventLog.length} events
              </span>
              <button
                onClick={handleClear}
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
          </div>

          {/* Event List */}
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              padding: 16,
            }}
          >
            {eventLog.length === 0 ? (
              <div style={{ color: '#666', fontStyle: 'italic', textAlign: 'center', paddingTop: 40 }}>
                Interact with the table to see events...
              </div>
            ) : (
              eventLog.map((entry) => (
                <LogEntryItem key={entry.id} entry={entry} />
              ))
            )}
          </div>

          {/* Footer hint */}
          <div
            style={{
              padding: '8px 16px',
              borderTop: '1px solid #333',
              color: '#666',
              fontSize: 9,
              textAlign: 'center',
              flexShrink: 0,
            }}
          >
            Click an event to view full payload
          </div>
        </div>
      )}
    </>
  );
};

export default Debugger;
