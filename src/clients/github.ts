import type { Budget } from "../budget";
import type { Env } from "../env";
import { getJson, getJsonOrNull, getText } from "./http";

export interface GitHubRepo {
  fullName: string;
  url: string;
  description: string;
  stars: number;
  pushedAt: string;
  archived: boolean;
  license: string;
  openIssues: number;
  language: string;
  homepage: string;
}

interface RawRepo {
  full_name: string;
  html_url: string;
  description?: string | null;
  stargazers_count?: number;
  pushed_at?: string | null;
  archived?: boolean;
  license?: { spdx_id?: string | null; name?: string | null } | null;
  open_issues_count?: number;
  language?: string | null;
  homepage?: string | null;
  fork?: boolean;
}

const API = "https://api.github.com";
const TOKEN_HINT = "Set GITHUB_TOKEN (a read-only token) for higher limits.";

function headers(env: Env, accept = "application/vnd.github+json"): Record<string, string> {
  const h: Record<string, string> = { Accept: accept, "X-GitHub-Api-Version": "2022-11-28" };
  if (env.GITHUB_TOKEN) h.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return h;
}

function toRepo(raw: RawRepo): GitHubRepo {
  const spdx = raw.license?.spdx_id;
  return {
    fullName: raw.full_name,
    url: raw.html_url,
    description: (raw.description ?? "").trim(),
    stars: raw.stargazers_count ?? 0,
    pushedAt: raw.pushed_at ?? "",
    archived: raw.archived === true,
    license: spdx && spdx !== "NOASSERTION" ? spdx : (raw.license?.name ?? ""),
    openIssues: raw.open_issues_count ?? 0,
    language: raw.language ?? "",
    homepage: raw.homepage ?? "",
  };
}

/** Repository search (best match). One subrequest. */
export async function searchRepositories(
  env: Env,
  budget: Budget,
  query: string,
  perPage: number,
): Promise<GitHubRepo[]> {
  const url = new URL(`${API}/search/repositories`);
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", String(perPage));
  const data = await getJson<{ items?: RawRepo[] }>(budget, url.href, {
    service: "GitHub search",
    headers: headers(env),
    rateLimitHint: TOKEN_HINT,
  });
  return (data.items ?? []).filter((r) => !r.fork).map(toRepo);
}

/** Code search; GitHub only allows it with a token. Returns repository full names in result order. */
export async function searchCodeRepositories(
  env: Env,
  budget: Budget,
  query: string,
  perPage: number,
): Promise<string[]> {
  if (!env.GITHUB_TOKEN) return [];
  const url = new URL(`${API}/search/code`);
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", String(perPage));
  const data = await getJson<{ items?: { repository?: { full_name?: string } }[] }>(budget, url.href, {
    service: "GitHub code search",
    headers: headers(env),
  });
  const names: string[] = [];
  for (const item of data.items ?? []) {
    const name = item.repository?.full_name;
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** Repository metadata, or null if it does not exist. One subrequest. */
export async function getRepository(env: Env, budget: Budget, fullName: string): Promise<GitHubRepo | null> {
  const raw = await getJsonOrNull<RawRepo>(budget, `${API}/repos/${fullName}`, {
    service: "GitHub",
    headers: headers(env),
    rateLimitHint: TOKEN_HINT,
  });
  return raw ? toRepo(raw) : null;
}

/** The repository README as raw Markdown, or null if there is none. One subrequest. */
export async function getReadme(env: Env, budget: Budget, fullName: string): Promise<string | null> {
  return getText(budget, `${API}/repos/${fullName}/readme`, {
    service: "GitHub",
    headers: headers(env, "application/vnd.github.raw+json"),
    allowNotFound: true,
    rateLimitHint: TOKEN_HINT,
  });
}

/** Extracts "owner/repo" from a GitHub URL in any of the usual forms, or null. */
export function parseGitHubRepo(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#?].*)?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}
