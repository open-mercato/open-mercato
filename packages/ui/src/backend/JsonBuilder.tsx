"use client"

import * as React from 'react'
import { Button } from '../primitives/button'
import { Plus, Trash2, ChevronRight, ChevronDown, Code, LayoutList } from 'lucide-react'

function cn(...classes: (string | undefined | null | false)[]) {
    return classes.filter(Boolean).join(' ')
}

export type JsonBuilderProps = {
    value: any
    onChange: (value: any) => void
    disabled?: boolean
    error?: string
}

type JsonNodeType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'

function getJsonType(value: any): JsonNodeType {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    return typeof value as JsonNodeType
}

export function JsonBuilder({
    value,
    onChange,
    disabled,
    error
}: JsonBuilderProps) {
    const [mode, setMode] = React.useState<'raw' | 'builder'>('raw')
    const [rawString, setRawString] = React.useState(() => {
        if (value === null) return '{}'
        return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value || '{}')
    })
    const [parseError, setParseError] = React.useState<string | null>(null)

    React.useEffect(() => {
        if (value === null) {
            if (!disabled) {
                onChange({})
            }
            setRawString('{}')
            setParseError(null)
            return
        }
        if (typeof value === 'object') {
            setRawString(JSON.stringify(value, null, 2))
            setParseError(null)
        }
    }, [value, disabled, onChange])

    const handleRawChange = (str: string) => {
        setRawString(str)
        try {
            if (str.trim() === '') {
                onChange({})
                setParseError(null)
            } else {
                const parsed = JSON.parse(str)
                onChange(parsed)
                setParseError(null)
            }
        } catch (e) {
            onChange(str)
            setParseError("Invalid JSON")
        }
    }

    const switchToBuilder = () => {
        try {
            if (typeof value === 'string') {
                JSON.parse(value)
            }
            setMode('builder')
        } catch (e) {
            alert("Cannot switch to Builder mode: Invalid JSON")
        }
    }

    return (
        <div className="space-y-4 border rounded-md p-4 bg-card">
            <div className="flex items-center space-x-2 border-b pb-2 mb-2">
                <button
                    type="button"
                    onClick={() => setMode('raw')}
                    className={cn(
                        "flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                        mode === 'raw'
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                >
                    <Code className="w-4 h-4" />
                    Raw JSON
                </button>
                <button
                    type="button"
                    onClick={switchToBuilder}
                    className={cn(
                        "flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                        mode === 'builder'
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                >
                    <LayoutList className="w-4 h-4" />
                    Builder
                </button>
            </div>

            {mode === 'raw' ? (
                <div className="space-y-2">
                    <textarea
                        value={rawString}
                        onChange={(e) => handleRawChange(e.target.value)}
                        onBlur={() => {
                            try {
                                const parsed = JSON.parse(rawString)
                                setRawString(JSON.stringify(parsed, null, 2))
                            } catch { }
                        }}
                        placeholder='{"key": "value"}'
                        className="w-full rounded border px-3 py-2 min-h-[300px] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={disabled}
                    />
                    {parseError && (
                        <div className="text-xs text-red-600">Invalid JSON format</div>
                    )}
                </div>
            ) : (
                <div className="min-h-[300px] text-sm overflow-x-auto">
                    {typeof value === 'object' && value !== null ? (
                        <JsonNode
                            data={value}
                            onChange={onChange}
                            readOnly={disabled}
                            isRoot
                        />
                    ) : (
                        <div className="text-muted-foreground italic p-4 text-center">
                            Value is not an object or array. Switch to Raw to edit.
                        </div>
                    )}
                </div>
            )}

            {error && <div className="text-xs text-red-600">{error}</div>}
        </div>
    )
}

interface JsonNodeProps {
    data: any
    onChange: (val: any) => void
    onDelete?: () => void
    readOnly?: boolean
    label?: string
    isRoot?: boolean
}

function JsonNode({ data, onChange, onDelete, readOnly, label, isRoot }: JsonNodeProps) {
    const type = getJsonType(data)
    const isContainer = type === 'object' || type === 'array'
    const [collapsed, setCollapsed] = React.useState(false)

    const handleTypeChange = (newType: JsonNodeType) => {
        let newVal: any = ''
        switch (newType) {
            case 'string': newVal = ""; break;
            case 'number': newVal = 0; break;
            case 'boolean': newVal = false; break;
            case 'object': newVal = {}; break;
            case 'array': newVal = []; break;
            case 'null': newVal = null; break;
        }
        onChange(newVal)
    }

    const handleAddKey = () => {
        if (type === 'object') {
            const newKey = `newKey_${Object.keys(data).length}`
            onChange({ ...data, [newKey]: "" })
        } else if (type === 'array') {
            onChange([...data, ""])
        }
    }

    const handleChildChange = (key: string | number, newVal: any) => {
        if (type === 'object') {
            onChange({ ...data, [key]: newVal })
        } else if (type === 'array') {
            const arr = [...data]
            arr[Number(key)] = newVal
            onChange(arr)
        }
    }

    const handleKeyRename = (oldKey: string, newKey: string) => {
        if (oldKey === newKey) return
        const keys = Object.keys(data)
        const newData: any = {}
        keys.forEach(k => {
            if (k === oldKey) {
                newData[newKey] = data[k]
            } else {
                newData[k] = data[k]
            }
        })
        onChange(newData)
    }

    const handleChildDelete = (key: string | number) => {
        if (type === 'object') {
            const newData = { ...data }
            delete newData[key as string]
            onChange(newData)
        } else if (type === 'array') {
            onChange(data.filter((_: any, i: number) => i !== key))
        }
    }

    return (
        <div className={cn("pl-0", !isRoot && "pl-4 border-l border-border ml-1")}>
            <div className="flex items-start gap-2 py-1 group">

                {isContainer && (
                    <button type="button" onClick={() => setCollapsed(!collapsed)} className="mt-1 text-muted-foreground hover:text-foreground">
                        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                )}
                {!isContainer && !isRoot && <div className="w-3" />} {/* Spacer */}

                {label !== undefined && !isRoot && (
                    <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground font-mono">
                            {label}
                        </span>
                        <span className="text-muted-foreground text-xs">:</span>
                    </div>
                )}

                <div className="flex-1 flex gap-2 items-center flex-wrap">

                    {!readOnly && (
                        <select
                            value={type}
                            onChange={(e) => handleTypeChange(e.target.value as JsonNodeType)}
                            className="text-xs border rounded px-1 py-0.5 bg-muted text-foreground focus:ring-1 focus:ring-blue-500"
                        >
                            <option value="string">String</option>
                            <option value="number">Number</option>
                            <option value="boolean">Boolean</option>
                            <option value="object">Object</option>
                            <option value="array">Array</option>
                            <option value="null">Null</option>
                        </select>
                    )}

                    {type === 'string' && (
                        <input
                            className="flex-1 min-w-0 sm:min-w-[120px] text-sm border rounded px-2 py-0.5 focus:outline-none focus:border-blue-500"
                            value={data}
                            onChange={e => onChange(e.target.value)}
                            disabled={readOnly}
                        />
                    )}
                    {type === 'number' && (
                        <input
                            type="number"
                            className="flex-1 w-full sm:w-[100px] text-sm border rounded px-2 py-0.5 focus:outline-none focus:border-blue-500"
                            value={data}
                            onChange={e => onChange(parseFloat(e.target.value) || 0)}
                            disabled={readOnly}
                        />
                    )}
                    {type === 'boolean' && (
                        <select
                            className="flex-1 w-full sm:w-[100px] text-sm border rounded px-2 py-0.5 focus:outline-none focus:border-blue-500"
                            value={String(data)}
                            onChange={e => onChange(e.target.value === 'true')}
                            disabled={readOnly}
                        >
                            <option value="true">true</option>
                            <option value="false">false</option>
                        </select>
                    )}
                    {type === 'null' && <span className="text-xs text-muted-foreground">null</span>}
                    {isContainer && (
                        <span className="text-xs text-muted-foreground">
                            {type === 'object' ? `{ ${Object.keys(data).length} items }` : `[ ${data.length} items ]`}
                        </span>
                    )}

                    {onDelete && !readOnly && (
                        <button
                            type="button"
                            onClick={onDelete}
                            className="text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Remove item"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {isContainer && !collapsed && (
                <div className="flex flex-col gap-1 w-full pl-2">
                    {type === 'object' && Object.entries(data).map(([key, val], idx) => (
                        <div key={idx} className="flex">
                            <div className="pt-2">
                                {/* Key Renamer */}
                                <input
                                    className="w-full sm:w-[100px] text-xs font-mono border-b border-transparent hover:border-gray-300 focus:border-blue-500 bg-transparent focus:outline-none text-right pr-1"
                                    value={key}
                                    onChange={(e) => handleKeyRename(key, e.target.value)}
                                    disabled={readOnly}
                                />
                            </div>
                            <div className="flex-1">
                                <JsonNode
                                    data={val}
                                    onChange={(v) => handleChildChange(key, v)}
                                    onDelete={() => handleChildDelete(key)}
                                    readOnly={readOnly}
                                />
                            </div>
                        </div>
                    ))}

                    {type === 'array' && (data as any[]).map((val, idx) => (
                        <JsonNode
                            key={idx}
                            label={String(idx)}
                            data={val}
                            onChange={(v) => handleChildChange(idx, v)}
                            onDelete={() => handleChildDelete(idx)}
                            readOnly={readOnly}
                        />
                    ))}

                    {!readOnly && (
                        <div className="pl-4 mt-1">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleAddKey}
                                className="h-6 text-xs"
                            >
                                <Plus className="w-3 h-3 mr-1" />
                                Add {type === 'object' ? 'Property' : 'Item'}
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
