import type { Budget } from "./budget";
import { FETCH_TIMEOUT_MS, USER_AGENT } from "./config";

/** Product token matched against robots.txt user-agent lines. */
export const ROBOTS_AGENT = "emaf";

interface Rule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}

export interface RobotsPolicy {
  /** True when `path` (pathname plus query) may be fetched. */
  isAllowed(path: string): boolean;
  /** Human-readable note about how the policy was obtained, if noteworthy. */
  note: string;
}

function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/**
 * Parses robots.txt per RFC 9309 and returns the rules of the group that
 * applies to `agent`: the group naming it, or the `*` group otherwise.
 */
export function parseRobots(text: string, agent = ROBOTS_AGENT): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      // Consecutive user-agent lines share one group.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || (field !== "allow" && field !== "disallow")) continue;
    // An empty Disallow allows everything; an empty Allow means nothing.
    if (value === "") continue;
    const pattern = value.startsWith("/") || value.startsWith("*") ? value : `/${value}`;
    current.rules.push({ allow: field === "allow", pattern, regex: toRegex(pattern) });
  }

  const token = agent.toLowerCase();
  const named = groups.filter((g) => g.agents.some((a) => a !== "*" && token.startsWith(a)));
  const chosen = named.length ? named : groups.filter((g) => g.agents.includes("*"));
  return chosen.flatMap((g) => g.rules);
}

/** Longest matching rule wins; on equal length, Allow wins. No match means allowed. */
export function isPathAllowed(rules: Rule[], path: string): boolean {
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!rule.regex.test(path)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

function policy(rules: Rule[], note: string): RobotsPolicy {
  return { isAllowed: (path) => isPathAllowed(rules, path), note };
}

const DISALLOW_ALL: Rule[] = [{ allow: false, pattern: "/", regex: /^\// }];

/**
 * Fetches and parses an origin's robots.txt. Per RFC 9309, a 4xx response
 * means no restrictions, while a 5xx response or a network failure means
 * the whole site must be treated as disallowed. Uses one subrequest.
 */
export async function fetchRobotsPolicy(origin: string, budget: Budget): Promise<RobotsPolicy> {
  let response: Response;
  try {
    response = await budget.fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/plain" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return policy(DISALLOW_ALL, `robots.txt could not be fetched (${reason}); treating the site as disallowed.`);
  }
  if (response.status >= 500) {
    await response.body?.cancel();
    return policy(DISALLOW_ALL, `robots.txt returned HTTP ${response.status}; treating the site as disallowed.`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    return policy([], "");
  }
  return policy(parseRobots(await response.text()), "");
}
