/**
 * Orchestration-based Saga for multi-step repository completion writes.
 * Provides compensating actions on failure.
 */
import { v4 as uuidv4 } from 'uuid';
import { publishEvent } from '../events/pubsub';
import { insertOutboxEntry } from '../db/outbox';

export type SagaStep =
  | 'resolve-repo'
  | 'risk-assessment'
  | 'plan-generation'
  | 'approval'
  | 'create-branch'
  | 'open-draft-pr'
  | 'verify-ci'
  | 'bounded-repair'
  | 'rescore'
  | 'complete';

export interface SagaState {
  sagaId: string;
  sessionId: string;
  userId: string;
  repoFullName: string;
  baseSha: string;
  currentStep: SagaStep;
  completedSteps: SagaStep[];
  context: Record<string, unknown>;
  status: 'running' | 'compensating' | 'completed' | 'failed';
}

const compensators: Partial<Record<SagaStep, (state: SagaState) => Promise<void>>> = {
  'create-branch': async (state) => {
    // Compensate: delete the temporary branch if it exists
    console.log(`[Saga ${state.sagaId}] Compensating create-branch for ${state.repoFullName}`);
    // Implementation would call GitHub API to delete refs/heads/...
  },
  'open-draft-pr': async (state) => {
    console.log(`[Saga ${state.sagaId}] Compensating open-draft-pr`);
    // Close the draft PR
  },
};

export async function startCompletionSaga(params: {
  sessionId: string;
  userId: string;
  repoFullName: string;
  baseSha: string;
}): Promise<SagaState> {
  const sagaId = uuidv4();
  const state: SagaState = {
    sagaId,
    ...params,
    currentStep: 'resolve-repo',
    completedSteps: [],
    context: {},
    status: 'running',
  };

  // Persist initial state via outbox for durability
  await insertOutboxEntry({
    aggregate_type: 'completion_saga',
    aggregate_id: sagaId,
    event_type: 'saga.started',
    payload: state as any,
  });

  await publishEvent('saga.started', { sagaId, sessionId: params.sessionId });
  return state;
}

export async function advanceSaga(state: SagaState, nextStep: SagaStep, contextUpdate: Record<string, unknown> = {}): Promise<SagaState> {
  state.completedSteps.push(state.currentStep);
  state.currentStep = nextStep;
  state.context = { ...state.context, ...contextUpdate };

  await insertOutboxEntry({
    aggregate_type: 'completion_saga',
    aggregate_id: state.sagaId,
    event_type: `saga.step.${nextStep}`,
    payload: state as any,
  });

  return state;
}

export async function compensateSaga(state: SagaState, failedStep: SagaStep, error: Error): Promise<void> {
  state.status = 'compensating';
  console.error(`[Saga ${state.sagaId}] Failed at ${failedStep}:`, error.message);

  // Run compensators in reverse order of completed steps
  for (const step of [...state.completedSteps].reverse()) {
    const compensator = compensators[step];
    if (compensator) {
      try {
        await compensator(state);
      } catch (compErr) {
        console.error(`[Saga ${state.sagaId}] Compensator for ${step} failed`, compErr);
      }
    }
  }

  state.status = 'failed';
  await publishEvent('saga.failed', { sagaId: state.sagaId, failedStep, error: error.message });
}

export async function completeSaga(state: SagaState): Promise<void> {
  state.status = 'completed';
  state.currentStep = 'complete';
  await publishEvent('saga.completed', { sagaId: state.sagaId, sessionId: state.sessionId });
}
