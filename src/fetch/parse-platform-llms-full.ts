/**
 * Splits platform.claude.com's `llms-full.txt` into page records. A
 * DIFFERENT grammar from `parse-llms-full.ts` (code.claude.com's format),
 * confirmed against the real ~40MB file, not assumed the two Mintlify sites
 * would match. See PLAN.md step 2.6.5.
 *
 * Records are fenced `---\ntitle: <title>\nurl: <url>\n[description: ...]\n---`
 * blocks. The `## heading` that precedes a block is NOT a reliable title
 * source -- the real file often has an unrelated in-body subheading (e.g.
 * "## Next steps" left over from the previous page) sitting closer to the
 * next block than any real page title. Only the block's own `title:` key is
 * trustworthy. Confirmed exactly 2 delimiter lines per record (1234 for 612
 * records) in the real file with zero stray ones, but the marker still
 * requires a `platform.claude.com` URL on the line after `title:` so a body
 * that illustrates this same frontmatter shape as an example can't be
 * mistaken for a boundary.
 */

export interface PlatformLlmsFullRecord {
  title: string;
  sourceUrl: string;
  body: string;
}

const RECORD_MARKER_RE =
  /^---\r?\ntitle: (.+)\r?\nurl: (https:\/\/platform\.claude\.com\/\S+)\r?\n(?:description: .*\r?\n)?---\r?\n/gm;

export function parsePlatformLlmsFull(text: string): PlatformLlmsFullRecord[] {
  const markers = [...text.matchAll(RECORD_MARKER_RE)];
  return markers.map((marker, i) => {
    const bodyStart = (marker.index ?? 0) + marker[0].length;
    const bodyEnd = markers[i + 1]?.index ?? text.length;
    return {
      title: marker[1] ?? "",
      sourceUrl: marker[2] ?? "",
      body: text.slice(bodyStart, bodyEnd).trim(),
    };
  });
}
