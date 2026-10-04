#!/usr/bin/env node
// Builds data/report.md from data/usage.csv (every Gemini request) and data/results.csv (test runs).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header = [], ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
const load = (name) => (existsSync(path.join(dataDir, name)) ? parseCsv(readFileSync(path.join(dataDir, name), 'utf8')) : []);
const prices = JSON.parse(readFileSync(path.join(dataDir, 'pricing.json'), 'utf8')).models;

const num = (v) => Number(v) || 0;
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const usd = (n) => `$${n.toFixed(4)}`;
const table = (headers, rows) => [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

function costOf(model, input, output, standard = false) {
  const p = prices[model];
  if (!p) return 0;
  const [pi, po] = standard ? [p.standardInput ?? p.input, p.standardOutput ?? p.output] : [p.input, p.output];
  return (input * pi + output * po) / 1e6;
}

const usage = load('usage.csv');
const results = load('results.csv');
const out = [`# helptai test data report`, ``, `Built ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from \`usage.csv\` (${usage.length} Gemini requests) and \`results.csv\` (${results.length} test runs).`, ``];

// ---------- token use ----------
const group = (rows, keyOf) => {
  const map = new Map();
  for (const r of rows) {
    const key = keyOf(r);
    const g = map.get(key) ?? { requests: 0, ok: 0, blocked: 0, error: 0, input: 0, output: 0, thinking: 0, model: r.model };
    g.requests += 1;
    g[r.outcome] = (g[r.outcome] ?? 0) + 1;
    g.input += num(r.inputTokens); g.output += num(r.outputTokens); g.thinking += num(r.thinkingTokens);
    map.set(key, g);
  }
  return map;
};
const usageRow = (label, g) => [label, g.requests, g.ok, g.blocked, g.error, fmt(g.input), fmt(g.output), fmt(g.thinking), fmt(g.input + g.output + g.thinking), usd(costOf(g.model, g.input, g.output + g.thinking)), usd(costOf(g.model, g.input, g.output + g.thinking, true))];
const usageHeaders = ['', 'requests', 'ok', 'refused', 'failed', 'input tokens', 'output tokens', 'thinking tokens', 'total tokens', 'cost (intro price)', 'cost (standard price)'];

out.push(`## Token use by model`, ``, 'Output cost includes thinking tokens, as Google bills them. "intro" is the launch price that runs to the end of 2026; "standard" is the price after that.', ``);
const byModel = group(usage, (r) => r.model);
const modelRows = [...byModel.entries()].sort().map(([m, g]) => usageRow(m, g));
const all = { requests: 0, ok: 0, blocked: 0, error: 0, input: 0, output: 0, thinking: 0, introCost: 0, stdCost: 0 };
for (const g of byModel.values()) {
  all.requests += g.requests; all.ok += g.ok; all.blocked += g.blocked; all.error += g.error;
  all.input += g.input; all.output += g.output; all.thinking += g.thinking;
  all.introCost += costOf(g.model, g.input, g.output + g.thinking); all.stdCost += costOf(g.model, g.input, g.output + g.thinking, true);
}
modelRows.push(['**all models**', all.requests, all.ok, all.blocked, all.error, fmt(all.input), fmt(all.output), fmt(all.thinking), fmt(all.input + all.output + all.thinking), usd(all.introCost), usd(all.stdCost)]);
out.push(table(usageHeaders, modelRows), ``);

out.push(`## Token use by day`, ``);
const byDay = group(usage, (r) => `${r.timestamp.slice(0, 10)} ${r.model}`);
out.push(table(usageHeaders, [...byDay.entries()].sort().map(([d, g]) => usageRow(d, g))), ``);

// ---------- cost per page ----------
const okDocs = usage.filter((r) => r.endpoint === 'process-document' && r.outcome === 'ok' && num(r.inputTokens) > 0);
if (okDocs.length) {
  out.push(`## Every successful document request`, ``);
  out.push(table(['time', 'document', 'model', 'frames', 'seconds', 'input', 'output', 'thinking', 'cost (intro)'],
    okDocs.map((r) => [r.timestamp.slice(0, 16).replace('T', ' '), r.document, r.model, r.frames, (num(r.latencyMs) / 1000).toFixed(0), fmt(num(r.inputTokens)), fmt(num(r.outputTokens)), fmt(num(r.thinkingTokens)), usd(costOf(r.model, num(r.inputTokens), num(r.outputTokens) + num(r.thinkingTokens)))])), ``);
}

// ---------- test runs ----------
out.push(`## Test runs`, ``);
if (!results.length) out.push('No runs yet. Try `npm run eval -- data/videos/Book.mp4`.', '');
else {
  out.push(`"Ranges covered" is how many of the hand-labelled pages got at least one kept frame; "junk" is kept frames that are not on any page (page flips, blur); "mapping" is how many pages got a best frame from the right part of the video.`, ``);
  out.push(table(['run', 'video', 'cand.', 'frames', 'selection s', 'ranges covered', 'junk', 'model', 'gemini s', 'pages (expected)', 'mapping', 'flagged', 'in', 'out', 'think', 'cost (intro)'],
    results.map((r) => [r.run_id.slice(0, 15), r.video, r.candidates, r.frames_kept, r.selection_s, r.ranges_covered || '–', r.junk_frames === '' ? '–' : r.junk_frames, r.model || '–', r.gemini_s || '–', r.pages ? `${r.pages}${r.expected_pages ? ` (${r.expected_pages})` : ''}` : '–', r.mapping_correct || '–', r.flagged === '' ? '–' : r.flagged, r.input_tokens ? fmt(num(r.input_tokens)) : '–', r.output_tokens ? fmt(num(r.output_tokens)) : '–', r.thinking_tokens ? fmt(num(r.thinking_tokens)) : '–', r.cost_intro_usd ? `$${r.cost_intro_usd}` : '–'])), ``);
}

const text = out.join('\n');
writeFileSync(path.join(dataDir, 'report.md'), text);
console.log(text);
