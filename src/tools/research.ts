import { searchArxiv } from "../clients/arxiv";
import { type Paper, searchOpenAlex } from "../clients/openalex";
import { type WebResult, searchWeb } from "../clients/websearch";
import { EMBEDDING_MODEL } from "../config";
import type { ToolContext } from "../context";
import { extractPage } from "../extract";
import { fetchPage } from "../fetch";
import { rankBm25 } from "../rank/bm25";
import { chunkMarkdown } from "../rank/chunk";
import { dedupeNearDuplicates } from "../rank/dedup";
import { deriveQueries } from "../rank/queries";
import { rerankByEmbedding } from "../rank/rerank";
import { words } from "../rank/tokenize";
import { ToolError, clampNumber, errorMessage } from "../util";
import type { Tool } from "./types";

type Depth = "quick" | "normal" | "deep";
type SourceFilter = "web" | "academic" | "all";

interface DepthSettings {
  webQueries: number;
  webResultsPerQuery: number;
  pagesToRead: number;
  openAlexResults: number;
  openAlexQueries: number;
  arxivResults: number;
  passages: number;
  passagesPerSource: number;
}

const DEPTHS: Record<Depth, DepthSettings> = {
  quick: {
    webQueries: 1,
    webResultsPerQuery: 6,
    pagesToRead: 3,
    openAlexResults: 5,
    openAlexQueries: 1,
    arxivResults: 5,
    passages: 8,
    passagesPerSource: 2,
  },
  normal: {
    webQueries: 2,
    webResultsPerQuery: 8,
    pagesToRead: 6,
    openAlexResults: 8,
    openAlexQueries: 1,
    arxivResults: 6,
    passages: 12,
    passagesPerSource: 3,
  },
  deep: {
    webQueries: 3,
    webResultsPerQuery: 10,
    pagesToRead: 12,
    openAlexResults: 15,
    openAlexQueries: 2,
    arxivResults: 10,
    passages: 20,
    passagesPerSource: 3,
  },
};

/** How many top BM25 passages the optional embedding stage reorders. */
const RERANK_POOL = 30;
const MAX_PASSAGE_CHARS = 1500;

interface Source {
  kind: "web" | "paper" | "preprint";
  title: string;
  url: string;
  date: string;
  paper?: Paper;
  /** For web sources: whether the page was read or only the search snippet is available. */
  readFully?: boolean;
}

interface Candidate {
  source: Source;
  section: string;
  text: string;
}

function normalizeTitle(title: string): string {
  return words(title).join(" ");
}

function normalizeUrlKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return `${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** Round-robin merge of ranked lists, dropping duplicate URLs. */
function interleave(lists: WebResult[][]): WebResult[] {
  const seen = new Set<string>();
  const out: WebResult[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      const r = list[i];
      if (!r) continue;
      const key = normalizeUrlKey(r.url);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

function paperSource(paper: Paper): Source {
  return {
    kind: paper.preprint ? "preprint" : "paper",
    title: paper.title,
    url: paper.url,
    date: paper.date,
    paper,
  };
}

function formatAuthors(authors: string[]): string {
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} et al.`;
}

function describeSource(source: Source): string[] {
  const lines: string[] = [];
  if (source.kind === "web") {
    lines.push(`Type: web page${source.readFully ? "" : " (search snippet only, page not read)"}`);
  } else {
    const p = source.paper as Paper;
    const type = source.kind === "preprint" ? "preprint, NOT peer reviewed" : "paper";
    const meta = [
      `Type: ${type}`,
      p.date ? `Date: ${p.date}` : "",
      p.venue ? `Venue: ${p.venue}` : "",
      p.citations !== null ? `Citations: ${p.citations.toLocaleString("en-US")}` : "",
      p.doi ? `DOI: ${p.doi}` : "",
    ].filter(Boolean);
    lines.push(meta.join(" · "));
    if (p.authors.length) lines.push(`Authors: ${formatAuthors(p.authors)}`);
    if (p.journalRef) lines.push(`Journal reference: ${p.journalRef}`);
  }
  lines.push(`URL: ${source.url}`);
  return lines;
}

function quote(text: string): string {
  const clipped = text.length > MAX_PASSAGE_CHARS ? `${text.slice(0, MAX_PASSAGE_CHARS).trimEnd()} …` : text;
  return clipped
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

async function research(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const { env, budget } = ctx;
  const question = typeof args.question === "string" ? args.question.trim() : "";
  if (!question) throw new ToolError("`question` must be a non-empty string.");
  const depth: Depth = args.depth === "quick" || args.depth === "deep" ? args.depth : "normal";
  if (args.depth !== undefined && !["quick", "normal", "deep"].includes(String(args.depth))) {
    throw new ToolError("`depth` must be one of quick, normal, deep.");
  }
  const sources: SourceFilter = args.sources === "web" || args.sources === "academic" ? args.sources : "all";
  if (args.sources !== undefined && !["web", "academic", "all"].includes(String(args.sources))) {
    throw new ToolError("`sources` must be one of web, academic, all.");
  }
  const maxChars = clampNumber(args.maxChars, 12_000, 2_000, 50_000);
  const settings = DEPTHS[depth];
  const useWeb = sources !== "academic";
  const useAcademic = sources !== "web";

  const derived = deriveQueries(question);
  const notes: string[] = [];
  const searched: string[] = [];

  // 1. Fan out to all search backends in parallel.
  const webQueries = useWeb ? derived.queries.slice(0, settings.webQueries) : [];
  const openAlexQueries = useAcademic
    ? [derived.keywords.join(" "), derived.natural].filter(Boolean).slice(0, settings.openAlexQueries)
    : [];
  const arxivTerms = derived.keywords.slice(0, 4);

  const [webSettled, openAlexSettled, arxivSettled] = await Promise.all([
    Promise.allSettled(webQueries.map((q) => searchWeb(env, budget, q, settings.webResultsPerQuery))),
    Promise.allSettled(openAlexQueries.map((q) => searchOpenAlex(env, budget, q, settings.openAlexResults))),
    useAcademic && arxivTerms.length
      ? Promise.allSettled([searchArxiv(budget, arxivTerms, settings.arxivResults)])
      : Promise.resolve([] as PromiseSettledResult<Paper[]>[]),
  ]);

  const webLists: WebResult[][] = [];
  let engine = "";
  for (const outcome of webSettled) {
    if (outcome.status === "fulfilled") {
      engine = outcome.value.engine;
      webLists.push(outcome.value.results);
    } else {
      notes.push(`Web search failed: ${errorMessage(outcome.reason)}`);
    }
  }
  const webResults = interleave(webLists);

  const papers: Paper[] = [];
  const seenTitles = new Set<string>();
  const addPapers = (list: Paper[]) => {
    for (const p of list) {
      const key = normalizeTitle(p.title);
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
      papers.push(p);
    }
  };
  let openAlexCount = 0;
  for (const outcome of openAlexSettled) {
    if (outcome.status === "fulfilled") {
      openAlexCount += outcome.value.length;
      addPapers(outcome.value);
    } else {
      notes.push(`OpenAlex failed: ${errorMessage(outcome.reason)}`);
    }
  }
  let arxivCount = 0;
  for (const outcome of arxivSettled) {
    if (outcome.status === "fulfilled") {
      arxivCount = outcome.value.length;
      addPapers(outcome.value);
    } else {
      notes.push(`arXiv failed: ${errorMessage(outcome.reason)}`);
    }
  }

  // 2. Read the top web results within the remaining subrequest budget.
  const paperUrls = new Set(papers.map((p) => normalizeUrlKey(p.url)));
  const webCandidates = webResults.filter((r) => !paperUrls.has(normalizeUrlKey(r.url)));
  const reserveForRerank = env.AI ? 1 : 0;
  const readable = webCandidates.filter((r) => !/\.pdf(?:$|\?)/i.test(r.url));
  const pagesAllowed = Math.max(0, Math.min(settings.pagesToRead, budget.remaining - reserveForRerank));
  if (pagesAllowed < Math.min(settings.pagesToRead, readable.length)) {
    notes.push(
      `Subrequest budget is low: read ${pagesAllowed} of ${Math.min(settings.pagesToRead, readable.length)} planned pages; the rest use search snippets.`,
    );
  }
  const toRead = readable.slice(0, pagesAllowed);
  const pageSettled = await Promise.allSettled(toRead.map((r) => fetchPage(r.url, ctx)));

  // 3. Build passages.
  const candidates: Candidate[] = [];
  const pageByUrl = new Map(toRead.map((r, i) => [r.url, pageSettled[i]]));
  let pagesRead = 0;
  for (const result of webCandidates) {
    const outcome = pageByUrl.get(result.url);
    const source: Source = { kind: "web", title: result.title || result.url, url: result.url, date: "" };
    let chunks: { section: string; text: string }[] = [];
    if (outcome?.status === "fulfilled" && outcome.value.status < 400) {
      const page = outcome.value;
      const markdown = page.isHtml ? extractPage(page.body, page.url, true).markdown : page.body;
      chunks = chunkMarkdown(markdown);
      if (chunks.length) {
        pagesRead++;
        source.readFully = true;
        source.url = page.url;
      }
    }
    if (chunks.length === 0 && result.snippet) {
      chunks = [{ section: "", text: result.snippet }];
    }
    for (const c of chunks) candidates.push({ source, section: c.section, text: c.text });
  }
  for (const paper of papers) {
    const source = paperSource(paper);
    const body = paper.abstract || "(no abstract available)";
    const chunks = paper.abstract ? chunkMarkdown(paper.abstract, { dropBelowWords: 0 }) : [];
    if (chunks.length === 0) chunks.push({ section: "", text: body, wordCount: 0 });
    for (const c of chunks) {
      // The title is part of the ranked text so title-only matches still count.
      candidates.push({ source, section: c.section, text: c.text });
    }
  }

  if (useWeb) {
    searched.push(
      `web (${engine || "search failed"}; ${webQueries.length} quer${webQueries.length === 1 ? "y" : "ies"}, ${pagesRead} page(s) read)`,
    );
  }
  if (useAcademic) searched.push(`OpenAlex (${openAlexCount} works)`, `arXiv (${arxivCount} preprints)`);

  // 4. Rank: BM25 over all passages, then optional embedding rerank of the top pool.
  let ranked = rankBm25(
    derived.natural,
    candidates,
    (c) => (c.source.kind === "web" ? `${c.section} ${c.text}` : `${c.source.title} ${c.text}`),
  ).map((r) => r.item);
  let ranking = "BM25";
  if (env.AI && ranked.length > 1) {
    if (budget.remaining > 0) {
      const pool = ranked.slice(0, RERANK_POOL);
      try {
        const { order } = await rerankByEmbedding(
          env.AI,
          budget,
          derived.natural,
          pool.map((c) => (c.source.kind === "web" ? c.text : `${c.source.title}. ${c.text}`)),
        );
        ranked = [...order.map((i) => pool[i]), ...ranked.slice(RERANK_POOL)];
        ranking = `BM25, then embedding rerank of the top ${pool.length} (${EMBEDDING_MODEL})`;
      } catch (err) {
        notes.push(`Embedding rerank failed, using BM25 only: ${errorMessage(err)}`);
      }
    } else {
      notes.push("Embedding rerank skipped: subrequest budget exhausted.");
    }
  }

  // 5. Remove near-duplicates and select the top passages with a per-source cap.
  const unique = dedupeNearDuplicates(ranked, (c) => c.text);
  const perSource = new Map<Source, number>();
  const selected: Candidate[] = [];
  for (const c of unique) {
    const count = perSource.get(c.source) ?? 0;
    if (count >= settings.passagesPerSource) continue;
    perSource.set(c.source, count + 1);
    selected.push(c);
    if (selected.length >= settings.passages) break;
  }

  // 6. Render grouped by source, in order of each source's best passage, within maxChars.
  const header = [
    `# Research: ${derived.natural}`,
    `Depth: ${depth} · Sources: ${sources}`,
    `Queries: ${derived.queries.map((q) => `[${q}]`).join(" ")}`,
    `Searched: ${searched.join(", ")}`,
    `Ranking: ${ranking}`,
    `Subrequests used: ${budget.used} of ${budget.limit}`,
  ];
  if (notes.length) header.push("", "Notes:", ...notes.map((n) => `- ${n}`));

  if (selected.length === 0) {
    return `${header.join("\n")}\n\nNo relevant passages found. Try rephrasing the question, a different depth, or another sources filter.`;
  }

  const groups: { source: Source; passages: Candidate[] }[] = [];
  for (const c of selected) {
    const group = groups.find((g) => g.source === c.source);
    if (group) group.passages.push(c);
    else groups.push({ source: c.source, passages: [c] });
  }

  let output = header.join("\n");
  let shownPassages = 0;
  let omitted = 0;
  groups.forEach((group, index) => {
    const block = [`\n\n## [${index + 1}] ${group.source.title}`, ...describeSource(group.source)];
    let blockText = block.join("\n");
    for (const p of group.passages) {
      const passageText = `\n\n${p.section ? `Section: ${p.section}\n` : ""}${quote(p.text)}`;
      if (output.length + blockText.length + passageText.length > maxChars) {
        omitted++;
        continue;
      }
      blockText += passageText;
      shownPassages++;
    }
    if (blockText.includes("\n> ") || blockText.endsWith(">")) output += blockText;
  });
  if (omitted) {
    output += `\n\n(${omitted} more relevant passage(s) omitted to stay within ${maxChars} characters; raise maxChars or use scrape on a source to read it in full.)`;
  }
  if (shownPassages === 0) {
    output += "\n\nmaxChars is too small to show any passage.";
  }
  return output;
}

export const researchTool: Tool = {
  definition: {
    name: "research",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      "Research a question across the web and academic literature and return the most relevant passages, ranked and grouped by source with citations. " +
      "Use this first for 'look into X', 'fact-check this claim', 'what is known about X', 'find evidence/studies on X' or any question that needs multiple sources. " +
      "Searches web pages, OpenAlex (papers with venue, citation count, DOI) and arXiv (preprints, marked as not peer reviewed), reads the top pages, and ranks passages against the question. " +
      "Returns condensed excerpts, not whole pages: use `scrape` afterwards to read a promising source in full.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question or claim to research, in natural language.",
        },
        depth: {
          type: "string",
          enum: ["quick", "normal", "deep"],
          description:
            "quick: few sources, fastest. normal (default): balanced. deep: more queries, pages and papers.",
        },
        sources: {
          type: "string",
          enum: ["web", "academic", "all"],
          description: "Which sources to search. Defaults to all.",
        },
        maxChars: {
          type: "number",
          description: "Upper bound for the output size in characters. Defaults to 12000.",
        },
      },
      required: ["question"],
    },
  },
  handler: research,
};
