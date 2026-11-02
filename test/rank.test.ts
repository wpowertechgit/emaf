import { describe, expect, it } from "vitest";
import { bm25Scores, rankBm25 } from "../src/rank/bm25";
import { chunkMarkdown } from "../src/rank/chunk";
import { dedupeNearDuplicates } from "../src/rank/dedup";
import { deriveQueries } from "../src/rank/queries";
import { stem, tokenize } from "../src/rank/tokenize";

function lorem(n: number, word = "filler"): string {
  return Array.from({ length: n }, (_, i) => `${word}${i % 7}`).join(" ");
}

describe("tokenize", () => {
  it("lowercases, strips diacritics and stopwords, and stems", () => {
    expect(tokenize("The Caches are caching Café data!")).toEqual(["cach", "cach", "cafe", "data"]);
  });

  it("folds common inflections to the same stem", () => {
    expect(new Set(["cache", "caches", "cached", "caching"].map(stem)).size).toBe(1);
    expect(stem("processes")).toBe(stem("process"));
    expect(stem("running")).toBe(stem("runs"));
    expect(stem("libraries")).toBe(stem("library"));
  });
});

describe("bm25", () => {
  it("ranks documents that contain more query terms higher", () => {
    const ranked = rankBm25("rate limiting middleware", [
      "A guide to baking bread at home.",
      "Rate limiting protects APIs from abuse.",
      "Express middleware for rate limiting with Redis.",
    ], (d) => d);
    expect(ranked.map((r) => r.item)).toEqual([
      "Express middleware for rate limiting with Redis.",
      "Rate limiting protects APIs from abuse.",
    ]);
  });

  it("weights rare terms above common ones", () => {
    const docs = [
      ["cache", "server"],
      ["cache", "server"],
      ["cache", "server"],
      ["cache", "bloom"],
    ];
    const scores = bm25Scores(["cache", "bloom"], docs);
    expect(scores[3]).toBeGreaterThan(scores[0]);
    expect(scores[0]).toBeGreaterThan(0);
  });

  it("saturates term frequency and normalizes by length", () => {
    const short = ["bm25"];
    const repeated = Array(20).fill("bm25");
    const long = ["bm25", ...Array(50).fill("other")];
    const [s, r, l] = bm25Scores(["bm25"], [short, repeated, long, ["x"]]);
    expect(r).toBeLessThan(s * 2.5);
    expect(s).toBeGreaterThan(l);
  });

  it("handles empty input", () => {
    expect(bm25Scores(["a"], [])).toEqual([]);
    expect(bm25Scores([], [["a"]])).toEqual([0]);
    expect(rankBm25("the of and", ["anything"], (d) => d)).toEqual([]);
  });
});

describe("chunkMarkdown", () => {
  it("keeps passages within the word bounds and records the heading path", () => {
    const md = [
      "# Guide",
      "## Install",
      lorem(120),
      "",
      lorem(120),
      "## Usage",
      "### Basics",
      lorem(200),
    ].join("\n\n");
    const passages = chunkMarkdown(md);
    for (const p of passages) expect(p.wordCount).toBeLessThanOrEqual(300);
    expect(passages[0].section).toBe("Guide > Install");
    expect(passages.at(-1)?.section).toBe("Guide > Usage > Basics");
    expect(passages.reduce((n, p) => n + p.wordCount, 0)).toBe(440);
  });

  it("splits an oversized paragraph on sentence boundaries", () => {
    const sentence = `${lorem(40)}.`;
    const paragraph = Array(20).fill(sentence).join(" ");
    const passages = chunkMarkdown(paragraph);
    expect(passages.length).toBeGreaterThan(2);
    for (const p of passages) {
      expect(p.wordCount).toBeLessThanOrEqual(300);
      expect(p.text.trim().endsWith(".")).toBe(true);
    }
  });

  it("hard-splits text without sentence boundaries", () => {
    const passages = chunkMarkdown(lorem(700));
    expect(passages.map((p) => p.wordCount)).toEqual([300, 300, 100]);
  });

  it("does not split inside fenced code blocks", () => {
    const code = ["```js", ...Array(10).fill("const a = 1;"), "", "const b = 2;", "```"].join("\n");
    const passages = chunkMarkdown(`${lorem(30)}\n\n${code}\n\n${lorem(30)}`, { minWords: 10, maxWords: 300 });
    const withCode = passages.find((p) => p.text.includes("```js"));
    expect(withCode?.text).toContain("const b = 2;\n```");
  });

  it("drops tiny fragments unless they are the only passage", () => {
    expect(chunkMarkdown("Just a short note.")).toHaveLength(1);
    const passages = chunkMarkdown(`${lorem(200)}\n\n## Footer\n\nCopyright.\n\n## More\n\n${lorem(200)}`);
    expect(passages.some((p) => p.text === "Copyright.")).toBe(false);
  });
});

describe("dedupeNearDuplicates", () => {
  const base =
    "Intermittent fasting improved insulin sensitivity in adults with prediabetes over a twelve week randomized trial";

  it("drops near-identical passages and keeps the first", () => {
    const items = [
      { id: 1, text: base },
      { id: 2, text: `${base}.` },
      { id: 3, text: base.replace("twelve", "12") },
      { id: 4, text: "A completely different passage about solar panel efficiency in cold climates" },
    ];
    expect(dedupeNearDuplicates(items, (i) => i.text).map((i) => i.id)).toEqual([1, 4]);
  });

  it("treats a passage quoted inside a longer one as a duplicate", () => {
    const items = [`Background. ${base}. Further discussion follows here.`, base];
    expect(dedupeNearDuplicates(items, (t) => t)).toHaveLength(1);
  });

  it("keeps passages that only share a few words", () => {
    const items = [
      "Rate limiting in Express with a token bucket stored in Redis",
      "Rate limiting in Django using a sliding window counter in Postgres",
    ];
    expect(dedupeNearDuplicates(items, (t) => t)).toHaveLength(2);
  });
});

describe("deriveQueries", () => {
  it("produces the question, a keyword variant and a phrase variant", () => {
    const d = deriveQueries("Does intermittent fasting improve insulin sensitivity in adults?");
    expect(d.natural).toBe("Does intermittent fasting improve insulin sensitivity in adults");
    expect(d.keywords).toEqual(["intermittent", "fasting", "improve", "insulin", "sensitivity", "adults"]);
    expect(d.queries[0]).toBe(d.natural);
    expect(d.queries[1]).toBe("intermittent fasting improve insulin sensitivity adults");
    expect(d.queries[2]).toBe('"intermittent fasting improve" "insulin sensitivity"');
    expect(d.queries.length).toBeGreaterThanOrEqual(2);
    expect(d.queries.length).toBeLessThanOrEqual(4);
  });

  it("prefers phrases the user quoted", () => {
    const d = deriveQueries('Is "retrieval augmented generation" better than fine-tuning for small models?');
    expect(d.phrases[0]).toBe("retrieval augmented generation");
    expect(d.queries).toContain('"retrieval augmented generation" better fine tuning');
  });

  it("is deterministic and never returns duplicate queries", () => {
    const a = deriveQueries("rust async runtime");
    expect(deriveQueries("rust async runtime")).toEqual(a);
    expect(new Set(a.queries.map((q) => q.toLowerCase())).size).toBe(a.queries.length);
  });
});
