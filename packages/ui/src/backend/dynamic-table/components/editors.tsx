import React, { useRef, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import DatePicker from 'react-datepicker';

if (typeof window !== 'undefined') {
    import('react-datepicker/dist/react-datepicker.css');
}

interface BaseEditorProps {
    value: any;
    onChange: (newValue: any) => void;
    onSave: (newValue?: any) => void; // Accept optional value parameter
    onCancel: () => void;
    col: any;
    inputRef?: React.RefObject<any>;
}

// Portal component for rendering popups outside the cell
const EditorPortal: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        return () => setMounted(false);
    }, []);

    if (!mounted) return null;

    return ReactDOM.createPortal(
        children,
        document.body
    );
};

// Helper to calculate popup position
const POPUP_MAX_HEIGHT = 250;

const calculatePopupPosition = (cellRef: React.RefObject<HTMLElement | null>) => {
    if (!cellRef.current) return { top: 0, left: 0, width: 0, openAbove: false };

    const rect = cellRef.current.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;

    // Default position: below the cell
    let top = rect.bottom + scrollTop + 2; // Add 2px gap
    let left = rect.left + scrollLeft;
    let openAbove = false;

    // Only position above if there's significantly more space above
    // and not enough space below (be more conservative about flipping)
    if (spaceBelow < POPUP_MAX_HEIGHT && spaceAbove > spaceBelow + 100) {
        // Position above the cell instead
        top = rect.top + scrollTop - POPUP_MAX_HEIGHT - 2; // Add 2px gap
        openAbove = true;
    }

    // Check if popup would go off right side of screen
    const popupWidth = rect.width;
    if (rect.left + popupWidth > viewportWidth - 20) {
        left = viewportWidth - popupWidth - 20 + scrollLeft;
    }

    // Check if popup would go off left side
    if (left < scrollLeft + 10) {
        left = scrollLeft + 10;
    }

    return {
        top,
        left,
        width: rect.width,
        openAbove,
    };
};

// TEXT EDITOR (Default)
export const TextEditor: React.FC<BaseEditorProps> = ({
    value,
    onChange,
    onSave,
    onCancel,
    inputRef
}) => {
    const [textValue, setTextValue] = useState(String(value ?? ''));

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSave(textValue);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        } else if (e.key === 'Tab') {
            // Save before Tab navigation (handled by document-level handler)
            onSave(textValue);
        }
    };

    return (
        <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={textValue}
            onChange={(e) => {
                setTextValue(e.target.value);
                onChange(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            onBlur={() => onSave(textValue)}
            className="hot-cell-editor"
        />
    );
};

// NUMERIC EDITOR
export const NumericEditor: React.FC<BaseEditorProps> = ({
    value,
    onChange,
    onSave,
    onCancel,
    inputRef
}) => {
    const [textValue, setTextValue] = useState(String(value ?? ''));

    const getNumericValue = () => {
        const numVal = parseFloat(textValue);
        return textValue === '' ? '' : (isNaN(numVal) ? textValue : numVal);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSave(getNumericValue());
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        } else if (e.key === 'Tab') {
            // Save before Tab navigation (handled by document-level handler)
            onSave(getNumericValue());
        }
    };

    return (
        <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={textValue}
            onChange={(e) => {
                const val = e.target.value;
                setTextValue(val);
                const numVal = parseFloat(val);
                onChange(val === '' ? '' : (isNaN(numVal) ? val : numVal));
            }}
            onKeyDown={handleKeyDown}
            onBlur={() => onSave(getNumericValue())}
            className="hot-cell-editor hot-numeric-editor"
        />
    );
};

// DATE EDITOR with Calendar Popup
export const DateEditor: React.FC<BaseEditorProps> = ({
    value,
    onChange,
    onSave,
    onCancel,
    inputRef
}) => {
    const [showCalendar, setShowCalendar] = useState(true);
    const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
    const cellRef = useRef<HTMLTextAreaElement>(null);
    const calendarRef = useRef<HTMLDivElement>(null);
    const textValueRef = useRef(String(value ?? '')); // Track current value for click-outside handler

    // Parse date value
    const parseDate = (val: any) => {
        if (!val) return null;
        const date = new Date(val);
        return isNaN(date.getTime()) ? null : date;
    };

    const [selectedDate, setSelectedDate] = useState<Date | null>(parseDate(value));
    const [textValue, setTextValue] = useState(String(value ?? ''));

    // Keep ref in sync with state for click-outside handler
    useEffect(() => {
        textValueRef.current = textValue;
    }, [textValue]);

    // Handle clicks outside both textarea and calendar
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            const isOutsideTextarea = cellRef.current && !cellRef.current.contains(target);
            const isOutsideCalendar = !calendarRef.current || !calendarRef.current.contains(target);

            if (isOutsideTextarea && isOutsideCalendar) {
                onSave(textValueRef.current);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onSave]);

    useEffect(() => {
        if (cellRef.current) {
            const pos = calculatePopupPosition(cellRef);
            setPosition(pos);
        }

        // Update position on scroll/resize
        const updatePosition = () => {
            if (cellRef.current && showCalendar) {
                const pos = calculatePopupPosition(cellRef);
                setPosition(pos);
            }
        };

        window.addEventListener('scroll', updatePosition, true);
        window.addEventListener('resize', updatePosition);

        return () => {
            window.removeEventListener('scroll', updatePosition, true);
            window.removeEventListener('resize', updatePosition);
        };
    }, [showCalendar]);

    const handleDateChange = (date: Date | null) => {
        if (date) {
            const formatted = date.toISOString().split('T')[0];

            // Update local state
            setTextValue(formatted);
            setSelectedDate(date);
            setShowCalendar(false);

            // Update parent state
            onChange(formatted);

            // Save immediately with the formatted value
            onSave(formatted);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            setShowCalendar(false);
            onSave(textValue);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setShowCalendar(false);
            onCancel();
        } else if (e.key === 'Tab') {
            // Save before Tab navigation (handled by document-level handler)
            setShowCalendar(false);
            onSave(textValue);
        }
    };

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setTextValue(val);
        onChange(val);

        // Try to parse as date
        const parsed = parseDate(val);
        if (parsed) {
            setSelectedDate(parsed);
        }
    };

    return (
        <>
            <textarea
                ref={(el) => {
                    cellRef.current = el;
                    if (inputRef) {
                        (inputRef as React.MutableRefObject<any>).current = el;
                    }
                }}
                value={textValue}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                onBlur={() => {
                    // Don't save on blur - handled by click-outside or calendar selection
                }}
                className="hot-cell-editor hot-date-editor"
                placeholder="YYYY-MM-DD"
            />

            {showCalendar && (
                <EditorPortal>
                    <div
                        ref={calendarRef}
                        className="hot-editor-popup hot-calendar-popup"
                        style={{
                            position: 'absolute',
                            top: `${position.top}px`,
                            left: `${position.left}px`,
                            zIndex: 10000,
                        }}
                        onMouseDown={(e) => {
                            e.stopPropagation();
                        }}
                    >
                        <DatePicker
                            selected={selectedDate}
                            onChange={handleDateChange}
                            inline
                            calendarClassName="hot-datepicker"
                        />
                    </div>
                </EditorPortal>
            )}
        </>
    );
};

// DROPDOWN EDITOR with Custom Popup
export const DropdownEditor: React.FC<BaseEditorProps> = ({
    value,
    onChange,
    onSave,
    onCancel,
    col,
    inputRef
}) => {
    const options = col.source || [];
    const [showDropdown, setShowDropdown] = useState(true);
    const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
    const [textValue, setTextValue] = useState(String(value ?? ''));
    const [filteredOptions, setFilteredOptions] = useState(options); // Start with ALL options
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const [hasUserTyped, setHasUserTyped] = useState(false); // Track if user has typed

    const cellRef = useRef<HTMLTextAreaElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const isClickingDropdownRef = useRef(false);

    useEffect(() => {
        if (cellRef.current) {
            const pos = calculatePopupPosition(cellRef);
            setPosition(pos);
        }

        // Update position on scroll/resize
        const updatePosition = () => {
            if (cellRef.current && showDropdown) {
                const pos = calculatePopupPosition(cellRef);
                setPosition(pos);
            }
        };

        window.addEventListener('scroll', updatePosition, true);
        window.addEventListener('resize', updatePosition);

        return () => {
            window.removeEventListener('scroll', updatePosition, true);
            window.removeEventListener('resize', updatePosition);
        };
    }, [showDropdown]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const isOutsideCell = cellRef.current && !cellRef.current.contains(e.target as Node);
            const isOutsideDropdown = !dropdownRef.current || !dropdownRef.current.contains(e.target as Node);

            if (isOutsideCell && isOutsideDropdown) {
                setShowDropdown(false);
                onSave(textValue);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onSave, textValue]);

    // Filter options ONLY when user has typed
    useEffect(() => {
        if (!hasUserTyped) {
            // On initial open, show all options
            setFilteredOptions(options);
            return;
        }

        // User has typed, now filter
        const filterText = textValue.toLowerCase();
        const filtered = options.filter((opt: any) => {
            const label = typeof opt === 'string' ? opt : opt.label;
            return label.toLowerCase().includes(filterText);
        });
        setFilteredOptions(filtered);
        setHighlightedIndex(0);
    }, [textValue, options, hasUserTyped]);

    const handleOptionClick = (option: any) => {
        const selectedValue = typeof option === 'string' ? option : option.value;

        // Update local state
        setTextValue(selectedValue);
        setShowDropdown(false);

        // Update parent state
        onChange(selectedValue);

        // Save immediately with the selected value
        onSave(selectedValue);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();

            // If dropdown is showing and has filtered options, select highlighted
            if (showDropdown && filteredOptions.length > 0) {
                const selected = filteredOptions[highlightedIndex];
                handleOptionClick(selected);
            } else {
                setShowDropdown(false);
                onSave();
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setShowDropdown(false);
            onCancel();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightedIndex(prev =>
                prev < filteredOptions.length - 1 ? prev + 1 : prev
            );
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightedIndex(prev => prev > 0 ? prev - 1 : 0);
        } else if (e.key === 'Tab') {
            // Save before Tab navigation (handled by document-level handler)
            setShowDropdown(false);
            onSave(textValue);
        }
    };

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setTextValue(val);
        onChange(val);
        setShowDropdown(true);
        setHasUserTyped(true); // Mark that user has typed
    };

    return (
        <>
            <textarea
                ref={(el) => {
                    cellRef.current = el;
                    if (inputRef) {
                        (inputRef as React.MutableRefObject<any>).current = el;
                    }
                }}
                value={textValue}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                onBlur={() => {
                    // Only save if not clicking on dropdown
                    if (!isClickingDropdownRef.current) {
                        onSave(textValue);
                    }
                }}
                className="hot-cell-editor hot-dropdown-editor"
                placeholder="Type to filter..."
            />

            {showDropdown && filteredOptions.length > 0 && (
                <EditorPortal>
                    <div
                        ref={dropdownRef}
                        className="hot-editor-popup hot-dropdown-popup"
                        style={{
                            position: 'absolute',
                            top: `${position.top}px`,
                            left: `${position.left}px`,
                            width: `${position.width}px`,
                            maxHeight: `${POPUP_MAX_HEIGHT}px`,
                            overflowY: 'auto',
                            zIndex: 10000,
                        }}
                        onMouseDown={() => {
                            isClickingDropdownRef.current = true;
                        }}
                        onMouseUp={() => {
                            isClickingDropdownRef.current = false;
                        }}
                    >
                        {filteredOptions.map((option: any, index: number) => {
                            const optValue = typeof option === 'string' ? option : option.value;
                            const optLabel = typeof option === 'string' ? option : option.label;

                            return (
                                <div
                                    key={index}
                                    className={`hot-dropdown-option ${index === highlightedIndex ? 'highlighted' : ''}`}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        handleOptionClick(option);
                                    }}
                                    onMouseEnter={() => setHighlightedIndex(index)}
                                >
                                    {optLabel}
                                </div>
                            );
                        })}
                    </div>
                </EditorPortal>
            )}
        </>
    );
};

// BOOLEAN EDITOR
export const BooleanEditor: React.FC<BaseEditorProps> = ({
    value,
    onChange,
    onSave,
    onCancel,
    inputRef
}) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.checked;
        onChange(newValue);
        onSave(newValue);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const newValue = !value;
            onChange(newValue);
            onSave(newValue);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        }
    };

    return (
        <div
            className="hot-cell-editor hot-boolean-editor-wrapper"
            onMouseDown={(e) => {
                e.stopPropagation();
            }}
        >
            <input
                ref={inputRef as React.RefObject<HTMLInputElement>}
                type="checkbox"
                checked={Boolean(value)}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                className="hot-boolean-editor"
            />
        </div>
    );
};

// EDITOR FACTORY
export const getCellEditor = (
    col: any,
    value: any,
    onChange: (newValue: any) => void,
    onSave: () => void,
    onCancel: () => void,
    rowData: any,
    rowIndex: number,
    colIndex: number,
    inputRef?: React.RefObject<any>
): React.ReactNode => {

    // 1. Custom editor provided
    if (col.editor) {
        return col.editor(value, onChange, onSave, onCancel, rowData, col, rowIndex, colIndex);
    }

    // 2. Read-only check
    if (col.readOnly) {
        return null;
    }

    // 3. Type-based default editors
    switch (col.type) {
        case 'numeric':
            return <NumericEditor
                value={value}
                onChange={onChange}
                onSave={onSave}
                onCancel={onCancel}
                col={col}
                inputRef={inputRef}
            />;

        case 'date':
            return <DateEditor
                value={value}
                onChange={onChange}
                onSave={onSave}
                onCancel={onCancel}
                col={col}
                inputRef={inputRef}
            />;

        case 'dropdown':
            return <DropdownEditor
                value={value}
                onChange={onChange}
                onSave={onSave}
                onCancel={onCancel}
                col={col}
                inputRef={inputRef}
            />;

        case 'boolean':
            return <BooleanEditor
                value={value}
                onChange={onChange}
                onSave={onSave}
                onCancel={onCancel}
                col={col}
                inputRef={inputRef}
            />;

        case 'text':
        default:
            return <TextEditor
                value={value}
                onChange={onChange}
                onSave={onSave}
                onCancel={onCancel}
                col={col}
                inputRef={inputRef}
            />;
    }
};
