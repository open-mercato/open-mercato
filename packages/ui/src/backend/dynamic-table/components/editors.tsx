import React, { useRef, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import DatePicker from 'react-datepicker';

if (typeof window !== 'undefined') {
    import('react-datepicker/dist/react-datepicker.css');
}

interface BaseEditorProps {
    value: any;
    onChange: (newValue: any) => void;
    onSave: (newValue?: any, clearEditing?: boolean) => void; // Accept optional value and clearEditing parameters
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
            // Save without clearing editing - navigation hook will handle clearing
            onSave(textValue, false);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        } else if (e.key === 'Tab') {
            // Save without clearing editing - navigation hook will handle clearing
            onSave(textValue, false);
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
            onBlur={() => onSave(textValue, true)}
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
            // Save without clearing editing - navigation hook will handle clearing
            onSave(getNumericValue(), false);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        } else if (e.key === 'Tab') {
            // Save without clearing editing - navigation hook will handle clearing
            onSave(getNumericValue(), false);
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
            onBlur={() => onSave(getNumericValue(), true)}
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
                onSave(textValueRef.current, true);
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

            // Save immediately with the formatted value (clear editing since calendar was clicked)
            onSave(formatted, true);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            // Save without clearing editing - navigation hook will handle clearing
            setShowCalendar(false);
            onSave(textValue, false);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setShowCalendar(false);
            onCancel();
        } else if (e.key === 'Tab') {
            // Save without clearing editing - navigation hook will handle clearing
            setShowCalendar(false);
            onSave(textValue, false);
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
                onSave(textValue, true);
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

        // Save immediately with the selected value (clear editing since option was clicked)
        onSave(selectedValue, true);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            // If dropdown is showing and has filtered options, select highlighted
            if (showDropdown && filteredOptions.length > 0) {
                const selected = filteredOptions[highlightedIndex];
                const selectedValue = typeof selected === 'string' ? selected : selected.value;
                setTextValue(selectedValue);
                setShowDropdown(false);
                onChange(selectedValue);
                // Save without clearing - navigation hook will handle it
                onSave(selectedValue, false);
            } else {
                // Save without clearing editing - navigation hook will handle clearing
                setShowDropdown(false);
                onSave(textValue, false);
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
            // Save without clearing editing - navigation hook will handle clearing
            setShowDropdown(false);
            onSave(textValue, false);
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
                        onSave(textValue, true);
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
        onSave(newValue, true);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            // Toggle value and save without clearing - navigation hook will handle it
            const newValue = !value;
            onChange(newValue);
            onSave(newValue, false);
        } else if (e.key === ' ') {
            // Space just toggles, doesn't navigate
            e.preventDefault();
            const newValue = !value;
            onChange(newValue);
            onSave(newValue, true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        } else if (e.key === 'Tab') {
            // Save current value without clearing - navigation hook will handle it
            onSave(value, false);
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

// Types for EntitySearchEditor
export type SearchResult = {
    entityId: string;
    recordId: string;
    presenter: {
        title: string;
        subtitle?: string;
        icon?: string;
        badge?: string;
    };
    fields?: Record<string, unknown>;
};

export type SelectedItem = {
    id: string;
    label: string;
    [key: string]: unknown;
};

export type EntitySearchEditorConfig = {
    entityType: string;
    extractValue: (result: SearchResult) => string;
    extractLabel: (result: SearchResult) => string;
    extractItem?: (result: SearchResult) => SelectedItem;
    formatOption?: (result: SearchResult) => {
        primary: string;
        secondary?: string;
    };
    placeholder?: string;
    minQueryLength?: number;
    debounceMs?: number;
    noResultsText?: string;
    searchingText?: string;
    searchUrl?: string;
    searchStrategy?: string;
    searchLimit?: number;
    maxItems?: number;
};

interface EntitySearchEditorProps extends Omit<BaseEditorProps, 'value' | 'onChange' | 'onSave'> {
    value: SelectedItem[] | string[] | null | undefined;
    onChange: (newValue: SelectedItem[]) => void;
    onSave: (newValue?: SelectedItem[], clearEditing?: boolean) => void;
    config: EntitySearchEditorConfig;
}

function normalizeValue(value: SelectedItem[] | string[] | null | undefined): SelectedItem[] {
    if (!value || !Array.isArray(value)) return [];
    if (value.length > 0 && typeof value[0] === 'string') {
        return (value as string[]).map(id => ({ id, label: id }));
    }
    return value as SelectedItem[];
}

function defaultFormatOption(result: SearchResult): { primary: string; secondary?: string } {
    return {
        primary: result.presenter.title,
        secondary: result.presenter.subtitle,
    };
}

// MULTI-SELECT ENTITY SEARCH EDITOR - Multi-select with async search (follows DateEditor pattern)
export const MultiSelectEntitySearchEditor: React.FC<EntitySearchEditorProps> = ({
    value,
    onChange,
    onSave,
    onCancel,
    config,
    inputRef,
}) => {
    const {
        entityType,
        extractValue,
        extractLabel,
        extractItem,
        formatOption = defaultFormatOption,
        placeholder = 'Search...',
        minQueryLength = 2,
        debounceMs = 300,
        noResultsText = 'No results found',
        searchingText = 'Searching...',
        searchUrl = '/api/search/search',
        searchStrategy = 'meilisearch',
        searchLimit = 20,
        maxItems,
    } = config;

    const [selected, setSelected] = useState<SelectedItem[]>(() => normalizeValue(value));
    const [showDropdown, setShowDropdown] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });

    const cellRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const isClickingDropdownRef = useRef(false);

    // Keep ref in sync for click-outside handler (like DateEditor's textValueRef pattern)
    const selectedRef = useRef<SelectedItem[]>(selected);
    useEffect(() => {
        selectedRef.current = selected;
    }, [selected]);

    // Focus textarea on mount
    useEffect(() => {
        setTimeout(() => textareaRef.current?.focus(), 0);
    }, []);

    // Debounce search query
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(searchQuery);
        }, debounceMs);
        return () => clearTimeout(timer);
    }, [searchQuery, debounceMs]);

    // Fetch results from search API
    useEffect(() => {
        if (debouncedQuery.length < minQueryLength) {
            setResults([]);
            return;
        }

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;

        const fetchResults = async () => {
            setIsLoading(true);
            try {
                const params = new URLSearchParams({
                    q: debouncedQuery,
                    strategies: searchStrategy,
                    entityTypes: entityType,
                    limit: String(searchLimit),
                });

                const response = await fetch(`${searchUrl}?${params.toString()}`, {
                    signal: controller.signal,
                });

                if (!response.ok) throw new Error('Search failed');

                const data = await response.json();
                setResults(data.results || []);
                setHighlightedIndex(0);
            } catch (error) {
                if ((error as Error).name !== 'AbortError') {
                    console.error('Entity search error:', error);
                    setResults([]);
                }
            } finally {
                setIsLoading(false);
            }
        };

        fetchResults();
        return () => controller.abort();
    }, [debouncedQuery, entityType, minQueryLength, searchUrl, searchStrategy, searchLimit]);

    // Filter out already selected items
    const selectedIds = new Set(selected.map(s => s.id));
    const filteredResults = results.filter(r => !selectedIds.has(extractValue(r)));

    // Calculate position (like DateEditor)
    useEffect(() => {
        if (cellRef.current) {
            const pos = calculatePopupPosition(cellRef);
            setPosition(pos);
        }

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

    // Click-outside handler (like DropdownEditor - uses isClickingDropdownRef pattern)
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            // Skip if clicking on dropdown - the dropdown's onMouseDown will handle selection
            if (isClickingDropdownRef.current) return;

            const target = e.target as Node;
            const isOutsideCell = cellRef.current && !cellRef.current.contains(target);
            const isOutsideDropdown = !dropdownRef.current || !dropdownRef.current.contains(target);

            if (isOutsideCell && isOutsideDropdown) {
                setShowDropdown(false);
                onSave(selectedRef.current, true);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onSave]);

    const handleSelectItem = (result: SearchResult) => {
        if (maxItems && selected.length >= maxItems) return;

        const newItem: SelectedItem = extractItem
            ? extractItem(result)
            : { id: extractValue(result), label: extractLabel(result) };

        const newSelected = [...selected, newItem];
        setSelected(newSelected);
        onChange(newSelected);
        setSearchQuery('');
        setResults([]);
        textareaRef.current?.focus();
    };

    const handleRemoveItem = (id: string) => {
        const newSelected = selected.filter(s => s.id !== id);
        setSelected(newSelected);
        onChange(newSelected);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (filteredResults.length > 0 && highlightedIndex < filteredResults.length) {
                handleSelectItem(filteredResults[highlightedIndex]);
            } else if (searchQuery === '') {
                setShowDropdown(false);
                onSave(selectedRef.current, false);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setShowDropdown(false);
            onCancel();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightedIndex(prev =>
                prev < filteredResults.length - 1 ? prev + 1 : prev
            );
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightedIndex(prev => prev > 0 ? prev - 1 : 0);
        } else if (e.key === 'Backspace' && searchQuery === '' && selected.length > 0) {
            const newSelected = selected.slice(0, -1);
            setSelected(newSelected);
            onChange(newSelected);
        } else if (e.key === 'Tab') {
            setShowDropdown(false);
            onSave(selectedRef.current, false);
        }
    };

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setSearchQuery(e.target.value);
    };

    const showResults = searchQuery.length >= minQueryLength || isLoading;

    return (
        <>
            {/* Cell content: textarea only for typing search query */}
            <div
                ref={cellRef}
                className="hot-cell-editor flex items-center min-h-[28px] px-1 py-0.5"
            >
                <textarea
                    ref={(el) => {
                        textareaRef.current = el;
                        if (inputRef) {
                            (inputRef as React.MutableRefObject<any>).current = el;
                        }
                    }}
                    value={searchQuery}
                    onChange={handleTextChange}
                    onKeyDown={handleKeyDown}
                    onBlur={() => {
                        // EMPTY - Don't save on blur, click-outside handles it (like DateEditor)
                    }}
                    placeholder={placeholder}
                    className="flex-1 min-w-[60px] outline-none bg-transparent text-sm resize-none"
                    style={{ border: 'none', height: '20px' }}
                    rows={1}
                />
            </div>

            {/* Dropdown with selected items at top + search results */}
            {showDropdown && (
                <EditorPortal>
                    <div
                        ref={dropdownRef}
                        className="hot-editor-popup hot-dropdown-popup"
                        style={{
                            position: 'absolute',
                            top: `${position.top}px`,
                            left: `${position.left}px`,
                            width: `${Math.max(position.width, 280)}px`,
                            maxHeight: `${POPUP_MAX_HEIGHT}px`,
                            overflowY: 'auto',
                            zIndex: 10000,
                            pointerEvents: 'auto',
                        }}
                        onMouseDown={(e) => {
                            e.stopPropagation();
                            isClickingDropdownRef.current = true;
                        }}
                        onMouseUp={() => {
                            isClickingDropdownRef.current = false;
                        }}
                    >
                        {/* Selected items at top of dropdown */}
                        {selected.length > 0 && (
                            <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-gray-200 bg-gray-50">
                                {selected.map((item) => {
                                    // Fallback: label > locode > name > id
                                    const itemAny = item as SelectedItem & { locode?: string; name?: string };
                                    const displayLabel = item.label || itemAny.locode || itemAny.name || item.id;
                                    return (
                                    <span
                                        key={item.id}
                                        className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs"
                                    >
                                        {displayLabel}
                                        <button
                                            type="button"
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                handleRemoveItem(item.id);
                                            }}
                                            className="hover:bg-blue-200 rounded p-0.5"
                                            style={{ cursor: 'pointer' }}
                                        >
                                            ×
                                        </button>
                                    </span>
                                    );
                                })}
                            </div>
                        )}

                        {isLoading ? (
                            <div className="flex items-center gap-2 px-3 py-2 text-sm text-gray-500">
                                <span className="animate-spin">⏳</span>
                                {searchingText}
                            </div>
                        ) : showResults && filteredResults.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-gray-500">
                                {noResultsText}
                            </div>
                        ) : showResults ? (
                            filteredResults.map((result, index) => {
                                const { primary, secondary } = formatOption(result);
                                const isHighlighted = index === highlightedIndex;

                                return (
                                    <div
                                        key={result.recordId}
                                        className={`flex items-center gap-2 px-3 py-2 ${
                                            isHighlighted ? 'bg-blue-50' : 'hover:bg-gray-50'
                                        }`}
                                        style={{ cursor: 'pointer' }}
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            handleSelectItem(result);
                                        }}
                                        onMouseEnter={() => setHighlightedIndex(index)}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium truncate">{primary}</div>
                                            {secondary && (
                                                <div className="text-xs text-gray-500 truncate">{secondary}</div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="px-3 py-2 text-sm text-gray-400">
                                Type to search...
                            </div>
                        )}
                    </div>
                </EditorPortal>
            )}
        </>
    );
};

// Factory function to create MultiSelectEntitySearchEditor
export function createMultiSelectEntitySearchEditor(config: EntitySearchEditorConfig) {
    return (
        value: unknown,
        onChange: (v: unknown) => void,
        onSave: (v?: unknown, clearEditing?: boolean) => void,
        onCancel: () => void,
    ) => (
        <MultiSelectEntitySearchEditor
            config={config}
            value={value as SelectedItem[] | string[] | null | undefined}
            onChange={(newValue) => onChange(newValue)}
            onSave={(newValue, clearEditing) => onSave(newValue, clearEditing)}
            onCancel={onCancel}
            col={{}}
        />
    );
}

// EDITOR FACTORY
export const getCellEditor = (
    col: any,
    value: any,
    onChange: (newValue: any) => void,
    onSave: (newValue?: any, clearEditing?: boolean) => void,
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
