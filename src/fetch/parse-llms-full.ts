/**
 * Splits an `llms-full.txt` blob -- the concatenated-pages format Mintlify
 * docs sites publish -- into individual page records. Pure: text in, records
 * out. See PLAN.md step 2.6.5.
 *
 * Record grammar confirmed against the real files, not assumed: a `# Title`
 * line immediately followed by a `Source: <url>` line marks a new record.
 * A page's own `##` subheadings, and even a `# `-prefixed line that isn't
 * immediately followed by `Source:`, stay inside the current record's body --
 * only the paired marker counts as a boundary.
 */

export interface LlmsFullRecord {
  title: string;
  sourceUrl: string;
  body: string;
}

/** `# Title` then `Source: <url>` on the very next line, captured together. */
const RECORD_MARKER_RE = /^# (.+)\r?\nSource: (\S+)\r?\n/gm;

export function parseLlmsFull(text: string): LlmsFullRecord[] {
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
