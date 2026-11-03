'use client'
import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { GroupCondition, ConditionExpression, SimpleCondition } from '@open-mercato/core/modules/business_rules/components/utils/conditionValidation'
import {
  AUDIENCE_FIELD_GROUPS, findAudienceField, isEditableRule,
  type AudienceField, type AudienceFieldGroup, type AudienceOperator,
} from '../lib/audience/field-catalog.js'

export type AudienceOption = { value: string; label: string }
export type AudienceOptions = Partial<Record<string, AudienceOption[]>>

export type AudienceBuilderProps = {
  value: GroupCondition | null | undefined
  onChange: (value: GroupCondition) => void
  fields: AudienceField[]
  options: AudienceOptions
}

const isGroup = (rule: ConditionExpression): rule is GroupCondition =>
  !!rule && typeof rule === 'object' && 'rules' in rule && Array.isArray((rule as GroupCondition).rules)

const EMPTY: GroupCondition = { operator: 'AND', rules: [] }

/**
 * Authoring an audience without knowing what a dot-path is.
 *
 * The platform's own `ConditionBuilder` edits the same expression, and it is the right component for
 * somebody who knows the data model: a free-text field path, a free-text value, and a help note advising
 * JSON for anything list-shaped. That is a programmer's interface, and the person who decides who gets an
 * email is not one.
 *
 * So: the field is picked from a grouped list, the operator reads as a phrase, and the value control is
 * whatever the field needs — a number, an amount, a count of days, or a dropdown filled from the shop's own
 * tags, categories, channels, segments and tiers.
 *
 * **The stored expression is unchanged.** This edits the same `ConditionExpression` the platform evaluates,
 * field for field and operator for operator. Nothing here is a second condition language; it is a second
 * way to write the first one, which is why a campaign authored either way still runs the same.
 *
 * A rule this editor cannot represent — a nested group, a path outside the catalogue, an operator the
 * catalogue does not offer for that field — is shown READ-ONLY and passed through untouched. Rewriting
 * somebody's audience into something the screen happens to understand would change who gets messaged, and
 * that is a worse outcome than admitting one rule needs the advanced view.
 */
export function AudienceBuilder({ value, onChange, fields, options }: AudienceBuilderProps) {
  const t = useT()
  const group = value && isGroup(value) ? value : EMPTY

  const byGroup = React.useMemo(() => {
    const map = new Map<AudienceFieldGroup, AudienceField[]>()
    for (const field of fields) {
      const list = map.get(field.group) ?? []
      list.push(field)
      map.set(field.group, list)
    }
    return map
  }, [fields])

  const replaceRule = (at: number, rule: ConditionExpression) => {
    const rules = group.rules.slice()
    rules[at] = rule
    onChange({ ...group, rules })
  }

  const removeRule = (at: number) => {
    onChange({ ...group, rules: group.rules.filter((_, index) => index !== at) })
  }

  const addRule = () => {
    const first = fields[0]
    if (!first) return
    onChange({
      ...group,
      rules: [...group.rules, { field: first.path, operator: first.operators[0], value: defaultValueFor(first) }],
    })
  }

  return (
    <div className="space-y-3">
      {group.rules.length > 1 ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('marketing_automation.audience.match', 'Match')}</span>
          <Select
            value={group.operator === 'OR' ? 'OR' : 'AND'}
            onValueChange={(next) => onChange({ ...group, operator: next as GroupCondition['operator'] })}
          >
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="AND">{t('marketing_automation.audience.match.all', 'all of these')}</SelectItem>
              <SelectItem value="OR">{t('marketing_automation.audience.match.any', 'any of these')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {group.rules.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {t('marketing_automation.audience.empty', 'Everyone the trigger produces. Add a condition to narrow it down.')}
        </div>
      ) : null}

      {group.rules.map((rule, at) => {
        if (isGroup(rule) || !isEditableRule((rule as SimpleCondition).field, String((rule as SimpleCondition).operator))) {
          return (
            <ReadOnlyRule
              key={at}
              rule={rule}
              onRemove={() => removeRule(at)}
              label={t(
                'marketing_automation.audience.advancedRule',
                'Written in the advanced editor. Shown here so it is not lost, and edited there.',
              )}
              removeLabel={t('marketing_automation.audience.remove', 'Remove')}
            />
          )
        }
        return (
          <RuleRow
            key={at}
            rule={rule as SimpleCondition}
            groups={AUDIENCE_FIELD_GROUPS.filter((name) => (byGroup.get(name) ?? []).length > 0)}
            byGroup={byGroup}
            options={options}
            onChange={(next) => replaceRule(at, next)}
            onRemove={() => removeRule(at)}
          />
        )
      })}

      <Button type="button" variant="outline" size="sm" onClick={addRule}>
        {t('marketing_automation.audience.add', 'Add a condition')}
      </Button>
    </div>
  )
}

function ReadOnlyRule({ rule, onRemove, label, removeLabel }: {
  rule: ConditionExpression
  onRemove: () => void
  label: string
  removeLabel: string
}) {
  return (
    <div className="rounded-md border border-dashed p-3">
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      <div className="flex items-start justify-between gap-2">
        <code className="text-xs">{summarise(rule)}</code>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>{removeLabel}</Button>
      </div>
    </div>
  )
}

/** A one-line rendering of a rule this editor will not touch, so it is visible rather than merely present. */
function summarise(rule: ConditionExpression): string {
  if (isGroup(rule)) return `${rule.operator} (${rule.rules.length})`
  const simple = rule as SimpleCondition
  return `${simple.field} ${String(simple.operator)} ${JSON.stringify(simple.value ?? null)}`
}

function defaultValueFor(field: AudienceField): unknown {
  if (field.kind === 'number' || field.kind === 'days' || field.kind === 'money') return field.min ?? 0
  return ''
}

function RuleRow({ rule, groups, byGroup, options, onChange, onRemove }: {
  rule: SimpleCondition
  groups: AudienceFieldGroup[]
  byGroup: Map<AudienceFieldGroup, AudienceField[]>
  options: AudienceOptions
  onChange: (rule: SimpleCondition) => void
  onRemove: () => void
}) {
  const t = useT()
  const field = findAudienceField(rule.field)
  if (!field) return null

  const pickField = (path: string) => {
    const next = findAudienceField(path)
    if (!next) return
    // The operator and the value both belong to the OLD field. Carrying either across would produce a rule
    // like `tags >= 5`, which the evaluator answers false for every customer — an audience that silently
    // matches nobody.
    onChange({ field: next.path, operator: next.operators[0], value: defaultValueFor(next) })
  }

  const choices = field.optionSource ? options[field.optionSource] ?? [] : []

  return (
    <div className="flex flex-wrap items-start gap-2 rounded-md border p-3">
      <Select value={field.path} onValueChange={pickField}>
        <SelectTrigger className="min-w-0 flex-1 basis-56"><SelectValue /></SelectTrigger>
        <SelectContent>
          {groups.map((name) => (
            <SelectGroup key={name}>
              <SelectLabel>{t(`marketing_automation.audience.group.${name}`, name)}</SelectLabel>
              {(byGroup.get(name) ?? []).map((entry) => (
                <SelectItem key={entry.path} value={entry.path}>{t(entry.labelKey, entry.path)}</SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={String(rule.operator)}
        onValueChange={(next) => onChange({ ...rule, operator: next as SimpleCondition['operator'] })}
      >
        <SelectTrigger className="min-w-0 flex-1 basis-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          {field.operators.map((operator) => (
            <SelectItem key={operator} value={operator}>
              {t(`marketing_automation.audience.operator.${field.kind}.${operator}`, operator)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
        {choices.length > 0 ? (
          <Select value={String(rule.value ?? '')} onValueChange={(next) => onChange({ ...rule, value: next })}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('marketing_automation.audience.pick', 'Choose…')} />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            className="w-full"
            type={field.kind === 'text' ? 'text' : 'number'}
            min={field.min}
            max={field.max}
            value={rule.value === null || rule.value === undefined ? '' : String(rule.value)}
            onChange={(event) => {
              const raw = event.target.value
              if (field.kind === 'text') return onChange({ ...rule, value: raw })
              // Empty stays empty rather than becoming 0: a blank box means "not filled in yet", and a zero
              // is a condition somebody might actually have meant.
              onChange({ ...rule, value: raw === '' ? null : Number(raw) })
            }}
          />
        )}
        {field.hintKey ? (
          <span className="text-xs text-muted-foreground">{t(field.hintKey, '')}</span>
        ) : null}
        {field.optionSource && choices.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            {t(`marketing_automation.audience.noOptions.${field.optionSource}`, 'Nothing to choose from yet.')}
          </span>
        ) : null}
      </div>

      {field.kind === 'days' ? (
        <span className="self-center text-sm text-muted-foreground">
          {t('marketing_automation.audience.days', 'days')}
        </span>
      ) : null}

      <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onRemove}>
        {t('marketing_automation.audience.remove', 'Remove')}
      </Button>
    </div>
  )
}
