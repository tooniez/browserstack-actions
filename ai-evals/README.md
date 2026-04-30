# BrowserStack AI Evals — GitHub Action

Run AI evaluation experiments on every pull request. Compares scores against the previous baseline and reports pass/regression status with a sticky PR comment, Job Summary, and CI metadata tracking.

## How it works

1. Looks up the experiment by name (configured in the BrowserStack AI Evals UI)
2. Triggers a new experiment run with CI metadata (branch, commit, actor, PR number)
3. Waits for the run to complete
4. Fetches a server-computed comparison against the previous baseline run
5. Posts a sticky PR comment and Job Summary with per-evaluator scores, deltas, and threshold status
6. Fails the job if any threshold is breached (configurable)

## Quickstart

```yaml
name: AI Evals
on:
  pull_request:
    paths: ['src/**', 'prompts/**']

jobs:
  evals:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: browserstack/github-actions/ai-evals@v1
        with:
          experiment: refund-bot-eval
          public-key: ${{ secrets.AISDK_PUBLIC_KEY }}
          secret-key: ${{ secrets.AISDK_SECRET_KEY }}
```

## Inputs

| Name | Required | Default | Description |
|---|---|---|---|
| `experiment` | yes | — | Experiment name (configured in the UI). |
| `public-key` | no | — | API public key. Falls back to `AISDK_PUBLIC_KEY` env var. |
| `secret-key` | no | — | API secret key. Falls back to `AISDK_SECRET_KEY` env var. |
| `github-token` | no | `${{ github.token }}` | Token for the PR comment. |
| `fail-on-regression` | no | `true` | Fail the job when a threshold is breached. |
| `comment-on-pr` | no | `true` | Post/edit a sticky PR comment. |
| `timeout` | no | `900` | Max seconds to wait for the run to complete and its comparison scores to be ready. |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | All thresholds passed |
| 1 | At least one threshold breached |
| 2 | Experiment not found |
| 3 | Run failed or timed out |

## Multiple experiments

Each experiment gets its own sticky comment. Run them in parallel or sequence:

```yaml
steps:
  - uses: browserstack/github-actions/ai-evals@v1
    with:
      experiment: refund-bot-eval
      public-key: ${{ secrets.AISDK_PUBLIC_KEY }}
      secret-key: ${{ secrets.AISDK_SECRET_KEY }}

  - uses: browserstack/github-actions/ai-evals@v1
    with:
      experiment: search-ranking-eval
      public-key: ${{ secrets.AISDK_PUBLIC_KEY }}
      secret-key: ${{ secrets.AISDK_SECRET_KEY }}
```