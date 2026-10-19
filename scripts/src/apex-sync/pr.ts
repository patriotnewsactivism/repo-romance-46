import type { RunCmd } from "./verify.js";
import type { FileChange } from "./types.js";

type FetchLike = typeof fetch;

export const BRANCH_PREFIX = "fix/apex-";

const ghHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
});

/** Auth for git-over-https without writing the token into .git/config or argv logs. */
export function gitAuthEnvArgs(token: string): string[] {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`];
}

export async function countOpenAutoFixPrs(
  repo: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<number> {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100`, {
    headers: ghHeaders(token),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Listing open PRs failed: HTTP ${res.status}`);
  const prs = (await res.json()) as Array<{ head?: { ref?: string } }>;
  return prs.filter((p) => p.head?.ref?.startsWith(BRANCH_PREFIX)).length;
}

export interface OpenPrOptions {
  repo: string;
  token: string;
  cloneDir: string;
  baseBranch: string;
  branch: string;
  title: string;
  body: string;
  changes: FileChange[];
  run: RunCmd;
  fetchImpl?: FetchLike;
}

/** Pushes the verified patch to an isolated branch and opens a DRAFT PR. Never merges. */
export async function openDraftPr(o: OpenPrOptions): Promise<string> {
  if (!o.branch.startsWith(BRANCH_PREFIX)) throw new Error(`Refusing branch outside ${BRANCH_PREFIX}*`);
  const git = async (args: string[], auth = false) => {
    const r = await o.run("git", auth ? [...gitAuthEnvArgs(o.token), ...args] : args, o.cloneDir);
    if (r.code !== 0) throw new Error(`git ${args[0]} failed: ${r.output.replaceAll(o.token, "***").slice(-500)}`);
  };
  await git(["checkout", "-b", o.branch]);
  await git(["add", "--", ...o.changes.map((c) => c.path)]);
  await git(["-c", "user.name=apex-finisher[bot]", "-c", "user.email=apex-finisher@users.noreply.github.com", "commit", "-m", o.title]);
  await git(["push", "origin", `HEAD:refs/heads/${o.branch}`], true);

  const res = await (o.fetchImpl ?? fetch)(`https://api.github.com/repos/${o.repo}/pulls`, {
    method: "POST",
    headers: ghHeaders(o.token),
    body: JSON.stringify({ title: o.title, head: o.branch, base: o.baseBranch, body: o.body, draft: true }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Opening draft PR failed: HTTP ${res.status}`);
  const pr = (await res.json()) as { html_url?: string };
  if (!pr.html_url) throw new Error("PR response missing html_url");
  return pr.html_url;
}
