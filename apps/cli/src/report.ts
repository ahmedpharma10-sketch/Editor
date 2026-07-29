/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { arch, platform, release } from "node:os";

const ISSUE_URL = "https://github.com/diffusionstudio/editor/issues/new";

// GitHub answers a prefilled issue URL with 414 well before the 8 KB mark, so
// the link carries a trimmed body and points at the full report on disk.
const MAX_URL_LENGTH = 6000;

export type IssueInput = {
  title: string;
  body?: string;
  commands?: string[];
  logs?: string[];       // already formatted log lines, oldest first
  appStatus: string;     // "running", "not running", "not checked", or why it was unreachable
  version: string;
  reportPath: string;    // where the full report is written; referenced when the URL is truncated
};

export type IssueReport = { markdown: string; url: string; truncated: boolean };

function fence(language: string, content: string): string {
  return `\`\`\`${language}\n${content}\n\`\`\``;
}

function environmentTable(input: IssueInput): string {
  const rows: Array<[string, string]> = [
    ["dapi", input.version],
    ["platform", `${platform()} ${release()} (${arch()})`],
    ["node", process.version],
    ["app", input.appStatus],
  ];
  return ["| | |", "| --- | --- |", ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join("\n");
}

// encodeURIComponent throws on a lone surrogate, which slicing the body mid
// emoji can produce; dropping the orphan half is enough to keep the search safe.
function encodedLength(text: string): number {
  const code = text.charCodeAt(text.length - 1);
  const safe = code >= 0xd800 && code <= 0xdbff ? text.slice(0, -1) : text;
  return encodeURIComponent(safe).length;
}

function issueUrl(title: string, body: string, reportPath: string): { url: string; truncated: boolean } {
  const base = `${ISSUE_URL}?title=${encodeURIComponent(title)}&body=`;
  const room = MAX_URL_LENGTH - base.length;
  if (encodedLength(body) <= room) return { url: base + encodeURIComponent(body), truncated: false };

  const note = `\n\n_Truncated for the link — full report: ${reportPath}_\n`;
  const budget = room - encodedLength(note);

  // Longest prefix of the body that still fits, by binary search on characters:
  // percent-encoding is per-character, so the encoded length grows monotonically.
  let lo = 0;
  let hi = body.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (encodedLength(body.slice(0, mid)) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return { url: base + encodeURIComponent(body.slice(0, lo) + note), truncated: true };
}

export function buildIssueReport(input: IssueInput): IssueReport {
  const sections: string[] = [];

  if (input.body?.trim()) sections.push(input.body.trim());
  if (input.commands?.length) sections.push(`## Repro\n\n${fence("sh", input.commands.join("\n"))}`);
  sections.push(`## Environment\n\n${environmentTable(input)}`);
  if (input.logs?.length) sections.push(`## App logs\n\n${fence("", input.logs.join("\n"))}`);

  const body = sections.join("\n\n");
  const { url, truncated } = issueUrl(input.title, body, input.reportPath);

  return { markdown: `# ${input.title}\n\n${body}\n`, url, truncated };
}
