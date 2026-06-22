"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { mapAgentDetail, type AgentDetailView, type SkillDetailView } from '../../../components/types'
import { SkillDrawer } from '../../../components/SkillDrawer'

type PageState = 'loading' | 'notFound' | 'forbidden' | 'error' | 'ready'

export default function AgentDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const agentId = params?.id ?? ''

  const [state, setState] = React.useState<PageState>('loading')
  const [agent, setAgent] = React.useState<AgentDetailView | null>(null)
  const [activeSkill, setActiveSkill] = React.useState<SkillDetailView | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setState('loading')
      const call = await apiCall<Record<string, unknown>>(
        `/api/agent_orchestrator/agents/${encodeURIComponent(agentId)}`,
      )
      if (cancelled) return
      if (!call.ok) {
        if (call.status === 404) setState('notFound')
        else if (call.status === 403) setState('forbidden')
        else setState('error')
        return
      }
      const mapped = call.result ? mapAgentDetail(call.result) : null
      if (!mapped) {
        setState('notFound')
        return
      }
      setAgent(mapped)
      setState('ready')
    }
    if (agentId) load()
    else setState('notFound')
    return () => {
      cancelled = true
    }
  }, [agentId])

  if (state === 'loading') {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('agent_orchestrator.agentDetail.title')} />
        </PageBody>
      </Page>
    )
  }

  if (state === 'notFound' || state === 'forbidden') {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={
              state === 'forbidden'
                ? t('agent_orchestrator.agentDetail.forbidden')
                : t('agent_orchestrator.agentDetail.notFound')
            }
            description={
              state === 'forbidden'
                ? t('agent_orchestrator.agentDetail.forbiddenDescription')
                : t('agent_orchestrator.agentDetail.notFoundDescription')
            }
            backHref="/backend/agents"
            backLabel={t('agent_orchestrator.agentDetail.back')}
          />
        </PageBody>
      </Page>
    )
  }

  if (state === 'error' || !agent) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={t('agent_orchestrator.agentDetail.error')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody className="max-w-3xl space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate font-mono text-lg font-semibold">{agent.id}</h1>
            <p className="text-sm text-muted-foreground">
              {t(`agent_orchestrator.agents.list.resultKind.${agent.resultKind}`)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm">
              <Link href={`/backend/playground?agent=${encodeURIComponent(agent.id)}`}>
                {t('agent_orchestrator.agents.list.openPlayground')}
              </Link>
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => router.push('/backend/agents')}>
              {t('agent_orchestrator.agentDetail.back')}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('agent_orchestrator.agentDetail.fields.label')} value={agent.label} />
            <Field label={t('agent_orchestrator.agentDetail.fields.module')} value={agent.moduleId} mono />
            <Field
              label={t('agent_orchestrator.agentDetail.fields.runtime')}
              value={t(`agent_orchestrator.agents.list.runtime.${agent.runtime}`)}
            />
            <Field
              label={t('agent_orchestrator.agentDetail.fields.provider')}
              value={agent.defaultProvider ?? t('agent_orchestrator.agentDetail.defaultValue')}
              mono
            />
            <Field
              label={t('agent_orchestrator.agentDetail.fields.model')}
              value={agent.defaultModel ?? t('agent_orchestrator.agentDetail.defaultValue')}
              mono
            />
            <Field
              label={t('agent_orchestrator.agentDetail.fields.maxSteps')}
              value={agent.loopMaxSteps != null ? String(agent.loopMaxSteps) : t('agent_orchestrator.agentDetail.defaultValue')}
              mono
            />
          </dl>
          {agent.description ? (
            <p className="mt-4 text-sm text-muted-foreground">{agent.description}</p>
          ) : null}
        </div>

        <section className="space-y-2">
          <SectionHeader title={t('agent_orchestrator.agentDetail.fields.tools')} />
          {agent.tools.length ? (
            <div className="flex flex-wrap gap-1">
              {agent.tools.map((tool) => (
                <Tag key={tool} variant="neutral">{tool}</Tag>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('agent_orchestrator.agentDetail.noTools')}</p>
          )}
        </section>

        {agent.subAgents.length ? (
          <section className="space-y-2">
            <SectionHeader title={t('agent_orchestrator.agentDetail.fields.subAgents')} />
            <div className="flex flex-wrap gap-1">
              {agent.subAgents.map((subId) => (
                <Button key={subId} asChild variant="outline" size="sm">
                  <Link href={`/backend/agents/${encodeURIComponent(subId)}`}>{subId}</Link>
                </Button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="space-y-2">
          <SectionHeader title={t('agent_orchestrator.agentDetail.fields.skills')} />
          {agent.skillDetails.length ? (
            <ul className="space-y-2">
              {agent.skillDetails.map((skill) => (
                <li key={skill.id}>
                  <button
                    type="button"
                    onClick={() => setActiveSkill(skill)}
                    className="w-full rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-brand-violet/40 hover:bg-accent/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={t('agent_orchestrator.agentDetail.viewSkill', undefined, { skill: skill.label })}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-sm font-medium">{skill.id}</p>
                      <span className="text-xs text-muted-foreground">{skill.label}</span>
                    </div>
                    {skill.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">{skill.description}</p>
                    ) : null}
                    {skill.tools.length ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <span className="text-xs text-muted-foreground">
                          {t('agent_orchestrator.agentDetail.skillTools')}:
                        </span>
                        {skill.tools.map((tool) => (
                          <Tag key={tool} variant="neutral">{tool}</Tag>
                        ))}
                      </div>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('agent_orchestrator.agentDetail.noSkills')}</p>
          )}
        </section>

        <SkillDrawer
          open={!!activeSkill}
          onOpenChange={(open) => { if (!open) setActiveSkill(null) }}
          skill={activeSkill}
        />

        <section className="space-y-2">
          <SectionHeader title={t('agent_orchestrator.agentDetail.fields.instructions')} />
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-4 text-sm text-foreground">
            {agent.instructions || t('agent_orchestrator.agentDetail.defaultValue')}
          </pre>
        </section>
      </PageBody>
    </Page>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`truncate text-sm text-foreground${mono ? ' font-mono' : ''}`}>{value}</dd>
    </div>
  )
}
