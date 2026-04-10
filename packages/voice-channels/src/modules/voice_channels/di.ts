import { asValue, asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { CopilotOrchestrator } from './lib/copilot/orchestrator'
import { MockTranscriptSimulator } from './lib/mock/simulator'
import { IntentDetector } from './lib/copilot/intent-detector'

export function register(container: AppContainer) {
  container.register({
    copilotOrchestrator: asFunction(() => new CopilotOrchestrator(container)).singleton(),
    mockTranscriptSimulator: asFunction(() => new MockTranscriptSimulator(container)).singleton(),
    intentDetector: asFunction(() => new IntentDetector()).singleton(),
  })
}
