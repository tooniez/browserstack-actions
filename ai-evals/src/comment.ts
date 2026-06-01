import * as core from '@actions/core';
import * as github from '@actions/github';

function stickyMarker(experiment: string): string {
  return `<!-- browserstack-ai-eval-action:${experiment} -->`;
}

export async function postOrEditPrComment(token: string, body: string, experiment: string): Promise<string | null> {
  const ctx = github.context;
  const pr = ctx.payload.pull_request;
  if (!pr || typeof pr.number !== 'number') {
    core.info('Not a pull_request event; skipping comment.');
    return null;
  }

  const octokit = github.getOctokit(token);
  const { owner, repo } = ctx.repo;
  const marker = stickyMarker(experiment);
  const markedBody = `${marker}\n${body}`;

  try {
    const existing = await octokit.paginate(
      octokit.rest.issues.listComments,
      { owner, repo, issue_number: pr.number, per_page: 100 }
    );
    const sticky = existing.find((c) => (c.body ?? '').includes(marker));
    if (sticky) {
      const updated = await octokit.rest.issues.updateComment({ owner, repo, comment_id: sticky.id, body: markedBody });
      return updated.data.html_url;
    }
  } catch (e: any) {
    core.warning(`Could not search for existing comment (${e?.message ?? JSON.stringify(e)}); creating new one.`);
  }

  try {
    const created = await octokit.rest.issues.createComment({ owner, repo, issue_number: pr.number, body: markedBody });
    return created.data.html_url;
  } catch (e: any) {
    core.warning(`Failed to post PR comment (${e?.message ?? JSON.stringify(e)}). Ensure 'permissions: pull-requests: write'.`);
    return null;
  }
}
