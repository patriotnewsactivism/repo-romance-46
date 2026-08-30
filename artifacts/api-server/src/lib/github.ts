/**
 * GitHub REST helpers.
 *
 * Two things this module exists to prevent:
 *
 *  - Unvalidated interpolation. The old code built request paths as
 *    `/repos/${data.repo}/...` from a caller-supplied string, so a `repo` of
 *    `../../orgs/acme/repos` addressed a completely different endpoint with the
 *    user's token attached. Every identifier is validated before it reaches a
 *    URL, and path segments are encoded.
 *  - Partial writes. The old finisher committed each file separately through
 *    the contents API, so a failure halfway through left the branch in a state
 *    nobody approved. `createAtomicCommit` builds one tree and one commit.
 */

const REPO_SLUG = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const BRANCH_NAME = /^[A-Za-z0-9._\-/]{1,255}$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;

export function assertRepoSlug(repo: string): string {
  if (!REPO_SLUG.test(repo) || repo.includes("..")) {
    throw Object.assign(new Error(`Invalid repository "${repo}" — expected owner/name`), { status: 400 });
  }
  return repo;
}

export function assertBranchName(branch: string): string {
  if (!BRANCH_NAME.test(branch) || branch.includes("..") || branch.startsWith("/") || branch.endsWith("/")) {
    throw Object.assign(new Error(`Invalid branch name "${branch}"`), { status: 400 });
  }
  return branch;
}

export function assertCommitSha(sha: string): string {
  if (!COMMIT_SHA.test(sha)) {
    throw Object.assign(new Error(`Invalid commit sha "${sha}"`), { status: 400 });
  }
  return sha;
}

/** Encode each segment so a path can never escape the endpoint it names. */
export function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "repo-romance",
  };
}

export async function ghFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  if (!path.startsWith("/")) throw new Error(`GitHub path must be absolute, got ${path}`);
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { ...ghHeaders(token), ...(init?.headers ?? {}) },
  });
}

async function ghJson<T>(token: string, path: string, init: RequestInit | undefined, context: string): Promise<T> {
  const res = await ghFetch(token, path, init);
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw Object.assign(new Error(`${context} failed: ${res.status} ${detail}`), {
      status: res.status === 404 || res.status === 403 ? 400 : 502,
    });
  }
  return (await res.json()) as T;
}

export interface RepoMetadata {
  default_branch: string;
  description: string | null;
  language: string | null;
  topics: string[];
  stargazers_count: number;
  open_issues_count: number;
  license: unknown;
  homepage: string | null;
  private: boolean;
}

export async function getRepo(token: string, repo: string): Promise<RepoMetadata> {
  assertRepoSlug(repo);
  return ghJson<RepoMetadata>(token, `/repos/${repo}`, undefined, `Fetching ${repo}`);
}

export interface TreeNode {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  /** Git file mode, e.g. 100644, 100755 (executable), 120000 (symlink). */
  mode?: string;
}

export async function getRepoTree(token: string, repo: string, ref: string): Promise<TreeNode[]> {
  assertRepoSlug(repo);
  assertBranchName(ref);
  const json = await ghJson<{ tree: TreeNode[]; truncated?: boolean }>(
    token,
    `/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    undefined,
    `Fetching tree for ${repo}`,
  );
  return json.tree.filter((node) => node.type === "blob");
}

export async function getFileContent(token: string, repo: string, path: string, ref?: string): Promise<string | null> {
  assertRepoSlug(repo);
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await ghFetch(token, `/repos/${repo}/contents/${encodePath(path)}${query}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { content?: string; encoding?: string };
  if (!json.content || json.encoding !== "base64") return null;
  return Buffer.from(json.content, "base64").toString("utf-8");
}

export async function getBranchHeadSha(token: string, repo: string, branch: string): Promise<string> {
  assertRepoSlug(repo);
  assertBranchName(branch);
  const ref = await ghJson<{ object: { sha: string } }>(
    token,
    `/repos/${repo}/git/ref/heads/${encodePath(branch)}`,
    undefined,
    `Reading ${branch} of ${repo}`,
  );
  return ref.object.sha;
}

export interface AtomicChange {
  path: string;
  /** `undefined` deletes the path. */
  content?: string;
}

/** Modes this helper is willing to write. */
const REGULAR_FILE = "100644";
const EXECUTABLE_FILE = "100755";

export type WritableTreeMode = typeof REGULAR_FILE | typeof EXECUTABLE_FILE;

/**
 * Which mode a tree entry should carry.
 *
 * A path that already exists keeps its mode, so modifying an executable script
 * does not quietly drop its executable bit. A path Git represents as something
 * other than a regular or executable file — a symlink (120000) or a submodule
 * (160000) — is refused rather than rewritten as a plain blob, because that
 * would be a behavioral change nobody reviewed.
 */
export function resolveTreeMode(path: string, existingMode: string | undefined): WritableTreeMode {
  if (existingMode === undefined) return REGULAR_FILE;
  if (existingMode === REGULAR_FILE || existingMode === EXECUTABLE_FILE) return existingMode;
  throw Object.assign(new Error(`Refusing to rewrite special Git object ${path} (mode ${existingMode})`), {
    status: 400,
  });
}

/**
 * Write every change as a single commit on a new branch.
 *
 * Uses the Git Data API (blobs → tree → commit → ref) rather than the contents
 * API so the branch either carries the whole approved change set or is never
 * created at all.
 */
export async function createAtomicCommit(
  token: string,
  repo: string,
  params: { baseSha: string; newBranch: string; message: string; changes: AtomicChange[] },
): Promise<{ commitSha: string; branch: string }> {
  assertRepoSlug(repo);
  assertBranchName(params.newBranch);
  assertCommitSha(params.baseSha);
  if (params.changes.length === 0) throw Object.assign(new Error("No changes to commit"), { status: 400 });

  const baseCommit = await ghJson<{ tree: { sha: string } }>(
    token,
    `/repos/${repo}/git/commits/${params.baseSha}`,
    undefined,
    "Reading base commit",
  );

  // See `resolveTreeMode`: existing paths keep the mode they already have.
  const existingModes = new Map(
    (await getRepoTree(token, repo, params.baseSha)).map((node) => [node.path, node.mode]),
  );

  const treeEntries: { path: string; mode: WritableTreeMode; type: "blob"; sha: string | null }[] = [];
  for (const change of params.changes) {
    const mode = resolveTreeMode(change.path, existingModes.get(change.path));
    if (change.content === undefined) {
      treeEntries.push({ path: change.path, mode, type: "blob", sha: null });
      continue;
    }
    const blob = await ghJson<{ sha: string }>(
      token,
      `/repos/${repo}/git/blobs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: Buffer.from(change.content, "utf8").toString("base64"), encoding: "base64" }),
      },
      `Creating blob for ${change.path}`,
    );
    treeEntries.push({ path: change.path, mode, type: "blob", sha: blob.sha });
  }

  const tree = await ghJson<{ sha: string }>(
    token,
    `/repos/${repo}/git/trees`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeEntries }),
    },
    "Creating tree",
  );

  const commit = await ghJson<{ sha: string }>(
    token,
    `/repos/${repo}/git/commits`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: params.message, tree: tree.sha, parents: [params.baseSha] }),
    },
    "Creating commit",
  );

  await ghJson(
    token,
    `/repos/${repo}/git/refs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${params.newBranch}`, sha: commit.sha }),
    },
    `Creating branch ${params.newBranch}`,
  );

  return { commitSha: commit.sha, branch: params.newBranch };
}

export async function createDraftPullRequest(
  token: string,
  repo: string,
  params: { head: string; base: string; title: string; body: string },
): Promise<{ number: number; html_url: string }> {
  assertRepoSlug(repo);
  assertBranchName(params.head);
  assertBranchName(params.base);
  return ghJson<{ number: number; html_url: string }>(
    token,
    `/repos/${repo}/pulls`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Draft by default: an autonomous change is a proposal, not a merge.
      body: JSON.stringify({ title: params.title, head: params.head, base: params.base, body: params.body, draft: true }),
    },
    "Opening pull request",
  );
}
