import type { Budget } from "../budget";
import { getJson } from "./http";
import type { PackageHit } from "./packages";

interface NpmSearchResponse {
  objects?: {
    package?: {
      name?: string;
      description?: string;
      version?: string;
      date?: string;
      links?: { npm?: string; repository?: string; homepage?: string };
    };
  }[];
}

/** npm registry search. One subrequest. */
export async function searchNpm(budget: Budget, text: string, size: number): Promise<PackageHit[]> {
  const url = new URL("https://registry.npmjs.org/-/v1/search");
  url.searchParams.set("text", text);
  url.searchParams.set("size", String(size));
  const data = await getJson<NpmSearchResponse>(budget, url.href, {
    service: "npm registry",
    headers: { Accept: "application/json" },
  });
  return (data.objects ?? []).flatMap((o) => {
    const p = o.package;
    if (!p?.name) return [];
    return [
      {
        ecosystem: "npm" as const,
        name: p.name,
        description: (p.description ?? "").trim(),
        version: p.version ?? "",
        date: (p.date ?? "").slice(0, 10),
        url: p.links?.npm ?? `https://www.npmjs.com/package/${p.name}`,
        repositoryUrl: p.links?.repository ?? "",
      },
    ];
  });
}
