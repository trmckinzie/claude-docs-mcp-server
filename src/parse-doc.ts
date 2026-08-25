/**
 * Markdown parsing for the docs index: frontmatter extraction and splitting a
 * document into heading-scoped chunks.
 *
 * Pure by design -- no fs, no server. Callers hand in the raw text and the path
 * they read it from. See PLAN.md step 2.1.
 */

/**
 * Headings at or above this level open a new chunk; deeper ones stay inline as
 * ordinary content. Splitting on every level would produce chunks small enough
 * to distort avgdl, which BM25 normalises every score by.
 */
export const SPLIT_MAX_LEVEL = 3;

export interface DocMeta {
  title?: string;
  source_url?: string;
  updated?: string;
  tags?: string[];
  [key: string]: string | string[] | undefined;
}

export interface Chunk {
  /** Path of the document this chunk came from, POSIX-separated. */
  path: string;
  /** Slug for addressing this chunk, or null for a lead chunk. */
  anchor: string | null;
  /** Heading text, or null for a lead chunk. */
  heading: string | null;
  /** Heading trail from the document root, e.g. ["stdio", "Framing"]. */
  headingPath: string[];
  /** Heading depth; 0 for a lead chunk. */
  level: number;
  /** Chunk body with the heading line and surrounding blank lines removed. */
  text: string;
  /** 1-based line in the original document where this chunk starts. */
  startLine: number;
}

export interface ParsedDoc {
  path: string;
  title: string;
  meta: DocMeta;
  chunks: Chunk[];
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
/** A closing fence, per CommonMark, may carry nothing after the marker but
 * whitespace -- unlike an opening fence, which may carry an info string
 * (` ```bash `). Without this distinction, a fenced block that shows fence
 * syntax as an example (with trailing text on that line) closes early. */
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

export function parseDoc(raw: string, path: string): ParsedDoc {
  const normalised = raw.replace(/\r\n/g, "\n");
  const { meta, bodyLines, bodyStartLine } = extractFrontmatter(normalised);
  const chunks = chunkBody(bodyLines, bodyStartLine, path);
  return { path, title: resolveTitle(meta, chunks, path), meta, chunks };
}

interface Frontmatter {
  meta: DocMeta;
  bodyLines: string[];
  bodyStartLine: number;
}

function extractFrontmatter(raw: string): Frontmatter {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { meta: {}, bodyLines: lines, bodyStartLine: 1 };
  }

  const closing = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (closing === -1) {
    // Unterminated. Treating the remainder as metadata would swallow the whole
    // document, so index it as body instead -- text we can search beats keys we
    // guessed at.
    return { meta: {}, bodyLines: lines, bodyStartLine: 1 };
  }

  return {
    meta: parseMetaLines(lines.slice(1, closing)),
    bodyLines: lines.slice(closing + 1),
    bodyStartLine: closing + 2,
  };
}

function parseMetaLines(lines: string[]): DocMeta {
  const meta: DocMeta = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const colon = trimmed.indexOf(":");
    if (colon === -1) continue; // Not a key/value line -- skip it, never throw.

    const key = trimmed.slice(0, colon).trim();
    if (key === "") continue;

    const value = unquote(trimmed.slice(colon + 1).trim());
    meta[key] = key === "tags" ? splitTags(value) : value;
  }
  return meta;
}

function unquote(value: string): string {
  const first = value.charAt(0);
  if (value.length >= 2 && (first === '"' || first === "'") && value.endsWith(first)) {
    return value.slice(1, -1);
  }
  return value;
}

function splitTags(value: string): string[] {
  return value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((tag) => unquote(tag.trim()))
    .filter((tag) => tag !== "");
}

interface OpenChunk {
  heading: string | null;
  level: number;
  headingPath: string[];
  anchor: string | null;
  headingLine: number;
  bodyFirstLine: number;
  body: string[];
}

function chunkBody(lines: string[], bodyStartLine: number, path: string): Chunk[] {
  const chunks: Chunk[] = [];
  const stack: Array<{ level: number; text: string }> = [];
  const seenAnchors = new Map<string, number>();
  let fence: string | null = null;

  let current: OpenChunk = {
    heading: null,
    level: 0,
    headingPath: [],
    anchor: null,
    headingLine: bodyStartLine,
    bodyFirstLine: bodyStartLine,
    body: [],
  };

  const flush = (): void => {
    const { text, offset } = trimBlankLines(current.body);
    // A lead chunk with no prose is an artefact of a document that opens on a
    // heading; there is nothing to index. Empty *headed* chunks are kept,
    // because the heading itself is worth matching.
    if (current.heading === null && text === "") return;
    chunks.push({
      path,
      anchor: current.anchor,
      heading: current.heading,
      headingPath: [...current.headingPath],
      level: current.level,
      text,
      startLine:
        current.heading === null ? current.bodyFirstLine + offset : current.headingLine,
    });
  };

  lines.forEach((line, i) => {
    const lineNo = bodyStartLine + i;

    const fenceMatch = fence === null ? FENCE_RE.exec(line) : FENCE_CLOSE_RE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? "";
      if (fence === null) {
        fence = marker;
      } else if (marker.charAt(0) === fence.charAt(0) && marker.length >= fence.length) {
        fence = null;
      }
      current.body.push(line);
      return;
    }

    const headingMatch = fence === null ? HEADING_RE.exec(line) : null;
    if (headingMatch) {
      const level = (headingMatch[1] ?? "").length;
      const heading = (headingMatch[2] ?? "").trim();
      if (level <= SPLIT_MAX_LEVEL) {
        flush();
        while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) {
          stack.pop();
        }
        stack.push({ level, text: heading });
        current = {
          heading,
          level,
          headingPath: stack.map((entry) => entry.text),
          anchor: uniqueAnchor(heading, seenAnchors),
          headingLine: lineNo,
          bodyFirstLine: lineNo + 1,
          body: [],
        };
        return;
      }
    }

    current.body.push(line);
  });

  flush();
  return chunks;
}

function trimBlankLines(lines: string[]): { text: string; offset: number } {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start += 1;
  while (end > start && lines[end - 1]?.trim() === "") end -= 1;
  return { text: lines.slice(start, end).join("\n"), offset: start };
}

function uniqueAnchor(heading: string, seen: Map<string, number>): string {
  const base = slugify(heading) || "section";
  const used = seen.get(base) ?? 0;
  seen.set(base, used + 1);
  return used === 0 ? base : `${base}-${used + 1}`;
}

function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolveTitle(meta: DocMeta, chunks: Chunk[], path: string): string {
  const fromMeta = meta["title"];
  if (typeof fromMeta === "string" && fromMeta.trim() !== "") return fromMeta.trim();

  const h1 = chunks.find((chunk) => chunk.level === 1);
  if (h1?.heading) return h1.heading;

  const stem = path.split("/").pop() ?? path;
  return stem.replace(/\.md$/i, "");
}
