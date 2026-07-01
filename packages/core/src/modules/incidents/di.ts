import { asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { IncidentNumberGenerator } from './services/incidentNumberGenerator'
import * as entities from './data/entities'

type AppCradle = AppContainer['cradle'] & { em: EntityManager }

export function register(container: AppContainer) {
  container.register({
    IncidentEntity: asValue(entities.Incident),
    IncidentTimelineEntryEntity: asValue(entities.IncidentTimelineEntry),
    IncidentParticipantEntity: asValue(entities.IncidentParticipant),
    IncidentImpactEntity: asValue(entities.IncidentImpact),
    IncidentActionItemEntity: asValue(entities.IncidentActionItem),
    IncidentPostmortemEntity: asValue(entities.IncidentPostmortem),
    IncidentLinkEntity: asValue(entities.IncidentLink),
    IncidentSeverityEntity: asValue(entities.IncidentSeverity),
    IncidentEscalationPolicyEntity: asValue(entities.IncidentEscalationPolicy),
    IncidentTypeEntity: asValue(entities.IncidentType),
    IncidentRoleEntity: asValue(entities.IncidentRole),
    IncidentSettingsEntity: asValue(entities.IncidentSettings),
    IncidentNumberSequenceEntity: asValue(entities.IncidentNumberSequence),
    incidentNumberGenerator: asFunction(({ em }: AppCradle) => new IncidentNumberGenerator(em)).singleton().proxy(),
  })
}
