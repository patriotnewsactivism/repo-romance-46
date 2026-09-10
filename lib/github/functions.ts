/**
 * Idempotent GitHub operations with explicit checks and Idempotency-Key support.
 */
import { Octokit } from '@octokit/rest';
import { v4 as uuidv4 } from 'uuid';

export function createOctokit(token: string) {
  return new Octokit({ auth: token });
}

export async function createBranchIdempotent(
  octokit: Octokit,
  owner: string,
  repo: string,
  branchName: string,
  sha: string
): Promise<{ created: boolean; ref: string }> {
  const ref = `refs/heads/${branchName}`;
  try {
    // Check if already exists
    await octokit.git.getRef({ owner, repo, ref: `heads/${branchName}` });
    return { created: false, ref };
  } catch (err: any) {
    if (err.status !== 404) throw err;
  }

  await octokit.git.createRef({
    owner,
    repo,
    ref,
    sha,
    headers: { 'Idempotency-Key': uuidv4() },
  });
  return { created: true, ref };
}

export async function openDraftPrIdempotent(
  octokit: Octokit,
  owner: string,
  repo: string,
  head: string,
  base: string,
  title: string,
  body: string
): Promise<{ number: number; created: boolean }> {
  // Search for existing open PR from this head
  const { data: prs } = await octokit.pulls.list({
    owner,
    repo,
    head: `${owner}:${head}`,
    state: 'open',
  });

  if (prs.length > 0) {
    return { number: prs[0].number, created: false };
  }

  const { data } = await octokit.pulls.create({
    owner,
    repo,
    title,
    head,
    base,
    body,
    draft: true,
  });
  return { number: data.number, created: true };
}
