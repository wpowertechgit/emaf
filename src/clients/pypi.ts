import type { Budget } from "../budget";
import { getJsonOrNull } from "./http";
import type { PackageHit } from "./packages";

interface PyPIProject {
  info?: {
    name?: string;
    summary?: string | null;
    version?: string;
    home_page?: string | null;
    project_url?: string;
    project_urls?: Record<string, string> | null;
  };
  urls?: { upload_time_iso_8601?: string }[];
}

/**
 * PyPI has no official search API, only per-project lookups, so callers pass
 * candidate project names. Returns null when the project does not exist.
 * One subrequest.
 */
export async function getPyPIProject(budget: Budget, name: string): Promise<PackageHit | null> {
  const data = await getJsonOrNull<PyPIProject>(budget, `https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
    service: "PyPI",
    headers: { Accept: "application/json" },
  });
  if (!data?.info?.name) return null;
  const urls = Object.values(data.info.project_urls ?? {});
  const repositoryUrl = [...urls, data.info.home_page ?? ""].find((u) => /github\.com\//i.test(u)) ?? "";
  return {
    ecosystem: "PyPI",
    name: data.info.name,
    description: (data.info.summary ?? "").trim(),
    version: data.info.version ?? "",
    date: (data.urls?.[0]?.upload_time_iso_8601 ?? "").slice(0, 10),
    url: data.info.project_url ?? `https://pypi.org/project/${data.info.name}/`,
    repositoryUrl,
  };
}
