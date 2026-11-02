#!/usr/bin/env python3
"""Scan the repo for emoji (and em dash) usage so it can be purged.

Usage:
    python scripts/emoji-gestapo.py [path] [--ext .ts,.tsx,...] [--json] [--quiet] [--no-em-dash]

Exits 1 if any hit is found (so it can be wired into CI later), 0 otherwise.
"""
import argparse
import json
import os
import re
import sys

# Windows consoles default to a legacy codepage that can't encode most emoji - 
# force UTF-8 on stdout so the report itself doesn't crash mid-scan.
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

DEFAULT_IGNORE_DIRS = {
    'node_modules', '.git', 'dist', 'build', '.wrangler', '.vscode', '.claude',
    '.playwright-cli', 'artifacts', 'output', 'playwright-report', 'test-results',
    'coverage', '.next', '.vite', 'migrations', 'tmp',
}

DEFAULT_EXTENSIONS = {
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.md', '.mdx',
    '.sql', '.html', '.css', '.json', '.yml', '.yaml',
}

# Real emoji / pictograph ranges - deliberately excludes plain punctuation,
# arrows (2190-21FF), and box-drawing so normal UI copy doesn't get flagged.
EMOJI_PATTERN = re.compile(
    '['
    '\U0001F1E6-\U0001F1FF'  # regional indicators, used for flag emoji
    '\U0001F300-\U0001F5FF'  # misc symbols and pictographs
    '\U0001F600-\U0001F64F'  # emoticons
    '\U0001F680-\U0001F6FF'  # transport and map symbols
    '\U0001F700-\U0001F77F'  # alchemical symbols
    '\U0001F780-\U0001F7FF'  # geometric shapes extended
    '\U0001F800-\U0001F8FF'  # supplemental arrows-C
    '\U0001F900-\U0001F9FF'  # supplemental symbols and pictographs
    '\U0001FA00-\U0001FA6F'  # chess symbols, symbols and pictographs extended-A
    '\U0001FA70-\U0001FAFF'  # symbols and pictographs extended-A
    '\U00002300-\U000023FF'  # miscellaneous technical, includes hourglass/clock/watch marks
    '\U00002600-\U000026FF'  # miscellaneous symbols
    '\U00002700-\U000027BF'  # dingbats
    '\U00002B00-\U00002BFF'  # miscellaneous symbols and arrows
    '\U0000FE0F'             # variation selector-16, forces emoji presentation
    '\U0000200D'             # zero-width joiner, used in emoji sequences
    ']',
    flags=re.UNICODE,
)

# Not an emoji, but the same AI-slop smell - flagged separately so it's
# easy to tell "real emoji" from "em dash" in the report.
EM_DASH_PATTERN = re.compile('\U00002014')


def should_skip_dir(dirname: str) -> bool:
    return dirname in DEFAULT_IGNORE_DIRS or dirname.startswith('.')


def scan_file(path: str, check_em_dash: bool):
    findings = []
    try:
        with open(path, 'r', encoding='utf-8') as f:
            for lineno, line in enumerate(f, start=1):
                emoji_matches = list(EMOJI_PATTERN.finditer(line))
                em_dash_matches = list(EM_DASH_PATTERN.finditer(line)) if check_em_dash else []
                if not emoji_matches and not em_dash_matches:
                    continue
                chars = ''.join(dict.fromkeys(m.group() for m in [*emoji_matches, *em_dash_matches]))
                kinds = []
                if emoji_matches:
                    kinds.append('emoji')
                if em_dash_matches:
                    kinds.append('em-dash')
                findings.append({
                    'line': lineno,
                    'chars': chars,
                    'kinds': kinds,
                    'text': line.strip()[:160],
                })
    except (UnicodeDecodeError, IsADirectoryError, PermissionError):
        return []
    return findings


def walk_repo(root: str, extensions: set[str]):
    # A single-file root used to be silently swallowed here: os.walk() on a
    # file path (not a directory) yields zero iterations with no error, so
    # `emoji-gestapo.py some/file.ts` always reported a false "0 hit(s)"
    # clean pass regardless of the file's actual content - discovered after
    # an entire session's worth of per-file checks turned out to have
    # verified nothing. An explicit file path is scanned directly,
    # regardless of extension - passing one is an unambiguous, deliberate
    # request to check that exact file, and the extension filter exists to
    # skip irrelevant files during a directory walk, not to second-guess a
    # file named on the command line.
    if os.path.isfile(root):
        yield root
        return
    if not os.path.isdir(root):
        return
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not should_skip_dir(d)]
        for filename in filenames:
            ext = os.path.splitext(filename)[1].lower()
            if ext not in extensions:
                continue
            yield os.path.join(dirpath, filename)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path', nargs='?', default='.', help='Root path to scan (default: repo root)')
    parser.add_argument('--ext', default=None, help='Comma-separated list of extensions to scan (default: common source/text files)')
    parser.add_argument('--json', action='store_true', help='Print machine-readable JSON instead of a human report')
    parser.add_argument('--quiet', action='store_true', help='Only print the summary line')
    parser.add_argument('--no-em-dash', action='store_true', help='Skip em dash ( - ) detection, emoji-only scan')
    args = parser.parse_args()

    extensions = DEFAULT_EXTENSIONS
    if args.ext:
        extensions = {e if e.startswith('.') else f'.{e}' for e in args.ext.split(',')}

    root = os.path.abspath(args.path)
    # relpath(filepath, root) degenerates to "." when root is itself a file
    # (filepath == root) - display relative to its parent directory instead
    # so the report shows the actual filename, not a bare dot.
    display_base = os.path.dirname(root) if os.path.isfile(root) else root
    results = {}
    for filepath in walk_repo(root, extensions):
        findings = scan_file(filepath, check_em_dash=not args.no_em_dash)
        if findings:
            results[os.path.relpath(filepath, display_base).replace(os.sep, '/')] = findings

    total_hits = sum(len(v) for v in results.values())
    em_dash_hits = sum(1 for v in results.values() for hit in v if 'em-dash' in hit['kinds'])

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        if not args.quiet:
            for filepath in sorted(results):
                print(f'\n{filepath}')
                for hit in results[filepath]:
                    tag = '+'.join(hit['kinds'])
                    print(f'  L{hit["line"]:>5}  [{hit["chars"]}]  ({tag})  {hit["text"]}')
        print(f'\n{"=" * 60}')
        print(f'emoji-gestapo: {total_hits} hit(s) across {len(results)} file(s) ({em_dash_hits} em-dash, {total_hits - em_dash_hits} emoji)')

    sys.exit(1 if total_hits else 0)


if __name__ == '__main__':
    main()
