'use client'

import { Edge } from '@xyflow/react'
import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Label } from '@open-mercato/ui/primitives/label'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { cn } from '@open-mercato/shared/lib/utils'
import { ChevronDown, Plus, Trash2, X, Info } from 'lucide-react'
import { BusinessRulesSelector, type BusinessRule } from './BusinessRulesSelector'

export interface EdgeEditDialogProps {
  edge: Edge | null
  isOpen: boolean
  onClose: () => void
  onSave: (edgeId: string, updates: Partial<Edge['data']>) => void
  onDelete: (edgeId: string) => void
}

interface TransitionCondition {
  ruleId: string
  required: boolean
}

/**
 * EdgeEditDialog - Modal dialog for editing transition properties
 *
 * Allows editing:
 * - Label
 * - Trigger type (auto, manual, signal, timer)
 * - Pre-conditions (guard rules)
 * - Post-conditions (validation rules)
 * - Activities
 * - Business rules integration
 */
export function EdgeEditDialog({ edge, isOpen, onClose, onSave, onDelete }: EdgeEditDialogProps) {
  const [transitionName, setTransitionName] = useState('')
  const [trigger, setTrigger] = useState('auto')
  const [priority, setPriority] = useState('100')
  const [continueOnActivityFailure, setContinueOnActivityFailure] = useState(true)
  const [preConditions, setPreConditions] = useState<TransitionCondition[]>([])
  const [postConditions, setPostConditions] = useState<TransitionCondition[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [advancedConfig, setAdvancedConfig] = useState('')
  const [activities, setActivities] = useState<any[]>([])
  const [expandedActivities, setExpandedActivities] = useState<Set<number>>(new Set())
  const [expandedPreConditions, setExpandedPreConditions] = useState<Set<number>>(new Set())
  const [expandedPostConditions, setExpandedPostConditions] = useState<Set<number>>(new Set())
  const [showRuleSelector, setShowRuleSelector] = useState(false)
  const [ruleSelectorMode, setRuleSelectorMode] = useState<'pre' | 'post'>('pre')
  const [ruleDetailsCache, setRuleDetailsCache] = useState<Map<string, BusinessRule>>(new Map())

  // Generate a readable name from edge ID (e.g., "start_to_cart" -> "Start to Cart")
  const generateNameFromId = (edgeId: string): string => {
    return edgeId
      .split('_to_')
      .map(part => part.split('_').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' '))
      .join(' → ')
  }

  // Load edge data when dialog opens
  useEffect(() => {
    if (edge && isOpen) {
      const edgeData = edge.data as any

      // Try to get transition name from various sources
      let loadedTransitionName = ''
      if (edgeData?.transitionName && edgeData.transitionName !== '') {
        loadedTransitionName = edgeData.transitionName
      } else if (edgeData?.label && edgeData.label !== '' && edgeData.label !== undefined) {
        loadedTransitionName = edgeData.label
      } else {
        // Generate a name from the edge ID as fallback
        loadedTransitionName = generateNameFromId(edge.id)
      }

      setTransitionName(loadedTransitionName)

      setTrigger(edgeData?.trigger || 'auto')
      setPriority((edgeData?.priority || 100).toString())
      setContinueOnActivityFailure(edgeData?.continueOnActivityFailure !== undefined ? edgeData.continueOnActivityFailure : true)

      // Handle pre/post conditions - convert from various formats
      const rawPreConditions = edgeData?.preConditions || []
      const rawPostConditions = edgeData?.postConditions || []

      // Convert to TransitionCondition format
      setPreConditions(Array.isArray(rawPreConditions)
        ? rawPreConditions.map((c: any) =>
            typeof c === 'string' ? { ruleId: c, required: true } : c
          )
        : []
      )
      setPostConditions(Array.isArray(rawPostConditions)
        ? rawPostConditions.map((c: any) =>
            typeof c === 'string' ? { ruleId: c, required: true } : c
          )
        : []
      )

      setActivities(edgeData?.activities || [])

      // Load advanced config (activities, etc.)
      const advancedFields: any = {}
      if (edgeData?.activities && edgeData.activities.length > 0) {
        advancedFields.activities = edgeData.activities
      }
      setAdvancedConfig(Object.keys(advancedFields).length > 0 ? JSON.stringify(advancedFields, null, 2) : '')
      setExpandedActivities(new Set())
      setExpandedPreConditions(new Set())
      setExpandedPostConditions(new Set())
    }
  }, [edge, isOpen])

  const toggleActivity = (index: number) => {
    const newExpanded = new Set(expandedActivities)
    if (newExpanded.has(index)) {
      newExpanded.delete(index)
    } else {
      newExpanded.add(index)
    }
    setExpandedActivities(newExpanded)
  }

  const addActivity = () => {
    const newActivity = {
      activityId: `activity_${Date.now()}`,
      activityName: 'New Activity',
      activityType: 'CALL_API',
      config: {},
      timeout: '',
      retryPolicy: {
        maxAttempts: 3,
        initialIntervalMs: 1000,
        backoffCoefficient: 2,
        maxIntervalMs: 10000,
      },
    }
    setActivities([...activities, newActivity])
    // Auto-expand the new activity
    const newExpanded = new Set(expandedActivities)
    newExpanded.add(activities.length)
    setExpandedActivities(newExpanded)
  }

  const removeActivity = (index: number) => {
    if (confirm('Are you sure you want to remove this activity?')) {
      setActivities(activities.filter((_, i) => i !== index))
      // Remove from expanded set
      const newExpanded = new Set(expandedActivities)
      newExpanded.delete(index)
      setExpandedActivities(newExpanded)
    }
  }

  const updateActivity = (index: number, field: string, value: any) => {
    const updated = [...activities]
    updated[index] = { ...updated[index], [field]: value }
    setActivities(updated)
  }

  const updateActivityRetryPolicy = (index: number, field: string, value: any) => {
    const updated = [...activities]
    updated[index] = {
      ...updated[index],
      retryPolicy: {
        ...updated[index].retryPolicy,
        [field]: value,
      },
    }
    setActivities(updated)
  }

  const updateActivityConfig = (index: number, configJson: string) => {
    try {
      const config = JSON.parse(configJson)
      const updated = [...activities]
      updated[index] = { ...updated[index], config }
      setActivities(updated)
    } catch (error) {
      // Invalid JSON, don't update
    }
  }

  // Business Rules Management
  const togglePreCondition = (index: number) => {
    const newExpanded = new Set(expandedPreConditions)
    if (newExpanded.has(index)) {
      newExpanded.delete(index)
    } else {
      newExpanded.add(index)
    }
    setExpandedPreConditions(newExpanded)
  }

  const togglePostCondition = (index: number) => {
    const newExpanded = new Set(expandedPostConditions)
    if (newExpanded.has(index)) {
      newExpanded.delete(index)
    } else {
      newExpanded.add(index)
    }
    setExpandedPostConditions(newExpanded)
  }

  const openRuleSelector = (mode: 'pre' | 'post') => {
    setRuleSelectorMode(mode)
    setShowRuleSelector(true)
  }

  const closeRuleSelector = () => {
    setShowRuleSelector(false)
  }

  const handleRuleSelected = (ruleId: string, rule: BusinessRule) => {
    // Cache the rule details for display
    setRuleDetailsCache(prev => new Map(prev).set(ruleId, rule))

    if (ruleSelectorMode === 'pre') {
      if (!preConditions.find(c => c.ruleId === ruleId)) {
        setPreConditions([...preConditions, { ruleId, required: true }])
      }
    } else {
      if (!postConditions.find(c => c.ruleId === ruleId)) {
        setPostConditions([...postConditions, { ruleId, required: true }])
      }
    }
    closeRuleSelector()
  }

  const removePreCondition = (index: number) => {
    setPreConditions(preConditions.filter((_, i) => i !== index))
    const newExpanded = new Set(expandedPreConditions)
    newExpanded.delete(index)
    setExpandedPreConditions(newExpanded)
  }

  const removePostCondition = (index: number) => {
    setPostConditions(postConditions.filter((_, i) => i !== index))
    const newExpanded = new Set(expandedPostConditions)
    newExpanded.delete(index)
    setExpandedPostConditions(newExpanded)
  }

  const updatePreCondition = (index: number, field: keyof TransitionCondition, value: any) => {
    const updated = [...preConditions]
    updated[index] = { ...updated[index], [field]: value }
    setPreConditions(updated)
  }

  const updatePostCondition = (index: number, field: keyof TransitionCondition, value: any) => {
    const updated = [...postConditions]
    updated[index] = { ...updated[index], [field]: value }
    setPostConditions(updated)
  }

  const getBusinessRuleDetails = (ruleId: string): BusinessRule | null => {
    return ruleDetailsCache.get(ruleId) || null
  }

  const handleSave = () => {
    if (!edge) return

    const updates: Partial<Edge['data']> = {
      transitionName,
      label: transitionName, // Keep label for backward compatibility
      trigger,
      priority: parseInt(priority) || 100,
      continueOnActivityFailure,
      preConditions: preConditions.length > 0 ? preConditions : undefined,
      postConditions: postConditions.length > 0 ? postConditions : undefined,
      activities: activities.length > 0 ? activities : undefined,
    }

    // Parse advanced config (JSON)
    if (advancedConfig.trim()) {
      try {
        const parsed = JSON.parse(advancedConfig)
        Object.assign(updates, parsed)
      } catch (error) {
        alert('Invalid JSON in Advanced Configuration. Please check your syntax.')
        return
      }
    }

    onSave(edge.id, updates)
    onClose()
  }

  const handleDelete = () => {
    if (!edge) return
    if (confirm('Are you sure you want to delete this transition?')) {
      onDelete(edge.id)
      onClose()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSave()
    }
    if (e.key === 'Escape') {
      onClose()
    }
  }

  if (!isOpen || !edge) return null

  const triggerVariant = trigger === 'auto' ? 'default' : trigger === 'manual' ? 'secondary' : 'outline'

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <DialogTitle>Edit Transition</DialogTitle>
            <Badge variant={triggerVariant} className="text-xs">
              {trigger === 'auto' ? 'Automatic' :
               trigger === 'manual' ? 'Manual' :
               trigger === 'signal' ? 'Signal' : 'Timer'}
            </Badge>
          </div>
          <div className="space-y-1">
            <DialogDescription>
              Configure transition properties, conditions, and activities
            </DialogDescription>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">ID:</span>
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono">{edge.id}</code>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">Flow:</span>
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono">{edge.source}</code>
              <span>→</span>
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono">{edge.target}</code>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
            {/* Transition Name */}
            <div className="space-y-2">
              <Label htmlFor="transitionName">Transition Name</Label>
              <Input
                id="transitionName"
                type="text"
                value={transitionName}
                onChange={(e) => setTransitionName(e.target.value)}
                placeholder={`Auto-generated: ${generateNameFromId(edge.id)}`}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Custom name for this transition (leave empty to use auto-generated name)
              </p>
            </div>

            {/* Trigger Type */}
            <div className="space-y-2">
              <Label htmlFor="trigger">Trigger Type</Label>
              <select
                id="trigger"
                value={trigger}
                onChange={(e) => setTrigger(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="auto">Automatic</option>
                <option value="manual">Manual</option>
                <option value="signal">Signal</option>
                <option value="timer">Timer</option>
              </select>
              <p className="text-xs text-muted-foreground">
                {trigger === 'auto' && 'Transition happens immediately when the step completes'}
                {trigger === 'manual' && 'Requires explicit user action to proceed'}
                {trigger === 'signal' && 'Waits for an external signal/event'}
                {trigger === 'timer' && 'Waits for a specified duration or timestamp'}
              </p>
            </div>

            {/* Priority */}
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Input
                id="priority"
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                placeholder="100"
                min="0"
                max="9999"
              />
              <p className="text-xs text-muted-foreground">
                Higher priority transitions are evaluated first (default: 100, range: 0-9999)
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="continueOnActivityFailure"
                  checked={continueOnActivityFailure}
                  onChange={(e) => setContinueOnActivityFailure(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                <Label htmlFor="continueOnActivityFailure" className="font-normal cursor-pointer">
                  Continue on Activity Failure
                </Label>
              </div>
              <p className="text-xs text-muted-foreground ml-6">
                If unchecked, the transition will fail when any activity fails (default: checked)
              </p>
            </div>

            <Separator />

            {/* Pre-conditions (Business Rules) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">
                    Pre-conditions ({preConditions.length})
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Business rules that must pass BEFORE transition fires
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => openRuleSelector('pre')}
                >
                  <Plus className="size-3" />
                  Add Rule
                </Button>
              </div>

              {preConditions.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground bg-muted rounded-lg border">
                  No pre-conditions defined. Add business rules to validate before transition.
                </div>
              )}

              <div className="space-y-2">
                {preConditions.map((condition, index) => {
                  const isExpanded = expandedPreConditions.has(index)
                  const rule = getBusinessRuleDetails(condition.ruleId)
                  return (
                    <div key={index} className="border border-border rounded-lg bg-muted">
                      <button
                        type="button"
                        onClick={() => togglePreCondition(index)}
                        className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-muted transition-colors rounded-t-lg"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground">
                              {rule?.ruleName || condition.ruleId}
                            </span>
                            {condition.required && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                REQUIRED
                              </span>
                            )}
                            {rule && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                                {rule.ruleType}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Rule ID: <code className="bg-card px-1 rounded">{condition.ruleId}</code>
                          </p>
                          {rule?.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{rule.description}</p>
                          )}
                        </div>
                        <svg
                          className={`w-5 h-5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-4 space-y-3 border-t border-border bg-card">
                          <div className="pt-3">
                            <label className="block text-xs font-medium text-foreground mb-1">Rule ID</label>
                            <input
                              type="text"
                              value={condition.ruleId}
                              onChange={(e) => updatePreCondition(index, 'ruleId', e.target.value)}
                              className="w-full px-2 py-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>

                          <div>
                            <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                              <input
                                type="checkbox"
                                checked={condition.required}
                                onChange={(e) => updatePreCondition(index, 'required', e.target.checked)}
                                className="rounded border-border text-blue-600 focus:ring-blue-500"
                              />
                              Required (transition blocked if rule fails)
                            </label>
                          </div>

                          {rule && (
                            <div className="border-t border-border pt-3">
                              <h4 className="text-xs font-semibold text-foreground mb-2">Business Rule Details</h4>
                              <dl className="space-y-1 text-xs">
                                <div className="flex justify-between">
                                  <dt className="font-medium text-foreground">Name:</dt>
                                  <dd className="text-foreground">{rule.ruleName}</dd>
                                </div>
                                <div className="flex justify-between">
                                  <dt className="font-medium text-foreground">Type:</dt>
                                  <dd className="text-foreground">{rule.ruleType}</dd>
                                </div>
                                {rule.ruleCategory && (
                                  <div className="flex justify-between">
                                    <dt className="font-medium text-foreground">Category:</dt>
                                    <dd className="text-foreground">{rule.ruleCategory}</dd>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <dt className="font-medium text-foreground">Entity Type:</dt>
                                  <dd className="text-foreground font-mono text-xs">{rule.entityType}</dd>
                                </div>
                                {rule.eventType && (
                                  <div className="flex justify-between">
                                    <dt className="font-medium text-foreground">Event Type:</dt>
                                    <dd className="text-foreground">{rule.eventType}</dd>
                                  </div>
                                )}
                                {rule.description && (
                                  <div className="mt-2 pt-2 border-t border-border">
                                    <dt className="font-medium text-foreground mb-1">Description:</dt>
                                    <dd className="text-muted-foreground">{rule.description}</dd>
                                  </div>
                                )}
                              </dl>
                            </div>
                          )}

                          <div className="border-t border-border pt-3">
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => removePostCondition(index)}
                            >
                              <Trash2 className="size-4" />
                              Remove Pre-condition
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Post-conditions (Business Rules) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">
                    Post-conditions ({postConditions.length})
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Business rules to validate AFTER transition fires (logged only)
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => openRuleSelector('post')}
                >
                  <Plus className="size-3" />
                  Add Rule
                </Button>
              </div>

              {postConditions.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground bg-muted rounded-lg border">
                  No post-conditions defined. Add business rules to validate after transition.
                </div>
              )}

              <div className="space-y-2">
                {postConditions.map((condition, index) => {
                  const isExpanded = expandedPostConditions.has(index)
                  const rule = getBusinessRuleDetails(condition.ruleId)
                  return (
                    <div key={index} className="border border-border rounded-lg bg-muted">
                      <button
                        type="button"
                        onClick={() => togglePostCondition(index)}
                        className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-muted transition-colors rounded-t-lg"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground">
                              {rule?.ruleName || condition.ruleId}
                            </span>
                            {condition.required && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                REQUIRED
                              </span>
                            )}
                            {rule && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                                {rule.ruleType}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Rule ID: <code className="bg-card px-1 rounded">{condition.ruleId}</code>
                          </p>
                          {rule?.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{rule.description}</p>
                          )}
                        </div>
                        <svg
                          className={`w-5 h-5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-4 space-y-3 border-t border-border bg-card">
                          <div className="pt-3">
                            <label className="block text-xs font-medium text-foreground mb-1">Rule ID</label>
                            <input
                              type="text"
                              value={condition.ruleId}
                              onChange={(e) => updatePostCondition(index, 'ruleId', e.target.value)}
                              className="w-full px-2 py-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>

                          <div>
                            <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                              <input
                                type="checkbox"
                                checked={condition.required}
                                onChange={(e) => updatePostCondition(index, 'required', e.target.checked)}
                                className="rounded border-border text-blue-600 focus:ring-blue-500"
                              />
                              Required (log warning if rule fails)
                            </label>
                          </div>

                          {rule && (
                            <div className="border-t border-border pt-3">
                              <h4 className="text-xs font-semibold text-foreground mb-2">Business Rule Details</h4>
                              <dl className="space-y-1 text-xs">
                                <div className="flex justify-between">
                                  <dt className="font-medium text-foreground">Name:</dt>
                                  <dd className="text-foreground">{rule.ruleName}</dd>
                                </div>
                                <div className="flex justify-between">
                                  <dt className="font-medium text-foreground">Type:</dt>
                                  <dd className="text-foreground">{rule.ruleType}</dd>
                                </div>
                                {rule.ruleCategory && (
                                  <div className="flex justify-between">
                                    <dt className="font-medium text-foreground">Category:</dt>
                                    <dd className="text-foreground">{rule.ruleCategory}</dd>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <dt className="font-medium text-foreground">Entity Type:</dt>
                                  <dd className="text-foreground font-mono text-xs">{rule.entityType}</dd>
                                </div>
                                {rule.eventType && (
                                  <div className="flex justify-between">
                                    <dt className="font-medium text-foreground">Event Type:</dt>
                                    <dd className="text-foreground">{rule.eventType}</dd>
                                  </div>
                                )}
                                {rule.description && (
                                  <div className="mt-2 pt-2 border-t border-border">
                                    <dt className="font-medium text-foreground mb-1">Description:</dt>
                                    <dd className="text-muted-foreground">{rule.description}</dd>
                                  </div>
                                )}
                              </dl>
                            </div>
                          )}

                          <div className="border-t border-border pt-3">
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => removePostCondition(index)}
                            >
                              <Trash2 className="size-4" />
                              Remove Post-condition
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Activities Section */}
            <div className="border-t border-border pt-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Activities ({activities.length})
                </h3>
                <Button
                  type="button"
                  size="sm"
                  onClick={addActivity}
                >
                  <Plus className="size-3" />
                  Add Activity
                </Button>
              </div>

              {activities.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground bg-muted rounded-lg border border-border">
                  No activities defined. Click "Add Activity" to create one.
                </div>
              )}

              <div className="space-y-2">
                {activities.map((activity, index) => {
                  const isExpanded = expandedActivities.has(index)
                  return (
                    <div key={index} className="border border-border rounded-lg bg-muted">
                      <button
                        type="button"
                        onClick={() => toggleActivity(index)}
                        className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-muted transition-colors rounded-t-lg"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground">
                              {activity.activityName || activity.label || activity.activityId || `Activity ${index + 1}`}
                            </span>
                            <Badge variant="secondary" className="text-xs">
                              {activity.activityType}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Activity ID: <code className="bg-card px-1 rounded">{activity.activityId}</code>
                          </p>
                        </div>
                        <svg
                          className={`w-5 h-5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-4 space-y-3 border-t border-border bg-card">
                          {/* Activity ID */}
                          <div className="pt-3">
                            <label className="block text-xs font-medium text-foreground mb-1">Activity ID *</label>
                            <input
                              type="text"
                              value={activity.activityId}
                              onChange={(e) => updateActivity(index, 'activityId', e.target.value)}
                              className="w-full px-2 py-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                              placeholder="activity_name"
                            />
                          </div>

                          {/* Activity Name */}
                          <div>
                            <label className="block text-xs font-medium text-foreground mb-1">Activity Name *</label>
                            <input
                              type="text"
                              value={activity.activityName || ''}
                              onChange={(e) => updateActivity(index, 'activityName', e.target.value)}
                              className="w-full px-2 py-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                              placeholder="Activity Name"
                            />
                          </div>

                          {/* Activity Type */}
                          <div>
                            <label className="block text-xs font-medium text-foreground mb-1">Activity Type *</label>
                            <select
                              value={activity.activityType}
                              onChange={(e) => updateActivity(index, 'activityType', e.target.value)}
                              className="w-full px-2 py-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                            >
                              <option value="SEND_EMAIL">Send Email</option>
                              <option value="CALL_API">Call API</option>
                              <option value="UPDATE_ENTITY">Update Entity</option>
                              <option value="EMIT_EVENT">Emit Event</option>
                              <option value="CALL_WEBHOOK">Call Webhook</option>
                              <option value="EXECUTE_FUNCTION">Execute Function</option>
                              <option value="WAIT">Wait</option>
                            </select>
                          </div>

                          {/* Timeout */}
                          <div>
                            <label className="block text-xs font-medium text-foreground mb-1">Timeout</label>
                            <input
                              type="text"
                              value={activity.timeout || ''}
                              onChange={(e) => updateActivity(index, 'timeout', e.target.value)}
                              className="w-full px-2 py-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                              placeholder="PT30S or 30000"
                            />
                            <p className="text-xs text-muted-foreground mt-0.5">ISO 8601 duration or milliseconds</p>
                          </div>

                          {/* Retry Policy */}
                          <div className="border-t border-border pt-3">
                            <h4 className="text-xs font-semibold text-foreground mb-2">Retry Policy</h4>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-xs font-medium text-foreground mb-1">Max Attempts</label>
                                <input
                                  type="number"
                                  value={activity.retryPolicy?.maxAttempts || ''}
                                  onChange={(e) => updateActivityRetryPolicy(index, 'maxAttempts', parseInt(e.target.value) || 0)}
                                  className="w-full px-2 py-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                  placeholder="3"
                                  min="1"
                                  max="10"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-foreground mb-1">Initial Interval (ms)</label>
                                <input
                                  type="number"
                                  value={activity.retryPolicy?.initialIntervalMs || ''}
                                  onChange={(e) => updateActivityRetryPolicy(index, 'initialIntervalMs', parseInt(e.target.value) || 0)}
                                  className="w-full px-2 py-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                  placeholder="1000"
                                  min="0"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-foreground mb-1">Backoff Coefficient</label>
                                <input
                                  type="number"
                                  step="0.1"
                                  value={activity.retryPolicy?.backoffCoefficient || ''}
                                  onChange={(e) => updateActivityRetryPolicy(index, 'backoffCoefficient', parseFloat(e.target.value) || 1)}
                                  className="w-full px-2 py-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                  placeholder="2"
                                  min="1"
                                  max="10"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-foreground mb-1">Max Interval (ms)</label>
                                <input
                                  type="number"
                                  value={activity.retryPolicy?.maxIntervalMs || ''}
                                  onChange={(e) => updateActivityRetryPolicy(index, 'maxIntervalMs', parseInt(e.target.value) || 0)}
                                  className="w-full px-2 py-1.5 border border-border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                  placeholder="10000"
                                  min="0"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Activity Flags */}
                          <div className="border-t border-border pt-3">
                            <h4 className="text-xs font-semibold text-foreground mb-2">Activity Options</h4>
                            <div className="space-y-2">
                              <div className="flex items-center space-x-2">
                                <input
                                  type="checkbox"
                                  id={`activity-async-${index}`}
                                  checked={activity.async || false}
                                  onChange={(e) => updateActivity(index, 'async', e.target.checked)}
                                  className="h-4 w-4 rounded border-border"
                                />
                                <label htmlFor={`activity-async-${index}`} className="text-xs text-foreground cursor-pointer">
                                  Async (run in background)
                                </label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <input
                                  type="checkbox"
                                  id={`activity-compensate-${index}`}
                                  checked={activity.compensate || false}
                                  onChange={(e) => updateActivity(index, 'compensate', e.target.checked)}
                                  className="h-4 w-4 rounded border-border"
                                />
                                <label htmlFor={`activity-compensate-${index}`} className="text-xs text-foreground cursor-pointer">
                                  Compensate (execute compensation on failure)
                                </label>
                              </div>
                            </div>
                          </div>

                          {/* Configuration */}
                          <div className="border-t border-border pt-3">
                            <label className="block text-xs font-medium text-foreground mb-1">Configuration (JSON)</label>
                            <textarea
                              value={JSON.stringify(activity.config || {}, null, 2)}
                              onChange={(e) => updateActivityConfig(index, e.target.value)}
                              rows={6}
                              className="w-full px-2 py-1.5 border border-border rounded text-xs font-mono focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                              placeholder='{}'
                            />
                            <p className="text-xs text-muted-foreground mt-0.5">Activity-specific configuration as JSON</p>
                          </div>

                          {/* Delete Button */}
                          <div className="border-t border-border pt-3">
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => removeActivity(index)}
                            >
                              <Trash2 className="size-4" />
                              Remove Activity
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Advanced Configuration */}
            <div className="border-t border-border pt-4 mt-4">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center justify-between w-full text-left"
              >
                <h3 className="text-sm font-semibold text-foreground">
                  Advanced Configuration (JSON)
                </h3>
                <svg
                  className={`w-5 h-5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showAdvanced && (
                <div className="mt-3">
                  <textarea
                    value={advancedConfig}
                    onChange={(e) => setAdvancedConfig(e.target.value)}
                    placeholder='{"activities": [{"activityId": "...", "activityType": "CALL_API", "config": {...}}]}'
                    rows={10}
                    className="w-full px-3 py-2 border border-border rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Add complex configuration like activities array with CALL_API, SEND_EMAIL, EXECUTE_FUNCTION, etc.
                  </p>
                </div>
              )}
            </div>
        </div>

        <DialogFooter className="flex justify-between">
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
          >
            <Trash2 className="size-4" />
            Delete Transition
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
            >
              Save Changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      {/* Business Rule Selector - Using generic component */}
      <BusinessRulesSelector
        isOpen={showRuleSelector}
        onClose={closeRuleSelector}
        onSelect={handleRuleSelected}
        excludeRuleIds={
          ruleSelectorMode === 'pre'
            ? preConditions.map(c => c.ruleId)
            : postConditions.map(c => c.ruleId)
        }
        title="Select Business Rule"
        description={`Choose a rule to add as a ${ruleSelectorMode === 'pre' ? 'pre-condition' : 'post-condition'}`}
      />
    </Dialog>
  )
}
