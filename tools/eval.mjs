#!/usr/bin/env node
// Runs helptai's real pipeline on test videos and saves what happened to data/.
//
//   npm run eval -- data/videos/Book.mp4 [more videos] [--candidates 1|2|3] [--no-gemini]
//                   [--label text] [--method auto|seek] [--app http://localhost:5173]
//
// `npm run dev` must be running. Frame selection runs in headless Chrome using the app's own code;
// the Gemini step goes through the app's API, so its tokens are also written to data/usage.csv.
import { chromium } from 'playwright-core';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');

// ---------- arguments ----------
const args = process.argv.slice(2);
const options = { candidates: 3, gemini: true, label: '', method: 'auto', app: 'http://localhost:5173' };
const videos = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--no-gemini') options.gemini = false;
  else if (arg === '--candidates') options.candidates = Number(args[++i]);
  else if (arg === '--label') options.label = args[++i];
  else if (arg === '--method') options.method = args[++i];
  else if (arg === '--app') options.app = args[++i];
  else videos.push(arg);
}
if (!videos.length) {
  console.error('Usage: npm run eval -- <video> [more videos] [--candidates 1|2|3] [--no-gemini] [--label text]');
  process.exit(1);
}

const pricing = JSON.parse(readFileSync(path.join(dataDir, 'pricing.json'), 'utf8')).models;
const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p));
if (!chrome) throw new Error('Chrome was not found. Set CHROME_PATH to its location.');

try {
  await fetch(options.app);
} catch {
  console.error(`Cannot reach the app at ${options.app}. Start it first with: npm run dev`);
  process.exit(1);
}

const csvCell = (value) => {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const RESULT_COLUMNS = [
  'run_id', 'timestamp', 'video', 'duration_s', 'resolution', 'size_mb', 'method', 'candidates', 'frames_kept', 'selection_s',
  'expected_pages', 'ranges_covered', 'junk_frames', 'gemini', 'model', 'gemini_s', 'pages', 'pages_match', 'mapping_correct',
  'flagged', 'input_tokens', 'output_tokens', 'thinking_tokens', 'cost_intro_usd', 'cost_standard_usd', 'run_dir',
];

function cost(model, usage) {
  const price = pricing[model];
  if (!price || !usage) return ['', ''];
  const at = (input, output) => ((usage.inputTokens * input + (usage.outputTokens + usage.thinkingTokens) * output) / 1e6).toFixed(4);
  return [at(price.input, price.output), at(price.standardInput ?? price.input, price.standardOutput ?? price.output)];
}

const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });

for (const videoArg of videos) {
  const videoPath = path.resolve(videoArg);
  const base = path.basename(videoPath).replace(/\.[^.]+$/, '');
  const stamp = new Date();
  const id = `${stamp.toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-')}_${base}_c${options.candidates}${options.label ? `_${options.label}` : ''}`;
  const runDir = path.join(dataDir, 'runs', id);
  mkdirSync(path.join(runDir, 'frames'), { recursive: true });
  const expectedFile = path.join(path.dirname(videoPath), `${base}.expected.json`);
  const expected = existsSync(expectedFile) ? JSON.parse(readFileSync(expectedFile, 'utf8')) : null;

  console.log(`\n=== ${base}  (candidates ${options.candidates}, ${options.gemini ? 'with Gemini' : 'selection only'})`);

  // ---------- 1. frame selection, using the app's own code ----------
  const page = await browser.newPage();
  await page.route('**/__eval_video', (route) => route.fulfill({ status: 200, contentType: 'video/mp4', body: readFileSync(videoPath) }));
  await page.goto(options.app);
  const selection = await page.evaluate(async ({ method, candidates }) => {
    const { selectVideoFrames } = await import('/src/lib/video-processing.ts');
    const blob = await (await fetch('/__eval_video')).blob();
    const probe = document.createElement('video');
    probe.src = URL.createObjectURL(blob);
    await new Promise((resolve) => (probe.onloadedmetadata = resolve));
    const meta = { duration: probe.duration, width: probe.videoWidth, height: probe.videoHeight };
    const started = performance.now();
    const frames = await selectVideoFrames(new File([blob], 'video.mp4', { type: blob.type || 'video/mp4' }), undefined, { method, candidates });
    return { meta, seconds: (performance.now() - started) / 1000, frames };
  }, { method: options.method, candidates: options.candidates });
  await page.close();

  const { frames, meta } = selection;
  frames.forEach((frame, i) => {
    const name = `${String(i + 1).padStart(2, '0')}_${frame.timestamp.toFixed(1)}s_clarity${Math.round(frame.sharpness * 100)}.jpg`;
    writeFileSync(path.join(runDir, 'frames', name), Buffer.from(frame.dataUrl.split(',')[1], 'base64'));
  });
  const summarySelection = frames.map((f) => ({ timestamp: +f.timestamp.toFixed(2), clarity: +f.sharpness.toFixed(3), width: f.width, height: f.height }));
  writeFileSync(path.join(runDir, 'selection.json'), JSON.stringify({ video: base, ...meta, seconds: +selection.seconds.toFixed(2), frames: summarySelection }, null, 2));

  // How well did selection do against the hand-labelled page ranges?
  const inRange = (t, [from, to]) => t >= from - 0.3 && t <= to + 0.3;
  let rangesCovered = '';
  let junkFrames = '';
  if (expected?.ranges) {
    rangesCovered = `${expected.ranges.filter((range) => frames.some((f) => inRange(f.timestamp, range))).length}/${expected.ranges.length}`;
    junkFrames = frames.filter((f) => !expected.ranges.some((range) => inRange(f.timestamp, range))).length;
  }
  console.log(`  selection: ${frames.length} frames in ${selection.seconds.toFixed(1)}s` + (expected ? `, page ranges covered ${rangesCovered}, junk frames ${junkFrames}` : ''));

  // ---------- 2. Gemini, through the app's API ----------
  let model = '';
  let geminiSeconds = '';
  let pages = '';
  let pagesMatch = '';
  let mappingCorrect = '';
  let flagged = '';
  let usage = null;
  if (options.gemini) {
    const started = Date.now();
    const response = await fetch(`${options.app}/api/process-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentName: base, frames: frames.map(({ dataUrl, timestamp, sharpness, difference }) => ({ dataUrl, timestamp, sharpness, difference })) }),
    });
    geminiSeconds = ((Date.now() - started) / 1000).toFixed(1);
    const body = await response.json().catch(() => null);
    writeFileSync(path.join(runDir, 'response.json'), JSON.stringify(body, null, 2));
    if (!response.ok) {
      console.log(`  gemini: FAILED (${response.status}) ${body?.error ?? ''}`);
    } else {
      model = body.pages[0]?.modelUsed ?? body.usage?.model ?? '';
      usage = body.usage;
      pages = body.pages.length;
      flagged = body.pages.filter((p) => p.needsReview).length;
      if (expected) pagesMatch = pages === expected.pages ? 'yes' : 'no';
      if (expected?.ranges) {
        const right = body.pages.filter((p, k) => expected.ranges[k] && inRange(frames[p.bestFrameIndex].timestamp, expected.ranges[k])).length;
        mappingCorrect = `${right}/${expected.ranges.length}`;
      }
      const lines = body.pages.map((p) => {
        const times = p.sourceFrameIndices.map((i) => frames[i].timestamp.toFixed(1)).join(', ');
        const text = p.text.replace(/\s+/g, ' ').slice(0, 140);
        return `## Page ${p.pageNumber}: ${p.title}\n- frames: ${times} s; best: ${frames[p.bestFrameIndex].timestamp.toFixed(1)} s; confidence ${p.confidence}; ${p.needsReview ? `FLAGGED: ${p.reviewReason}` : 'not flagged'}; ${p.blocks.length} blocks\n- ${text}\n`;
      });
      writeFileSync(path.join(runDir, 'pages.md'), `# ${base}: ${model}\n\n${lines.join('\n')}`);
      console.log(`  gemini: ${pages} pages in ${geminiSeconds}s on ${model}` + (expected ? ` (expected ${expected.pages}); frame mapping ${mappingCorrect}` : '') + `; flagged ${flagged}`);
      console.log(`  tokens: input ${usage.inputTokens}, output ${usage.outputTokens}, thinking ${usage.thinkingTokens}`);
    }
  }

  // ---------- 3. save the summary row ----------
  const [costIntro, costStandard] = cost(model, usage);
  const row = {
    run_id: id, timestamp: stamp.toISOString(), video: base, duration_s: meta.duration.toFixed(1), resolution: `${meta.width}x${meta.height}`,
    size_mb: (statSync(videoPath).size / 1048576).toFixed(1), method: options.method, candidates: options.candidates, frames_kept: frames.length,
    selection_s: selection.seconds.toFixed(1), expected_pages: expected?.pages ?? '', ranges_covered: rangesCovered, junk_frames: junkFrames,
    gemini: options.gemini ? 'yes' : 'no', model, gemini_s: geminiSeconds, pages, pages_match: pagesMatch, mapping_correct: mappingCorrect, flagged,
    input_tokens: usage?.inputTokens ?? '', output_tokens: usage?.outputTokens ?? '', thinking_tokens: usage?.thinkingTokens ?? '',
    cost_intro_usd: costIntro, cost_standard_usd: costStandard, run_dir: path.relative(root, runDir),
  };
  writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(row, null, 2));
  const resultsFile = path.join(dataDir, 'results.csv');
  if (!existsSync(resultsFile) || statSync(resultsFile).size === 0) writeFileSync(resultsFile, `${RESULT_COLUMNS.join(',')}\n`);
  appendFileSync(resultsFile, `${RESULT_COLUMNS.map((c) => csvCell(row[c])).join(',')}\n`);
  console.log(`  saved: ${row.run_dir}`);
}

await browser.close();
