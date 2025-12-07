"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Plus, ChevronUp, ChevronDown, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@/lib/i18n/context'

type Member = {
  id: string
  ruleId: string
  ruleName: string
  ruleType: string
  sequence: number
  enabled: boolean
}

type RuleOption = {
  id: string
  ruleId: string
  ruleName: string
  ruleType: string
}

type RuleSetMembersProps = {
  members: Member[]
  onAdd: (ruleId: string, sequence: number) => Promise<void>
  onUpdate: (memberId: string, updates: { sequence?: number; enabled?: boolean }) => Promise<void>
  onRemove: (memberId: string, ruleName: string) => Promise<void>
}

export function RuleSetMembers({ members, onAdd, onUpdate, onRemove }: RuleSetMembersProps) {
  const t = useT()
  const [showAddForm, setShowAddForm] = React.useState(false)
  const [selectedRuleId, setSelectedRuleId] = React.useState('')
  const [sequence, setSequence] = React.useState(0)

  // Fetch available rules
  const { data: availableRules } = useQuery({
    queryKey: ['business-rules', 'rules-list'],
    queryFn: async () => {
      const result = await apiCall<{ items: RuleOption[] }>(
        '/api/business_rules/rules?page=1&pageSize=100&sortField=ruleName&sortDir=asc'
      )
      if (!result.ok) {
        throw new Error('Failed to fetch rules')
      }
      return result.result?.items || []
    },
  })

  // Filter out already added rules (memoized to avoid re-computation on every render)
  const rulesNotInSet = React.useMemo(() => {
    const memberRuleIds = new Set(members.map(m => m.ruleId))
    return availableRules?.filter(r => !memberRuleIds.has(r.id)) || []
  }, [members, availableRules])

  const handleAdd = async () => {
    if (!selectedRuleId) return
    await onAdd(selectedRuleId, sequence)
    setSelectedRuleId('')
    setSequence(0)
    setShowAddForm(false)
  }

  const handleMoveUp = async (member: Member, index: number) => {
    if (index === 0) return
    const prevMember = members[index - 1]
    // Swap sequences
    await onUpdate(member.id, { sequence: prevMember.sequence })
    await onUpdate(prevMember.id, { sequence: member.sequence })
  }

  const handleMoveDown = async (member: Member, index: number) => {
    if (index === members.length - 1) return
    const nextMember = members[index + 1]
    // Swap sequences
    await onUpdate(member.id, { sequence: nextMember.sequence })
    await onUpdate(nextMember.id, { sequence: member.sequence })
  }

  const handleToggleEnabled = async (member: Member) => {
    await onUpdate(member.id, { enabled: !member.enabled })
  }

  return (
    <div className="space-y-4">
      {/* Members List */}
      {members.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>{t('business_rules.sets.members.empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((member, index) => (
            <div
              key={member.id}
              className="flex items-center gap-3 p-3 bg-gray-50 rounded border border-gray-200"
            >
              {/* Order Controls */}
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => handleMoveUp(member, index)}
                  disabled={index === 0}
                  className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title={t('common.moveUp')}
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleMoveDown(member, index)}
                  disabled={index === members.length - 1}
                  className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title={t('common.moveDown')}
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>

              {/* Sequence Number */}
              <div className="flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-700 rounded font-mono text-sm font-medium">
                {member.sequence}
              </div>

              {/* Rule Info */}
              <div className="flex-1">
                <div className="font-medium">{member.ruleName}</div>
                <div className="text-xs text-gray-500 font-mono">{member.ruleId}</div>
              </div>

              {/* Rule Type Badge */}
              <div className="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded font-medium">
                {member.ruleType}
              </div>

              {/* Enabled Toggle */}
              <button
                onClick={() => handleToggleEnabled(member)}
                className={`px-2 py-1 rounded text-xs font-medium cursor-pointer ${
                  member.enabled
                    ? 'bg-green-100 text-green-800 hover:bg-green-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                title={t('business_rules.sets.members.actions.toggleEnabled')}
              >
                {member.enabled ? t('common.enabled') : t('common.disabled')}
              </button>

              {/* Remove Button */}
              <button
                onClick={() => onRemove(member.id, member.ruleName)}
                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                title={t('common.remove')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add Rule Form */}
      {showAddForm ? (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded space-y-3">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('business_rules.sets.members.form.selectRule')}
              </label>
              <select
                value={selectedRuleId}
                onChange={(e) => setSelectedRuleId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t('business_rules.sets.members.form.selectRulePlaceholder')}</option>
                {rulesNotInSet.map((rule) => (
                  <option key={rule.id} value={rule.id}>
                    {rule.ruleName} ({rule.ruleId})
                  </option>
                ))}
              </select>
            </div>

            <div className="w-32">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('business_rules.sets.members.form.sequence')}
              </label>
              <input
                type="number"
                value={sequence}
                onChange={(e) => setSequence(parseInt(e.target.value) || 0)}
                min={0}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleAdd} disabled={!selectedRuleId} size="sm">
              {t('business_rules.sets.members.actions.add')}
            </Button>
            <Button
              onClick={() => {
                setShowAddForm(false)
                setSelectedRuleId('')
                setSequence(0)
              }}
              variant="outline"
              size="sm"
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setShowAddForm(true)} variant="outline" size="sm">
          <Plus className="w-4 h-4 mr-2" />
          {t('business_rules.sets.members.actions.addRule')}
        </Button>
      )}

      {/* Help Text */}
      <div className="text-xs text-gray-500 space-y-1">
        <p>
          <strong>{t('business_rules.sets.members.help.ordering')}:</strong>{' '}
          {t('business_rules.sets.members.help.orderingDescription')}
        </p>
        <p>
          <strong>{t('business_rules.sets.members.help.enabled')}:</strong>{' '}
          {t('business_rules.sets.members.help.enabledDescription')}
        </p>
      </div>
    </div>
  )
}
