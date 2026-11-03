import {
  type GitHubRepo,
  getReadme,
  getRepository,
  parseGitHubRepo,
  searchCodeRepositories,
  searchRepositories,
} from "../clients/github";
import { searchNpm } from "../clients/npm";
import type { PackageHit } from "../clients/packages";
import { getPyPIProject } from "../clients/pypi";
import type { ToolContext } from "../context";
import { cleanMarkdownImages } from "../images";
import { rankBm25 } from "../rank/bm25";
import { chunkMarkdown } from "../rank/chunk";
import { deriveQueries } from "../rank/queries";
import { ToolError, clampNumber, errorMessage } from "../util";
import type { Tool } from "./types";

const UNMAINTAINED_AFTER_MS = 365 * 24 * 60 * 60 * 1000;
const EXCERPT_CHARS = 700;
/** Repository lookups for packages and code-search hits that repository search missed. */
const MAX_EXTRA_REPO_LOOKUPS = 4;
const MAX_PYPI_LOOKUPS = 3;

interface Ecosystem {
  /** GitHub `language:` qualifier, if any. */
  githubLanguage: string;
  npm: boolean;
  pypi: boolean;
  label: string;
}

function resolveEcosystem(filter: string): Ecosystem {
  const f = filter.trim().toLowerCase();
  if (!f) return { githubLanguage: "", npm: true, pypi: true, label: "any" };
  if (["js", "javascript", "node", "nodejs", "node.js", "npm"].includes(f)) {
    return { githubLanguage: f === "node" || f === "nodejs" || f === "node.js" || f === "npm" ? "" : "javascript", npm: true, pypi: false, label: filter };
  }
  if (["ts", "typescript"].includes(f)) return { githubLanguage: "typescript", npm: true, pypi: false, label: filter };
  if (["py", "python", "pypi"].includes(f)) return { githubLanguage: "python", npm: false, pypi: true, label: filter };
  return { githubLanguage: f.replace(/[^a-z0-9#+.-]/g, ""), npm: false, pypi: false, label: filter };
}

interface Project {
  key: string;
  repo?: GitHubRepo;
  packages: PackageHit[];
  /** Position in the combined search order (lower is better). */
  order: number;
  excerpt?: { section: string; text: string; score: number };
  readmeStatus?: "read" | "missing" | "failed" | "skipped";
}

function pypiNameGuesses(keywords: string[]): string[] {
  const k = keywords.map((w) => w.replace(/[^a-z0-9]/g, "")).filter(Boolean);
  const guesses = [k.slice(0, 2).join("-"), k.slice(0, 3).join("-"), k.slice(0, 2).join(""), k[0] ?? ""];
  return Array.from(new Set(guesses.filter((g) => g.length > 2))).slice(0, MAX_PYPI_LOOKUPS);
}

function excerpt(text: string): string {
  const flat = text.replace(/\n{2,}/g, "\n").trim();
  const clipped = flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS).trimEnd()} …` : flat;
  return clipped
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

function renderProject(project: Project, index: number, now: number): string {
  const lines: string[] = [];
  const repo = project.repo;
  if (repo) {
    lines.push(`## ${index + 1}. ${repo.fullName} (${repo.stars.toLocaleString("en-US")} stars)`);
    lines.push(`URL: ${repo.url}`);
    if (repo.description) lines.push(`Description: ${repo.description}`);
    const pushed = repo.pushedAt ? repo.pushedAt.slice(0, 10) : "unknown";
    const stale = repo.pushedAt && now - Date.parse(repo.pushedAt) > UNMAINTAINED_AFTER_MS;
    const facts = [
      `Last push: ${pushed}${stale ? " (POSSIBLY UNMAINTAINED: no push in 12+ months)" : ""}`,
      `Archived: ${repo.archived ? "YES" : "no"}`,
      `License: ${repo.license || "none"}`,
      `Open issues: ${repo.openIssues.toLocaleString("en-US")}`,
    ];
    if (repo.language) facts.push(`Language: ${repo.language}`);
    lines.push(facts.join(" · "));
  } else {
    const pkg = project.packages[0];
    lines.push(`## ${index + 1}. ${pkg.name} (${pkg.ecosystem} package, no GitHub repository found)`);
    lines.push(`URL: ${pkg.url}`);
    if (pkg.description) lines.push(`Description: ${pkg.description}`);
  }
  if (project.packages.length) {
    lines.push(
      `Packages: ${project.packages
        .map((p) => `${p.ecosystem} ${p.name}${p.version ? `@${p.version}` : ""}${p.date ? ` (released ${p.date})` : ""}`)
        .join(", ")}`,
    );
  }
  if (project.excerpt) {
    lines.push(`Most relevant README passage${project.excerpt.section ? ` (section: ${project.excerpt.section})` : ""}:`);
    lines.push(excerpt(project.excerpt.text));
  } else if (project.readmeStatus === "read") {
    lines.push("README does not mention the described feature in matching terms.");
  } else if (project.readmeStatus === "failed") {
    lines.push("README could not be fetched.");
  } else if (project.readmeStatus === "skipped") {
    lines.push("README not checked (subrequest budget).");
  }
  return lines.join("\n");
}

async function priorArt(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const { env, budget } = ctx;
  const description = typeof args.description === "string" ? args.description.trim() : "";
  if (!description) throw new ToolError("`description` must be a non-empty string.");
  const ecosystem = resolveEcosystem(typeof args.language === "string" ? args.language : "");
  const limit = clampNumber(args.limit, 8, 1, 15);
  const maxChars = clampNumber(args.maxChars, 12_000, 2_000, 50_000);

  const derived = deriveQueries(description, 6);
  if (derived.keywords.length === 0) {
    throw new ToolError("The description has no searchable keywords. Describe the feature in a few more words.");
  }
  const notes: string[] = [];
  const searched: string[] = [];
  const languageQualifier = ecosystem.githubLanguage ? ` language:${ecosystem.githubLanguage}` : "";

  // Most specific terms first (names, acronyms), generic words like "tool" last.
  const terms = derived.keyTerms;
  const scope = ` in:name,description,readme${languageQualifier}`;
  const repoQueries = Array.from(
    new Set([
      `${terms.slice(0, 4).join(" ")}${scope}`,
      `${derived.phrases[0] ? `"${derived.phrases[0]}"` : terms.slice(0, 2).join(" ")}${scope}`,
      // Two or more names together ("obsidian rag") are often the best query of all.
      ...(derived.names.length >= 2 ? [`${derived.names.slice(0, 3).join(" ")}${scope}`] : []),
    ]),
  );
  const codeTerms = derived.names.length >= 2 ? derived.names.slice(0, 3) : terms.slice(0, 3);
  // Package names are usually adjacent words of the description ("rate-limit"), so keep the original order.
  const pypiNames = ecosystem.pypi ? pypiNameGuesses(derived.keywords) : [];

  // 1. Search everything in parallel.
  const [repoSettled, codeSettled, npmSettled, pypiSettled] = await Promise.all([
    Promise.allSettled(repoQueries.map((q) => searchRepositories(env, budget, q, 10))),
    env.GITHUB_TOKEN
      ? searchCodeRepositories(env, budget, `${codeTerms.join(" ")}${languageQualifier}`, 20).then(
          (v) => ({ ok: true as const, v }),
          (e: unknown) => ({ ok: false as const, e }),
        )
      : Promise.resolve(null),
    ecosystem.npm
      ? searchNpm(budget, terms.slice(0, 5).join(" "), 10).then(
          (v) => ({ ok: true as const, v }),
          (e: unknown) => ({ ok: false as const, e }),
        )
      : Promise.resolve(null),
    Promise.allSettled(pypiNames.map((n) => getPyPIProject(budget, n))),
  ]);

  const projects = new Map<string, Project>();
  let order = 0;
  const addRepo = (repo: GitHubRepo) => {
    const key = repo.fullName.toLowerCase();
    const existing = projects.get(key);
    if (existing) {
      existing.repo ??= repo;
      return existing;
    }
    const project: Project = { key, repo, packages: [], order: order++ };
    projects.set(key, project);
    return project;
  };

  // Repository search results, interleaved across the queries.
  const repoLists: GitHubRepo[][] = [];
  for (const outcome of repoSettled) {
    if (outcome.status === "fulfilled") repoLists.push(outcome.value);
    else notes.push(`GitHub repository search failed: ${errorMessage(outcome.reason)}`);
  }
  const longest = Math.max(0, ...repoLists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const list of repoLists) if (list[i]) addRepo(list[i]);
  searched.push(`GitHub repositories (${projects.size})`);

  // Repositories that still need a metadata lookup, in priority order.
  const pendingRepos: { fullName: string; pkg?: PackageHit }[] = [];

  if (codeSettled === null) {
    searched.push("GitHub code search (skipped: requires GITHUB_TOKEN)");
  } else if (codeSettled.ok) {
    searched.push(`GitHub code search (${codeSettled.v.length} repositories)`);
    for (const name of codeSettled.v.slice(0, 5)) {
      if (!projects.has(name.toLowerCase())) pendingRepos.push({ fullName: name });
    }
  } else {
    notes.push(`GitHub code search failed: ${errorMessage(codeSettled.e)}`);
  }

  const packages: PackageHit[] = [];
  if (npmSettled === null) {
    if (!ecosystem.npm) searched.push("npm (skipped for this language)");
  } else if (npmSettled.ok) {
    searched.push(`npm (${npmSettled.v.length} packages)`);
    packages.push(...npmSettled.v);
  } else {
    notes.push(`npm search failed: ${errorMessage(npmSettled.e)}`);
  }

  if (ecosystem.pypi) {
    const found: string[] = [];
    pypiSettled.forEach((outcome) => {
      if (outcome.status === "fulfilled" && outcome.value) {
        found.push(outcome.value.name);
        packages.push(outcome.value);
      } else if (outcome.status === "rejected") {
        notes.push(`PyPI lookup failed: ${errorMessage(outcome.reason)}`);
      }
    });
    searched.push(
      `PyPI (exact-name lookups for ${pypiNames.join(", ") || "none"}: ${found.length ? `found ${found.join(", ")}` : "none found"}; PyPI has no search API)`,
    );
  } else {
    searched.push("PyPI (skipped for this language)");
  }

  const packageOnly: PackageHit[] = [];
  for (const pkg of packages) {
    const fullName = parseGitHubRepo(pkg.repositoryUrl);
    if (!fullName) {
      packageOnly.push(pkg);
      continue;
    }
    const existing = projects.get(fullName.toLowerCase());
    if (existing) existing.packages.push(pkg);
    else pendingRepos.push({ fullName, pkg });
  }

  // 2. Look up repositories found through packages and code search (deduplicated, in priority order).
  const pendingByName = new Map<string, { fullName: string; pkgs: PackageHit[] }>();
  for (const { fullName, pkg } of pendingRepos) {
    const key = fullName.toLowerCase();
    const entry = pendingByName.get(key) ?? { fullName, pkgs: [] };
    if (pkg) entry.pkgs.push(pkg);
    pendingByName.set(key, entry);
  }
  const pending = Array.from(pendingByName.values());
  // Keep enough budget for the README fetches that follow.
  const lookupCount = Math.min(MAX_EXTRA_REPO_LOOKUPS, pending.length, Math.max(0, budget.remaining - limit));
  const lookups = pending.slice(0, lookupCount);
  const lookupSettled = await Promise.allSettled(lookups.map((p) => getRepository(env, budget, p.fullName)));
  lookupSettled.forEach((outcome, i) => {
    const { fullName, pkgs } = lookups[i];
    if (outcome.status === "fulfilled" && outcome.value) {
      addRepo(outcome.value).packages.push(...pkgs);
    } else {
      packageOnly.push(...pkgs);
    }
    if (outcome.status === "rejected") notes.push(`GitHub lookup of ${fullName} failed: ${errorMessage(outcome.reason)}`);
  });
  for (const rest of pending.slice(lookupCount)) packageOnly.push(...rest.pkgs);
  for (const pkg of packageOnly) {
    const key = `${pkg.ecosystem}:${pkg.name}`.toLowerCase();
    if (!projects.has(key)) projects.set(key, { key, packages: [pkg], order: order++ });
  }

  // 3. Fetch READMEs of the top candidates and rank their passages against the description.
  const ordered = Array.from(projects.values()).sort((a, b) => a.order - b.order);
  const withRepo = ordered.filter((p) => p.repo).slice(0, limit + 2);
  const readmeCount = Math.min(withRepo.length, budget.remaining);
  if (readmeCount < withRepo.length) {
    notes.push(`Subrequest budget is low: checked ${readmeCount} of ${withRepo.length} READMEs.`);
  }
  const readmeTargets = withRepo.slice(0, readmeCount);
  for (const p of withRepo.slice(readmeCount)) p.readmeStatus = "skipped";
  const readmeSettled = await Promise.allSettled(
    readmeTargets.map((p) => getReadme(env, budget, (p.repo as GitHubRepo).fullName)),
  );

  const passages: { project: Project; section: string; text: string }[] = [];
  readmeSettled.forEach((outcome, i) => {
    const project = readmeTargets[i];
    if (outcome.status === "rejected") {
      project.readmeStatus = "failed";
      notes.push(`README of ${project.repo?.fullName} failed: ${errorMessage(outcome.reason)}`);
      return;
    }
    if (!outcome.value) {
      project.readmeStatus = "missing";
      return;
    }
    project.readmeStatus = "read";
    for (const c of chunkMarkdown(cleanMarkdownImages(outcome.value), { minWords: 60, maxWords: 180, dropBelowWords: 8 })) {
      passages.push({ project, section: c.section, text: c.text });
    }
  });
  for (const r of rankBm25(description, passages, (p) => `${p.section} ${p.text}`)) {
    if (!r.item.project.excerpt) {
      r.item.project.excerpt = { section: r.item.section, text: r.item.text, score: r.score };
    }
  }

  // Final order: README relevance first, search order as tie-breaker and for projects without a README match.
  const maxScore = Math.max(0, ...ordered.map((p) => p.excerpt?.score ?? 0)) || 1;
  const total = ordered.length || 1;
  const finalScore = (p: Project) => 0.7 * ((p.excerpt?.score ?? 0) / maxScore) + 0.3 * (1 - p.order / total);
  const ranked = ordered.sort((a, b) => finalScore(b) - finalScore(a)).slice(0, limit);

  const header = [
    `# Prior art: ${derived.natural}`,
    `Language/ecosystem: ${ecosystem.label}`,
    `Queries: ${repoQueries.map((q) => `[${q}]`).join(" ")}`,
    `Searched: ${searched.join("; ")}`,
    `Subrequests used: ${budget.used} of ${budget.limit}`,
  ];
  if (!env.GITHUB_TOKEN) {
    header.push("Note: no GITHUB_TOKEN configured; GitHub rate limits are low and code search is disabled.");
  }
  if (notes.length) header.push("", "Notes:", ...notes.map((n) => `- ${n}`));

  if (ranked.length === 0) {
    return `${header.join("\n")}\n\nNo existing projects found. Try describing the feature with different or more general terms.`;
  }

  const now = Date.now();
  let output = header.join("\n");
  let omitted = 0;
  ranked.forEach((project, i) => {
    const block = `\n\n${renderProject(project, i, now)}`;
    if (output.length + block.length > maxChars) omitted++;
    else output += block;
  });
  if (omitted) output += `\n\n(${omitted} more project(s) omitted to stay within ${maxChars} characters.)`;
  return output;
}

export const priorArtTool: Tool = {
  definition: {
    name: "prior_art",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      "Find existing open-source projects and packages that already implement a feature or idea. " +
      "Use this for 'does something like this already exist', 'is there a library/package/tool for X', or before proposing to build something new. " +
      "Searches GitHub repositories (and GitHub code search when a token is configured), npm and PyPI, then reads each candidate's README and quotes the passage most relevant to the description. " +
      "Returns per project: stars, last push date, archived flag, license, open issues, and flags projects with no push in 12+ months as possibly unmaintained.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "What the feature or project does, in a sentence or two.",
        },
        language: {
          type: "string",
          description:
            "Optional language or ecosystem filter, for example python, typescript, javascript, rust, go. Python enables PyPI, JavaScript/TypeScript enable npm; omit to search all.",
        },
        limit: { type: "number", description: "Maximum projects to return. Defaults to 8, maximum 15." },
        maxChars: {
          type: "number",
          description: "Upper bound for the output size in characters. Defaults to 12000.",
        },
      },
      required: ["description"],
    },
  },
  handler: priorArt,
};
