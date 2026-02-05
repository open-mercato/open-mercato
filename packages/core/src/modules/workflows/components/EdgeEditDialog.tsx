'use client'

import {Edge} from '@xyflow/react'
import {useEffect, useState} from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@open-mercato/ui/primitives/dialog'
import {Button} from '@open-mercato/ui/primitives/button'
import {Input} from '@open-mercato/ui/primitives/input'
import {Label} from '@open-mercato/ui/primitives/label'
import {Badge} from '@open-mercato/ui/primitives/badge'
import {Separator} from '@open-mercato/ui/primitives/separator'
import {Plus, Trash2} from 'lucide-react'
import {type BusinessRule, BusinessRulesSelector} from './BusinessRulesSelector'
import {JsonBuilder} from '@open-mercato/ui/backend/JsonBuilder'
import {useT} from '@open-mercato/shared/lib/i18n/context'

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
  const t = useT()
  const [transitionName, setTransitionName] = useState('')
  const [trigger, setTrigger] = useState('auto')
  const [priority, setPriority] = useState('100')
  const [continueOnActivityFailure, setContinueOnActivityFailure] = useState(true)
  const [preConditions, setPreConditions] = useState<TransitionCondition[]>([])
  const [postConditions, setPostConditions] = useState<TransitionCondition[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [advancedConfig, setAdvancedConfig] = useState<Record<string, any>>({})
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
      setAdvancedConfig(advancedFields)
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
      activityName: t('workflows.common.newActivity'),
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
    if (confirm(t('workflows.edgeEditor.confirmRemoveActivity'))) {
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

    // Merge advanced config
    if (advancedConfig && Object.keys(advancedConfig).length > 0) {
      Object.assign(updates, advancedConfig)
    }

    onSave(edge.id, updates)
    onClose()
  }

  const handleDelete = () => {
    if (!edge) return
    if (confirm(t('workflows.edgeEditor.confirmDelete'))) {
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
            <DialogTitle>{t('workflows.edgeEditor.title')}</DialogTitle>
            <Badge variant={triggerVariant} className="text-xs">
              {t(`workflows.transitions.triggers.${trigger}`)}
            </Badge>
          </div>
          <div className="space-y-1">
            <DialogDescription>
              {t('workflows.edgeEditor.description')}
            </DialogDescription>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">{t('workflows.edgeEditor.id')}:</span>
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono">{edge.id}</code>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">{t('workflows.edgeEditor.flow')}:</span>
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono">{edge.source}</code>
              <span>→</span>
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono">{edge.target}</code>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
            {/* Transition Name */}
            <div className="space-y-2">
              <Label htmlFor="transitionName">{t('workflows.edgeEditor.transitionName')}</Label>
              <Input
                id="transitionName"
                type="text"
                value={transitionName}
                onChange={(e) => setTransitionName(e.target.value)}
                placeholder={t('workflows.edgeEditor.transitionNamePlaceholder', { name: generateNameFromId(edge.id) })}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                {t('workflows.edgeEditor.transitionNameHint')}
              </p>
            </div>

            {/* Trigger Type */}
            <div className="space-y-2">
              <Label htmlFor="trigger">{t('workflows.edgeEditor.triggerType')}</Label>
              <select
                id="trigger"
                value={trigger}
                onChange={(e) => setTrigger(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="auto">{t('workflows.transitions.triggers.auto')}</option>
                <option value="manual">{t('workflows.transitions.triggers.manual')}</option>
                <option value="signal">{t('workflows.transitions.triggers.signal')}</option>
                <option value="timer">{t('workflows.transitions.triggers.timer')}</option>
              </select>
              <p className="text-xs text-muted-foreground">
                {t(`workflows.edgeEditor.triggerDescriptions.${trigger}`)}
              </p>
            </div>

            {/* Priority */}
            <div className="space-y-2">
              <Label htmlFor="priority">{t('workflows.edgeEditor.priority')}</Label>
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
                {t('workflows.edgeEditor.priorityHint')}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="continueOnActivityFailure"
                  checked={continueOnActivityFailure}
                  onChange={(e) => setContinueOnActivityFailure(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="continueOnActivityFailure" className="font-normal cursor-pointer">
                  {t('workflows.edgeEditor.continueOnActivityFailure')}
                </Label>
              </div>
              <p className="text-xs text-muted-foreground ml-6">
                {t('workflows.edgeEditor.continueOnActivityFailureHint')}
              </p>
            </div>

            <Separator />

            {/* Pre-conditions (Business Rules) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">
                    {t('workflows.edgeEditor.preConditions')} ({preConditions.length})
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {t('workflows.edgeEditor.preConditionsHint')}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => openRuleSelector('pre')}
                >
                  <Plus className="size-3" />
                  {t('workflows.edgeEditor.addRule')}
                </Button>
              </div>

              {preConditions.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground bg-muted rounded-lg border">
                  {t('workflows.edgeEditor.noPreConditions')}
                </div>
              )}

              <div className="space-y-2">
                {preConditions.map((condition, index) => {
                  const isExpanded = expandedPreConditions.has(index)
                  const rule = getBusinessRuleDetails(condition.ruleId)
                  return (
                    <div key={index} className="border border-gray-200 rounded-lg bg-gray-50">
                      <button
                        type="button"
                        onClick={() => togglePreCondition(index)}
                        className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-gray-100 transition-colors rounded-t-lg"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-900">
                              {rule?.ruleName || condition.ruleId}
                            </span>
                            {condition.required && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                {t('workflows.edgeEditor.required')}
                              </span>
                            )}
                            {rule && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                                {rule.ruleType}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-600 mt-1">
                            {t('workflows.edgeEditor.ruleId')}: <code className="bg-white px-1 rounded">{condition.ruleId}</code>
                          </p>
                          {rule?.description && (
                            <p className="text-xs text-gray-500 mt-1 line-clamp-1">{rule.description}</p>
                          )}
                        </div>
                        <svg
                          className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-4 space-y-3 border-t border-gray-200 bg-white">
                          <div className="pt-3">
                            <label className="block text-xs font-medium text-gray-700 mb-1">{t('workflows.edgeEditor.ruleId')}</label>
                            <input
                              type="text"
                              value={condition.ruleId}
                              onChange={(e) => updatePreCondition(index, 'ruleId', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>

                          <div>
                            <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
                              <input
                                type="checkbox"
                                checked={condition.required}
                                onChange={(e) => updatePreCondition(index, 'required', e.target.checked)}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              {t('workflows.edgeEditor.requiredCheckbox')}
                            </label>
                          </div>

                          {rule && (
                            <div className="border-t border-gray-200 pt-3">
                              <h4 className="text-xs font-semibold text-gray-900 mb-2">{t('workflows.edgeEditor.businessRuleDetails')}</h4>
                              <dl className="space-y-1 text-xs">
                                <div className="flex justify-between">
                                  <dt className="font-medium text-gray-700">Name:</dt>
                                  <dd className="text-gray-900">{rule.ruleName}</dd>
                                </div>
                                <div className="flex justify-between">
                                  <dt className="font-medium text-gray-700">Type:</dt>
                                  <dd className="text-gray-900">{rule.ruleType}</dd>
                                </div>
                                {rule.ruleCategory && (
                                  <div className="flex justify-between">
                                    <dt className="font-medium text-gray-700">Category:</dt>
                                    <dd className="text-gray-900">{rule.ruleCategory}</dd>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <dt className="font-medium text-gray-700">Entity Type:</dt>
                                  <dd className="text-gray-900 font-mono text-xs">{rule.entityType}</dd>
                                </div>
                                {rule.eventType && (
                                  <div className="flex justify-between">
                                    <dt className="font-medium text-gray-700">Event Type:</dt>
                                    <dd className="text-gray-900">{rule.eventType}</dd>
                                  </div>
                                )}
                                {rule.description && (
                                  <div className="mt-2 pt-2 border-t border-gray-200">
                                    <dt className="font-medium text-gray-700 mb-1">Description:</dt>
                                    <dd className="text-gray-600">{rule.description}</dd>
                                  </div>
                                )}
                              </dl>
                            </div>
                          )}

                          <div className="border-t border-gray-200 pt-3">
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => removePreCondition(index)}
                            >
                              <Trash2 className="size-4" />
                              {t('workflows.edgeEditor.removePreCondition')}
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
                    {t('workflows.edgeEditor.postConditions')} ({postConditions.length})
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {t('workflows.edgeEditor.postConditionsHint')}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => openRuleSelector('post')}
                >
                  <Plus className="size-3" />
                  {t('workflows.edgeEditor.addRule')}
                </Button>
              </div>

              {postConditions.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground bg-muted rounded-lg border">
                  {t('workflows.edgeEditor.noPostConditions')}
                </div>
              )}

              <div className="space-y-2">
                {postConditions.map((condition, index) => {
                  const isExpanded = expandedPostConditions.has(index)
                  const rule = getBusinessRuleDetails(condition.ruleId)
                  return (
                    <div key={index} className="border border-gray-200 rounded-lg bg-gray-50">
                      <button
                        type="button"
                        onClick={() => togglePostCondition(index)}
                        className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-gray-100 transition-colors rounded-t-lg"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-900">
                              {rule?.ruleName || condition.ruleId}
                            </span>
                            {condition.required && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                {t('workflows.edgeEditor.required')}
                              </span>
                            )}
                            {rule && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                                {rule.ruleType}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-600 mt-1">
                            {t('workflows.edgeEditor.ruleId')}: <code className="bg-white px-1 rounded">{condition.ruleId}</code>
                          </p>
                          {rule?.description && (
                            <p className="text-xs text-gray-500 mt-1 line-clamp-1">{rule.description}</p>
                          )}
                        </div>
                        <svg
                          className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-4 space-y-3 border-t border-gray-200 bg-white">
                          <div className="pt-3">
                            <label className="block text-xs font-medium text-gray-700 mb-1">{t('workflows.edgeEditor.ruleId')}</label>
                            <input
                              type="text"
                              value={condition.ruleId}
                              onChange={(e) => updatePostCondition(index, 'ruleId', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>

                          <div>
                            <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
                              <input
                                type="checkbox"
                                checked={condition.required}
                                onChange={(e) => updatePostCondition(index, 'required', e.target.checked)}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              {t('workflows.edgeEditor.requiredPostCheckbox')}
                            </label>
                          </div>

                          {rule && (
                            <div className="border-t border-gray-200 pt-3">
                              <h4 className="text-xs font-semibold text-gray-900 mb-2">{t('workflows.edgeEditor.businessRuleDetails')}</h4>
                              <dl className="space-y-1 text-xs">
                                <div className="flex justify-between">
                                  <dt className="font-medium text-gray-700">Name:</dt>
                                  <dd className="text-gray-900">{rule.ruleName}</dd>
                                </div>
                                <div className="flex justify-between">
                                  <dt className="font-medium text-gray-700">Type:</dt>
                                  <dd className="text-gray-900">{rule.ruleType}</dd>
                                </div>
                                {rule.ruleCategory && (
                                  <div className="flex justify-between">
                                    <dt className="font-medium text-gray-700">Category:</dt>
                                    <dd className="text-gray-900">{rule.ruleCategory}</dd>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <dt className="font-medium text-gray-700">Entity Type:</dt>
                                  <dd className="text-gray-900 font-mono text-xs">{rule.entityType}</dd>
                                </div>
                                {rule.eventType && (
                                  <div className="flex justify-between">
                                    <dt className="font-medium text-gray-700">Event Type:</dt>
                                    <dd className="text-gray-900">{rule.eventType}</dd>
                                  </div>
                                )}
                                {rule.description && (
                                  <div className="mt-2 pt-2 border-t border-gray-200">
                                    <dt className="font-medium text-gray-700 mb-1">Description:</dt>
                                    <dd className="text-gray-600">{rule.description}</dd>
                                  </div>
                                )}
                              </dl>
                            </div>
                          )}

                          <div className="border-t border-gray-200 pt-3">
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => removePostCondition(index)}
                            >
                              <Trash2 className="size-4" />
                              {t('workflows.edgeEditor.removePostCondition')}
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
            <div className="border-t border-gray-200 pt-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">
                  {t('workflows.edgeEditor.activities')} ({activities.length})
                </h3>
                <Button
                  type="button"
                  size="sm"
                  onClick={addActivity}
                >
                  <Plus className="size-3" />
                  {t('workflows.edgeEditor.addActivity')}
                </Button>
              </div>

              {activities.length === 0 && (
                <div className="p-4 text-center text-sm text-gray-500 bg-gray-50 rounded-lg border border-gray-200">
                  {t('workflows.edgeEditor.noActivities')}
                </div>
              )}

              <div className="space-y-2">
                {activities.map((activity, index) => {
                  const isExpanded = expandedActivities.has(index)
                  return (
                    <div key={index} className="border border-gray-200 rounded-lg bg-gray-50">
                      <button
                        type="button"
                        onClick={() => toggleActivity(index)}
                        className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-gray-100 transition-colors rounded-t-lg"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-900">
                              {activity.activityName || activity.label || activity.activityId || `Activity ${index + 1}`}
                            </span>
                            <Badge variant="secondary" className="text-xs">
                              {activity.activityType}
                            </Badge>
                          </div>
                          <p className="text-xs text-gray-600 mt-1">
                            {t('workflows.edgeEditor.activityId')}: <code className="bg-white px-1 rounded">{activity.activityId}</code>
                          </p>
                        </div>
                        <svg
                          className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-4 space-y-3 border-t border-gray-200 bg-white">
                          {/* Activity ID */}
                          <div className="pt-3">
                            <label className="block text-xs font-medium text-gray-700 mb-1">{t('workflows.edgeEditor.activityId')} *</label>
                            <input
                              type="text"
                              value={activity.activityId}
                              onChange={(e) => updateActivity(index, 'activityId', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                              placeholder={t('workflows.edgeEditor.activityIdPlaceholder')}
                            />
                          </div>

                          {/* Activity Name */}
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">{t('workflows.edgeEditor.activityName')} *</label>
                            <input
                              type="text"
                              value={activity.activityName || ''}
                              onChange={(e) => updateActivity(index, 'activityName', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                              placeholder={t('workflows.edgeEditor.activityNamePlaceholder')}
                            />
                          </div>

                          {/* Activity Type */}
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">{t('workflows.edgeEditor.activityType')} *</label>
                            <select
                              value={activity.activityType}
                              onChange={(e) => updateActivity(index, 'activityType', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                            >
                              <option value="SEND_EMAIL">{t('workflows.activities.types.SEND_EMAIL')}</option>
                              <option value="CALL_API">{t('workflows.activities.types.CALL_API')}</option>
                              <option value="UPDATE_ENTITY">{t('workflows.activities.types.UPDATE_ENTITY')}</option>
                              <option value="EMIT_EVENT">{t('workflows.activities.types.EMIT_EVENT')}</option>
                              <option value="CALL_WEBHOOK">{t('workflows.activities.types.CALL_WEBHOOK')}</option>
                              <option value="EXECUTE_FUNCTION">{t('workflows.activities.types.EXECUTE_FUNCTION')}</option>
                              <option value="WAIT">{t('workflows.activities.types.WAIT')}</option>
                            </select>
                          </div>

                          {/* Timeout */}
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">{t('workflows.edgeEditor.timeout')}</label>
                            <input
                              type="text"
                              value={activity.timeout || ''}
                              onChange={(e) => updateActivity(index, 'timeout', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                              placeholder={t('workflows.edgeEditor.timeoutPlaceholder')}
                            />
                            <p className="text-xs text-gray-500 mt-0.5">{t('workflows.edgeEditor.timeoutHint')}</p>
                          </div>

                          {/* Retry Policy */}
                          <div className="border-t border-gray-200 pt-3">
                            <h4 className="text-xs font-semibold text-gray-900 mb-2">{t('workflows.edgeEditor.retryPolicy')}</h4>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">{t('workflows.edgeEditor.maxAttempts')}</label>
                                <input
                                  type="number"
                                  value={activity.retryPolicy?.maxAttempts || ''}
                                  onChange={(e) => updateActivityRetryPolicy(index, 'maxAttempts', parseInt(e.target.value) || 0)}
                                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                  placeholder="3"
                                  min="1"
                                  max="10"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">{t('workflows.edgeEditor.initialInterval')}</label>
                                <input
                                  type="number"
                                  value={activity.retryPolicy?.initialIntervalMs || ''}
                                  onChange={(e) => updateActivityRetryPolicy(index, 'initialIntervalMs', parseInt(e.target.value) || 0)}
                                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                  placeholder="1000"
                                  min="0"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">{t('workflows.edgeEditor.backoffCoefficient')}</label>
                                <input
                                  type="number"
                                  step="0.1"
                                  value={activity.retryPolicy?.backoffCoefficient || ''}
                                  onChange={(e) => updateActivityRetryPolicy(index, 'backoffCoefficient', parseFloat(e.target.value) || 1)}
                                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                  placeholder="2"
                                  min="1"
                                  max="10"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">{t('workflows.edgeEditor.maxInterval')}</label>
                                <input
                                  type="number"
                                  value={activity.retryPolicy?.maxIntervalMs || ''}
                                  onChange={(e) => updateActivityRetryPolicy(index, 'maxIntervalMs', parseInt(e.target.value) || 0)}
                                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                  placeholder="10000"
                                  min="0"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Activity Flags */}
                          <div className="border-t border-gray-200 pt-3">
                            <h4 className="text-xs font-semibold text-gray-900 mb-2">{t('workflows.edgeEditor.activityOptions')}</h4>
                            <div className="space-y-2">
                              <div className="flex items-center space-x-2">
                                <input
                                  type="checkbox"
                                  id={`activity-async-${index}`}
                                  checked={activity.async || false}
                                  onChange={(e) => updateActivity(index, 'async', e.target.checked)}
                                  className="h-4 w-4 rounded border-gray-300"
                                />
                                <label htmlFor={`activity-async-${index}`} className="text-xs text-gray-700 cursor-pointer">
                                  {t('workflows.edgeEditor.asyncOption')}
                                </label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <input
                                  type="checkbox"
                                  id={`activity-compensate-${index}`}
                                  checked={activity.compensate || false}
                                  onChange={(e) => updateActivity(index, 'compensate', e.target.checked)}
                                  className="h-4 w-4 rounded border-gray-300"
                                />
                                <label htmlFor={`activity-compensate-${index}`} className="text-xs text-gray-700 cursor-pointer">
                                  {t('workflows.edgeEditor.compensateOption')}
                                </label>
                              </div>
                            </div>
                          </div>

                          {/* Configuration */}
                          <div className="border-t border-gray-200 pt-3">
                            <label className="block text-xs font-medium text-gray-700 mb-1">{t('workflows.edgeEditor.configurationJson')}</label>
                            <JsonBuilder
                              value={activity.config || {}}
                              onChange={(config) => {
                                const updated = [...activities]
                                updated[index] = { ...updated[index], config }
                                setActivities(updated)
                              }}
                            />
                            <p className="text-xs text-gray-500 mt-0.5">{t('workflows.edgeEditor.configurationHint')}</p>
                          </div>

                          {/* Delete Button */}
                          <div className="border-t border-gray-200 pt-3">
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => removeActivity(index)}
                            >
                              <Trash2 className="size-4" />
                              {t('workflows.edgeEditor.removeActivity')}
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
            <div className="border-t border-gray-200 pt-4 mt-4">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center justify-between w-full text-left"
              >
                <h3 className="text-sm font-semibold text-gray-900">
                  {t('workflows.edgeEditor.advancedConfiguration')}
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
                  <JsonBuilder
                    value={advancedConfig}
                    onChange={setAdvancedConfig}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {t('workflows.edgeEditor.advancedConfigHint')}
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
            {t('workflows.edgeEditor.deleteTransition')}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
            >
              {t('workflows.edgeEditor.cancel')}
            </Button>
            <Button
              type="button"
              onClick={handleSave}
            >
              {t('workflows.edgeEditor.saveChanges')}
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
        title={t('workflows.edgeEditor.selectBusinessRule')}
        description={t('workflows.edgeEditor.selectBusinessRuleDescription', {
          mode: ruleSelectorMode === 'pre'
            ? t('workflows.edgeEditor.preConditions').toLowerCase()
            : t('workflows.edgeEditor.postConditions').toLowerCase()
        })}
      />
    </Dialog>
  )
}
