# HOT Table Component - Architecture & Optimization Guide

## Overview

Excel-like table component with cell-level state management. Each cell subscribes individually to a central store, minimizing re-renders.

## Core Architecture

### State Management

```
CellStore (useRef, not useState)
├── cellData: Map<CellId, value>
├── rowDataMap: Map<rowIndex, rowObject>
├── selection: SelectionState
├── editingCell: { row, col } | null
├── saveStates: Map<CellId, 'saving'|'success'|'error'>
├── columnWidths: Map<colIndex, width>
├── revisions: Map<CellId, number>  ← triggers re-renders
└── subscribers: Map<CellId, Set<callback>>
```

**Key principle**: Only `revisions` trigger re-renders. All other state is read imperatively.

### Cell Subscription Pattern

```typescript
// Cell subscribes via useSyncExternalStore
useSyncExternalStore(
  (cb) => store.subscribe(row, col, cb),  // subscribe
  () => store.getRevision(row, col)        // getSnapshot (revision number)
);
```

- Cell re-renders ONLY when its revision bumps
- Unmounting unsubscribes automatically
- ~800 subscriptions is acceptable (Map lookups are O(1))

### Selection Change Flow

1. Update `selection` in store
2. Calculate old bounds + new bounds
3. Bump revisions for cells in union of both bounds
4. Only affected cells re-render

## File Structure

| File | Purpose |
|------|---------|
| `types.ts` | All interfaces, event types, constants |
| `store.ts` | CellStore implementation |
| `hooks.ts` | `useCellState`, keyboard, copy, drag hooks |
| `handlers.ts` | Mouse, keyboard, context menu handlers |
| `events/events.ts` | Event dispatch/mediator utilities |
| `HOT.tsx` | Main component, Cell, VirtualRow, ColumnHeaders |

## Optimization Rules

### DO

1. **Bump only affected cells** - Never bump all cells on selection change
2. **Keep editing value local** - Editor holds local state, only commits to store on save
3. **Use memo on Cell** - Cell is memoized, relies on revision for updates
4. **Read imperatively for handlers** - `store.getCellsInSelection()` doesn't trigger renders
5. **Batch revision bumps** - Use `bumpRevisions([...cells])` not multiple `bumpRevision()` calls

### DON'T

1. **Don't use useState for cell data** - Causes cascade re-renders
2. **Don't pass selection as props** - Cells derive from store
3. **Don't store editing value in store** - Keep it local in Editor
4. **Don't subscribe to entire store** - Subscribe only to specific cell

## Adding New Features

### New Cell State Property

```typescript
// 1. Add to store state
const myNewStates = new Map<CellId, MyType>();

// 2. Add getter
getMyState(row, col): MyType { return myNewStates.get(getCellId(row, col)); }

// 3. Add setter that bumps revision
setMyState(row, col, value): void {
  myNewStates.set(getCellId(row, col), value);
  bumpRevision(row, col);  // ← required!
}

// 4. Include in getCellState()
getCellState(row, col): CellState {
  return {
    ...existing,
    myState: this.getMyState(row, col),
  };
}
```

### New Selection Type

```typescript
// 1. Add to SelectionState.type union
type: 'cell' | 'range' | 'row' | 'column' | 'myNewType' | null

// 2. Handle in calcBounds()
if (selection.type === 'myNewType') {
  return { startRow, endRow, startCol, endCol };
}

// 3. Handle in drag handlers
if (type === 'myNewType') {
  store.setSelection({ type: 'myNewType', anchor, focus });
}
```

### New Editor Type

```typescript
// 1. Add to ColumnDef.type
type?: 'text' | 'numeric' | 'date' | 'dropdown' | 'boolean' | 'myEditor'

// 2. Add Editor component in editors.ts
export const MyEditor: React.FC<EditorProps> = ({ initialValue, onSave, onCancel }) => {
  const [value, setValue] = useState(initialValue);
  // Local state only, commit on save
  return <input ... onBlur={() => onSave(value)} />;
};

// 3. Add case in getCellEditor()
case 'myEditor':
  return <MyEditor ... />;
```

## Performance Checklist

- [ ] Selection change bumps ≤ (oldRange + newRange) cells
- [ ] Editing only bumps 1-2 cells (previous + current)
- [ ] Column resize bumps only visible cells in that column
- [ ] Data update (`setData`) only bumps subscribed cells
- [ ] No `useState` for data that affects cell rendering
- [ ] Cell component is memoized
- [ ] Handlers use `useCallback` with stable deps

## Event Flow

```
User Action → Handler → Store Update → Bump Revisions → Cell Re-renders
                ↓
            Dispatch Event → useMediator → External Handler
```

### Save Flow Example

```
Edit Cell → Local State in Editor
    ↓
Blur/Enter → onSave(value)
    ↓
store.setCellValue() + store.clearEditing()
    ↓
Dispatch CELL_EDIT_SAVE event
    ↓
External: CELL_SAVE_START → API call → CELL_SAVE_SUCCESS/ERROR
    ↓
store.setSaveState() → cell shows loading/success/error state
```

## Testing Priorities

1. **Selection performance** - Select range of 100 cells, verify only ~100 re-renders
2. **Virtualization** - Scroll 10k rows, verify unmounted cells unsubscribe
3. **Editing flow** - Tab through cells, verify saves trigger correctly
4. **Copy/paste** - Select range, copy, verify clipboard content
5. **New row** - Add row, edit, save, verify ID updates

## Known Limitations

1. Row insert/delete shifts all indices - requires re-indexing subscriptions
2. Column reorder not implemented - would need column ID instead of index
3. Undo/redo not implemented - would need revision history in store

## Dependencies

- `@tanstack/react-virtual` - Row virtualization
- `react-datepicker` - Date editor
- `react-dom` - Portal for editor popups

## External Components Required

These must exist alongside the refactored code:

- `renderers.ts` - `getCellRenderer()`
- `editors.ts` - `getCellEditor()`
- `FilterBuilder.tsx`
- `FilterTabs.tsx`
- `SearchBar.tsx`
- `ContextMenu.tsx`
- `HOT.css`