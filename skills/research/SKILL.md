---
name: research
description: Method for researching questions, fact-checking claims and checking whether software already exists, using the EMAF connector tools (research, prior_art, scrape). Use when asked to look into a topic, verify a claim, summarize what is known, or decide whether to build something.
---

# Research with EMAF

## Looking into a question or checking a claim

1. **Start with `research`.** Pass the question in plain language. Use `depth: "deep"` for contested or high-stakes topics, `sources: "academic"` when only studies count.
2. **Prefer primary sources.** Papers, official documentation, standards, original repositories and first-hand data beat news articles, blogs, aggregators and AI-generated summaries. Cite the primary source, not the page that repeated it.
3. **Read before quoting.** The passages from `research` are excerpts. Use `scrape` on a promising source to read it in full before quoting it or drawing a conclusion from it.
4. **Cross-check key claims.** Every claim the answer depends on needs at least two independent sources. Two pages that copy the same press release are one source.
5. **Say how strong the evidence is.** State it explicitly when a claim rests on:
   - a preprint (not peer reviewed),
   - a single source,
   - sources that conflict (summarize both sides),
   - old data that may be outdated.
6. **Report what you could not verify** instead of filling gaps with assumptions.

## Before building something

Run `prior_art` with a one or two sentence description of the feature (add `language` when the stack is fixed) before proposing to write new code. For each relevant result, weigh:

- whether the README passage actually describes the needed feature,
- maintenance: last push date, archived flag, "possibly unmaintained" warnings,
- license compatibility, stars and open issues as rough signals.

Recommend an existing project when one fits. Propose building only when nothing fits, and say why the candidates fall short.

## Reading specific pages

- `scrape`: one known URL, in full.
- `crawl`: several pages of one site, for example a documentation section with `pathPrefix`.
- `map`: list a site's URLs to find the right page first.
