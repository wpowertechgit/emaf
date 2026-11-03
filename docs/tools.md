# Tools

Claude picks tools by their descriptions: `research` for questions and claims, `prior_art` for build decisions, `scrape`, `batch_scrape`, `crawl` and `map` for specific URLs and sites.

## research

Answers a question with ranked passages from several sources.

1. Derives 2 to 4 search queries from the question (the question, a keyword variant, quoted key phrases).
2. Searches the web, [OpenAlex](https://openalex.org) and [arXiv](https://arxiv.org) in parallel.
3. Reads the top web pages within the request budget. PDF results use their search snippet.
4. Splits everything into passages of 150 to 300 words, ranks them with BM25, optionally reranks the top 30 by embeddings, and drops near-duplicates.
5. Returns the best passages grouped by source. Papers include authors, venue, citation count and DOI. Preprints are marked as not peer reviewed.

| Parameter | Default | |
| --- | --- | --- |
| `question` | required | The question or claim. |
| `depth` | `normal` | `quick`, `normal` or `deep`: how many queries, pages and papers. |
| `sources` | `all` | `web`, `academic` or `all`. |
| `maxChars` | 12000 | Output size limit. |

## prior_art

Finds existing open-source projects and packages for a feature.

Searches GitHub repositories (and GitHub code search when `GITHUB_TOKEN` is set), npm and PyPI. Reads each candidate's README and quotes the passage most relevant to the description. Projects are ranked by that relevance. Each result lists stars, last push, archived flag, license and open issues; no push in 12 months is flagged as possibly unmaintained.

| Parameter | Default | |
| --- | --- | --- |
| `description` | required | What the feature does, in a sentence or two. |
| `language` | any | For example `python`, `typescript`, `rust`. Python enables PyPI, JavaScript and TypeScript enable npm. |
| `limit` | 8 | Projects to return, up to 15. |
| `maxChars` | 12000 | Output size limit. |

## scrape

Reads one URL. HTML is reduced to the main content and converted to Markdown with tables, fenced code blocks (language kept) and absolute links. Badge images are dropped and signed image URLs shortened. PDFs up to 10 MB become one Markdown section per page.

| Parameter | Default | |
| --- | --- | --- |
| `url` | required | |
| `format` | `markdown` | `markdown`, `text` or `html`. |
| `onlyMainContent` | `true` | Strip navigation, headers, footers and sidebars. |
| `includeLinks` | `false` | Append every link on the page. |
| `render` | `false` | Load the page in a headless browser first. Needs `BROWSER`. |
| `maxChars` | 50000 | Output size limit. |
| `cacheTtl` | 3600 | With `CACHE`: maximum age of a cached copy in seconds. `0` fetches fresh. |

## batch_scrape

Reads up to 20 URLs, possibly from different sites. Duplicates are fetched once. Failures are listed per URL; URLs beyond the request budget are listed as skipped.

| Parameter | Default | |
| --- | --- | --- |
| `urls` | required | Up to 20. |
| `format` | `markdown` | `markdown` or `text`. |
| `onlyMainContent` | `true` | |
| `maxCharsPerPage` | 8000 | |
| `maxChars` | 40000 | Output size limit. |

## crawl

Breadth-first crawl of one host, Markdown per page.

| Parameter | Default | |
| --- | --- | --- |
| `url` | required | Start page. |
| `limit` | 10 | Pages, up to 40. |
| `maxDepth` | 2 | Link depth from the start page. |
| `pathPrefix` | none | Only follow paths starting with this, for example `/docs/`. |
| `maxCharsPerPage` | 8000 | |
| `respectRobots` | `false` | Read robots.txt first and skip disallowed URLs (RFC 9309). |

## map

Lists the URLs linked from a page plus the entries of `/sitemap.xml`.

| Parameter | Default | |
| --- | --- | --- |
| `url` | required | |
| `search` | none | Only URLs containing this text. |
| `sameDomainOnly` | `true` | |
| `limit` | 200 | |

## search

Raw web search. Brave Search when `BRAVE_API_KEY` is set, DuckDuckGo otherwise.

| Parameter | Default | |
| --- | --- | --- |
| `query` | required | |
| `limit` | 5 | Up to 20. |
| `scrapeResults` | `false` | Also fetch each result as Markdown. |
| `maxCharsPerResult` | 5000 | |
