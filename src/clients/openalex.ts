import type { Budget } from "../budget";
import type { Env } from "../env";
import { getJson } from "./http";

export interface Paper {
  title: string;
  url: string;
  abstract: string;
  /** ISO date (YYYY-MM-DD) or year when known. */
  date: string;
  authors: string[];
  venue: string;
  citations: number | null;
  /** Bare DOI without the https://doi.org/ prefix. */
  doi: string;
  /** True when the work is a preprint (not peer reviewed). */
  preprint: boolean;
  /** Where the record came from. */
  origin: "OpenAlex" | "arXiv";
  /** arXiv journal reference, when the preprint was later published. */
  journalRef?: string;
}

interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  display_name?: string | null;
  title?: string | null;
  publication_date?: string | null;
  publication_year?: number | null;
  type?: string | null;
  cited_by_count?: number | null;
  authorships?: { author?: { display_name?: string | null } | null }[] | null;
  primary_location?: {
    landing_page_url?: string | null;
    version?: string | null;
    source?: { display_name?: string | null; type?: string | null } | null;
  } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
}

const SELECT_FIELDS = [
  "id",
  "doi",
  "display_name",
  "publication_date",
  "publication_year",
  "type",
  "cited_by_count",
  "authorships",
  "primary_location",
  "abstract_inverted_index",
].join(",");

/** OpenAlex ships abstracts as an inverted index (word -> positions). */
export function reconstructAbstract(index: Record<string, number[]> | null | undefined): string {
  if (!index) return "";
  const positioned: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const p of positions) positioned[p] = word;
  }
  return positioned.filter((w) => w !== undefined).join(" ");
}

export function stripDoi(doi: string | null | undefined): string {
  return (doi ?? "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim();
}

function toPaper(work: OpenAlexWork): Paper | null {
  const title = (work.display_name ?? work.title ?? "").trim();
  if (!title) return null;
  const doi = stripDoi(work.doi);
  const source = work.primary_location?.source;
  const preprint =
    work.type === "preprint" ||
    source?.type === "repository" ||
    work.primary_location?.version === "submittedVersion";
  return {
    title,
    url: doi ? `https://doi.org/${doi}` : (work.primary_location?.landing_page_url ?? work.id ?? ""),
    abstract: reconstructAbstract(work.abstract_inverted_index),
    date: work.publication_date ?? (work.publication_year ? String(work.publication_year) : ""),
    authors: (work.authorships ?? [])
      .map((a) => a.author?.display_name ?? "")
      .filter(Boolean),
    venue: source?.display_name ?? "",
    citations: typeof work.cited_by_count === "number" ? work.cited_by_count : null,
    doi,
    preprint,
    origin: "OpenAlex",
  };
}

/** Full-text works search (title, abstract, fulltext, keywords). One subrequest. */
export async function searchOpenAlex(env: Env, budget: Budget, query: string, perPage: number): Promise<Paper[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("select", SELECT_FIELDS);
  if (env.OPENALEX_API_KEY) url.searchParams.set("api_key", env.OPENALEX_API_KEY);
  if (env.OPENALEX_MAILTO) url.searchParams.set("mailto", env.OPENALEX_MAILTO);
  const data = await getJson<{ results?: OpenAlexWork[] }>(budget, url.href, {
    service: "OpenAlex",
    headers: { Accept: "application/json" },
    rateLimitHint: "Set OPENALEX_API_KEY for a higher daily budget.",
  });
  return (data.results ?? []).map(toPaper).filter((p): p is Paper => p !== null);
}
