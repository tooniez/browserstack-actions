import { expect } from 'chai';
import sinon from 'sinon';
import { runExperiment } from '../src/run-experiment';

type AnySdk = any;

function makeSdkStub(overrides: Partial<{
  find: sinon.SinonStub;
  create: sinon.SinonStub;
  subscribe: sinon.SinonStub;
  compare: sinon.SinonStub;
}> = {}): AnySdk {
  return {
    experiments: {
      find: overrides.find ?? sinon.stub().resolves({ id: 'exp_abc', name: 'gg' }),
    },
    experimentRuns: {
      create:
        overrides.create ??
        sinon.stub().resolves({
          id: 'run_123',
          projectId: 'proj_1',
          experimentId: 'exp_abc',
          uiUrl: 'https://evals.browserstack.com/project/proj_1/experiments/exp_abc/runs?runId=run_123',
        }),
      subscribe:
        overrides.subscribe ??
        sinon.stub().resolves({ finalStatus: 'COMPLETED', experimentRunData: {} }),
      compare:
        overrides.compare ??
        sinon.stub().resolves({
          status: 'ready',
          markdown: '## PASS',
          current: { runId: 'run_123', runUiUrl: null, rowCount: 11 },
          baseline: null,
          evaluators: [],
          summary: { verdict: 'PASS', failureCount: 0, improvedCount: 0, regressedCount: 0 },
        }),
    },
  };
}

describe('runExperiment', () => {
  afterEach(() => sinon.restore());

  it('returns NOT_FOUND with exitCode 2 when the experiment cannot be resolved by name', async () => {
    const sdk = makeSdkStub({ find: sinon.stub().resolves(null) });
    const result = await runExperiment(sdk, { experiment: 'missing-exp' });

    expect(result.status).to.eq('NOT_FOUND');
    expect(result.exitCode).to.eq(2);
    expect(result.error).to.include("'missing-exp' not found");
  });

  it('returns CREATE_FAILED with exitCode 3 when run creation throws', async () => {
    const sdk = makeSdkStub({
      create: sinon.stub().rejects(new Error('boom')),
    });

    const result = await runExperiment(sdk, { experiment: 'gg' });

    expect(result.status).to.eq('CREATE_FAILED');
    expect(result.exitCode).to.eq(3);
    expect(result.error).to.include('boom');
  });

  it('returns FAILED with exitCode 3 when subscribe reports a non-COMPLETED terminal status', async () => {
    const sdk = makeSdkStub({
      subscribe: sinon.stub().resolves({ finalStatus: 'FAILED', experimentRunData: {} }),
    });

    const result = await runExperiment(sdk, { experiment: 'gg' });

    expect(result.status).to.eq('FAILED');
    expect(result.exitCode).to.eq(3);
    expect(result.runId).to.eq('run_123');
  });

  it('returns FAILED with exitCode 3 when subscribe throws (timeout, network)', async () => {
    const sdk = makeSdkStub({
      subscribe: sinon.stub().rejects(new Error('subscribe timeout')),
    });

    const result = await runExperiment(sdk, { experiment: 'gg' });

    expect(result.status).to.eq('FAILED');
    expect(result.exitCode).to.eq(3);
    expect(result.error).to.include('subscribe timeout');
  });

  it('returns PASS with exitCode 0 when comparison verdict is PASS', async () => {
    const sdk = makeSdkStub();

    const result = await runExperiment(sdk, { experiment: 'gg' });

    expect(result.status).to.eq('PASS');
    expect(result.exitCode).to.eq(0);
    expect(result.comparison?.summary.verdict).to.eq('PASS');
  });

  it('returns REGRESSION with exitCode 1 when comparison verdict is REGRESSION', async () => {
    const sdk = makeSdkStub({
      compare: sinon.stub().resolves({
        status: 'ready',
        markdown: '## REGRESSION',
        current: { runId: 'run_123', runUiUrl: null, rowCount: 11 },
        baseline: { runId: 'run_prev', runUiUrl: null, rowCount: 11 },
        evaluators: [
          {
            name: 'CICD 2',
            currentScore: 0.1,
            baselineScore: 0.5,
            delta: -0.4,
            deltaDirection: 'regression',
            threshold: { value: 0.5, criteria: 'gte' },
            thresholdStatus: 'fail',
          },
        ],
        summary: { verdict: 'REGRESSION', failureCount: 1, improvedCount: 0, regressedCount: 1 },
      }),
    });

    const result = await runExperiment(sdk, { experiment: 'gg' });

    expect(result.status).to.eq('REGRESSION');
    expect(result.exitCode).to.eq(1);
    expect(result.comparison?.summary.failureCount).to.eq(1);
  });

  it('passes the CI metadata through to experimentRuns.create as the 5th argument', async () => {
    const createStub = sinon.stub().resolves({
      id: 'run_123', projectId: 'proj_1', experimentId: 'exp_abc', uiUrl: null,
    });
    const sdk = makeSdkStub({ create: createStub });

    const metadata = { provider: 'github_actions', commit_sha: 'deadbeef' };
    await runExperiment(sdk, { experiment: 'gg', metadata });

    expect(createStub.calledOnce).to.eq(true);
    const args = createStub.firstCall.args;
    expect(args[0]).to.eq('exp_abc');
    expect(args[4]).to.deep.eq(metadata);
  });

  it('invokes onProgress with lifecycle messages', async () => {
    const sdk = makeSdkStub();
    const messages: string[] = [];

    await runExperiment(sdk, {
      experiment: 'gg',
      onProgress: (m) => messages.push(m),
    });

    expect(messages.some((m) => m.includes("Looking up experiment 'gg'"))).to.eq(true);
    expect(messages.some((m) => m.includes('Found experiment'))).to.eq(true);
    expect(messages.some((m) => m.includes('Starting experiment run'))).to.eq(true);
    expect(messages.some((m) => m.includes('Run created'))).to.eq(true);
    expect(messages.some((m) => m.includes('Waiting for run to complete'))).to.eq(true);
    expect(messages.some((m) => m.includes('Fetching comparison'))).to.eq(true);
  });
});
