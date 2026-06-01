import * as core from '@actions/core';
import { AISDK } from '@browserstack/ai-sdk';

import { postOrEditPrComment } from './comment';
import { runExperiment } from './run-experiment';


function detectGitHubCiMetadata(): Record<string, unknown> | undefined {
  if (process.env.GITHUB_ACTIONS !== 'true') return undefined;

  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME;
  const refEnv = process.env.GITHUB_REF ?? '';
  const prMatch = refEnv.match(/^refs\/pull\/(\d+)\//);
  const prNumber = prMatch ? parseInt(prMatch[1], 10) : undefined;

  const ci: Record<string, unknown> = { provider: 'github_actions' };
  if (process.env.GITHUB_EVENT_NAME) ci.event = process.env.GITHUB_EVENT_NAME;
  if (repo) ci.repository = repo;
  if (branch) ci.branch = branch;
  if (process.env.GITHUB_SHA) ci.commit_sha = process.env.GITHUB_SHA;
  if (prNumber !== undefined) ci.pr_number = prNumber;
  if (process.env.GITHUB_ACTOR) ci.actor = process.env.GITHUB_ACTOR;
  if (runId) ci.run_id = runId;
  if (process.env.GITHUB_RUN_NUMBER) ci.run_number = process.env.GITHUB_RUN_NUMBER;
  if (repo && runId) {
    ci.run_url = `${serverUrl}/${repo}/actions/runs/${runId}`;
  }
  return ci;
}

export async function run(): Promise<void> {
  try {
    const experimentInput = core.getInput('experiment').trim();
    const failOnRegression = core.getBooleanInput('fail-on-regression');
    const commentOnPr = core.getBooleanInput('comment-on-pr');
    const timeoutSecs = parseInt(core.getInput('timeout'), 10) || 900;

    const publicKey =
      core.getInput('public-key').trim() || process.env.AISDK_PUBLIC_KEY || '';
    const secretKey =
      core.getInput('secret-key').trim() || process.env.AISDK_SECRET_KEY || '';
    const githubToken =
      core.getInput('github-token').trim() || process.env.GITHUB_TOKEN || '';

    if (!experimentInput) {
      core.setFailed("Missing required input 'experiment'.");
      return;
    }
    if (!publicKey || !secretKey) {
      core.setFailed(
        "Missing credentials. Provide 'public-key' and 'secret-key' inputs, " +
          "or set AISDK_PUBLIC_KEY / AISDK_SECRET_KEY env vars."
      );
      return;
    }

    core.info(`BrowserStack AI Evals | experiment="${experimentInput}" fail-on-regression=${failOnRegression}`);

    const client = new AISDK({ publicKey, secretKey });

    const result = await runExperiment(client, {
      experiment: experimentInput,
      metadata: detectGitHubCiMetadata(),
      timeoutSecs,
      onProgress: (msg) => core.info(msg),
    });

    const body = result.comparison?.markdown;

    if (body) {
      if (commentOnPr) {
        if (!githubToken) {
          core.warning('comment-on-pr is true but no github-token provided.');
        } else {
          await postOrEditPrComment(githubToken, body, experimentInput);
        }
      }
      try {
        await core.summary.addRaw(body).write();
      } catch {
        // Job Summary write failed — non-critical.
      }
    }

    if (result.exitCode === 0) {
      core.info('All evaluation thresholds passed.');
      return;
    }
    if (result.exitCode === 1) {
      if (failOnRegression) {
        core.setFailed('BrowserStack AI Evals regressed (at least one threshold breached).');
      } else {
        core.info('Regressed but fail-on-regression=false; not failing the job.');
      }
      return;
    }
    if (result.exitCode === 2) {
      core.setFailed(`Experiment '${experimentInput}' not found. Create it in BrowserStack AI Evals first.`);
      return;
    }

    switch (result.status) {
      case 'FAILED':
        core.setFailed(`Run failed. ${result.error ?? ''} Check: ${result.runUrl ?? '(no URL)'}.`);
        return;
      case 'CREATE_FAILED':
        core.setFailed(`Could not create run. ${result.error ?? ''}`);
        return;
      default:
        core.setFailed(`Failed (exit ${result.exitCode}, status=${result.status}). ${result.error ?? ''}`);
    }
  } catch (e: any) {
    core.setFailed(`Action failed: ${e?.message ?? JSON.stringify(e)}`);
  }
}

if (require.main === module) {
  void run();
}
