import type { AISDK } from '@browserstack/ai-sdk';
import type {
  ExperimentRunComparisonResponse as ComparisonPayload,
  ExperimentRunComparisonEvaluator as ComparisonEvaluator,
} from '@browserstack/ai-sdk';

export type { ComparisonPayload, ComparisonEvaluator };

const POLL_INTERVAL_SECS = 5;

export interface RunExperimentOptions {
  experiment: string;
  onProgress?: (message: string) => void;
  metadata?: Record<string, unknown>;
  /** Total wait budget (seconds) applied to both subscribe and comparison polling. */
  timeoutSecs?: number;
}

export interface RunResult {
  experiment: string;
  experimentId?: string;
  projectId?: string;
  runId: string;
  runUrl?: string;
  status: 'PASS' | 'REGRESSION' | 'FAILED' | 'NOT_FOUND' | 'CREATE_FAILED';
  comparison?: ComparisonPayload;
  error?: string;
  exitCode: 0 | 1 | 2 | 3;
}

export async function runExperiment(
  sdk: AISDK,
  opts: RunExperimentOptions,
): Promise<RunResult> {
  const log = opts.onProgress ?? (() => {});
  const timeoutSecs = opts.timeoutSecs ?? 900;

  log(`Looking up experiment '${opts.experiment}'...`);
  const experiment = await sdk.experiments.find({ name: opts.experiment });
  if (!experiment?.id) {
    return {
      experiment: opts.experiment, runId: '', status: 'NOT_FOUND',
      error: `Experiment '${opts.experiment}' not found.`, exitCode: 2,
    };
  }
  log(`Found experiment '${opts.experiment}' (id=${experiment.id})`);

  log('Starting experiment run...');
  let run: { id: string; projectId?: string; experimentId?: string; uiUrl?: string | null };
  try {
    run = await sdk.experimentRuns.create(experiment.id, undefined, undefined, undefined, opts.metadata);
  } catch (e: any) {
    return {
      experiment: opts.experiment, experimentId: experiment.id, runId: '',
      status: 'CREATE_FAILED', error: `Failed to create run: ${e?.message ?? JSON.stringify(e)}`, exitCode: 3,
    };
  }

  const runId = run.id;
  const projectId = run.projectId;
  const experimentId = run.experimentId ?? experiment.id;
  const runUrl = run.uiUrl ?? undefined;
  log(`Run created: ${runId}`);
  if (runUrl) log(`${runUrl}`);

  log('Waiting for run to complete...');
  let finalStatus: string;
  try {
    const result = await sdk.experimentRuns.subscribe(runId, timeoutSecs * 1000);
    finalStatus = result.finalStatus;
  } catch (e: any) {
    const errorMsg = e?.message ?? JSON.stringify(e);
    log(`Subscribe failed: ${errorMsg}`);
    return {
      experiment: opts.experiment, experimentId, projectId, runId, runUrl,
      status: 'FAILED', error: `Error waiting for run: ${errorMsg}`, exitCode: 3,
    };
  }
  log(`Run ${finalStatus.toLowerCase()}.`);

  if (finalStatus !== 'COMPLETED') {
    return {
      experiment: opts.experiment, experimentId, projectId, runId, runUrl,
      status: 'FAILED', error: `Run reached ${finalStatus} state.`, exitCode: 3,
    };
  }

  log('Fetching comparison...');
  const maxRetries = Math.ceil(timeoutSecs / POLL_INTERVAL_SECS);
  let comparison: ComparisonPayload | undefined;
  let comparisonAttempts = 0;
  while (!comparison || comparison.status === 'pending') {
    if (comparisonAttempts >= maxRetries) {
      log('Comparison still pending after max retries; returning without comparison.');
      return {
        experiment: opts.experiment, experimentId, projectId, runId, runUrl,
        status: 'FAILED', error: 'Timed out waiting for comparison scores to aggregate.', exitCode: 3,
      };
    }
    try {
      comparison = await sdk.experimentRuns.compare(runId);
    } catch { /* transient — retried automatically */ }
    if (!comparison || comparison.status === 'pending') {
      comparisonAttempts++;
      await new Promise((r) => setTimeout(r,5000));
    }
  }

  return {
    experiment: opts.experiment, experimentId, projectId, runId, runUrl,
    status: comparison.summary.verdict,
    comparison,
    exitCode: comparison.summary.verdict === 'REGRESSION' ? 1 : 0,
  };
}
