import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { ProcessDocumentBody, ProcessPageBody, type ErrorResponseCode } from "@helptai/api-zod";
import { ThinkingLevel } from "@google/genai";
import { clients } from "@helptai/integrations-gemini-ai";
import { buildPagePrompt, buildPrompt, mainPage, RESPONSE_SCHEMA } from "../lib/analysis";
import { AllModelsFailedError, CancelledError, GeminiTimeoutError } from "../lib/gemini-call";
import { planParts, readInParts } from "../lib/reconstruct";
import { getModelChain } from "../lib/gemini-config";
import { analyzeWith, buildParts, type GenerateFn, type PromptImage } from "../lib/gemini-run";
import { appendUsage } from "../lib/usage-log";

const router: IRouter = Router();

const MAX_INLINE_FRAME_BYTES = 1_150_000;
const SAFE_REQUESTS_PER_MINUTE = 12;
const geminiRequestTimes: number[] = [];

const MESSAGES: Record<ErrorResponseCode, string> = {
  bad_request: "The selected frames could not be read.",
  quota: "Gemini's usage limit has been reached for now. Please try again a little later.",
  busy: "Gemini is busy right now. Please try this capture again in a moment.",
  invalid_output: "The pages could not be put together this time. Please try again.",
  blocked:
    "Gemini declined to transcribe these frames, which can happen with published text. Try again with fewer pages, or a different capture.",
  unavailable:
    "The document could not be analyzed right now. Your original capture is still on this device.",
};
const STATUS: Record<ErrorResponseCode, number> = {
  bad_request: 400,
  quota: 429,
  busy: 503,
  invalid_output: 502,
  blocked: 422,
  unavailable: 502,
};

function sendError(res: Response, code: ErrorResponseCode, message = MESSAGES[code]) {
  res.status(STATUS[code]).json({ error: message, code });
}

type CallContext = {
  endpoint: string;
  requestId: string;
  document: string;
  frames: number;
  uploadKb: number;
  timeoutMs: number;
  // Aborts the call in flight when the user cancels.
  signal?: AbortSignal;
};

// How long one Gemini attempt may take before we give up on it and try the next model. Measured
// successful calls: one page 14 s, an 8-page document 36-62 s.
const timeoutFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const DOCUMENT_TIMEOUT_MS = timeoutFromEnv("GEMINI_TIMEOUT_MS", 150_000);
const PAGE_TIMEOUT_MS = timeoutFromEnv("GEMINI_PAGE_TIMEOUT_MS", 90_000);

// How much the model may "think" before answering. Thinking is billed as output and counts toward
// the output limit: on "default" one 6-frame document spent 15,729 thinking tokens and its answer
// was cut off. "low" keeps the reading accurate for transcription. Set GEMINI_THINKING to
// minimal, low, medium, high, or default (the model's own choice).
const THINKING_LEVELS: Record<string, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};
const thinkingLevel = THINKING_LEVELS[(process.env.GEMINI_THINKING ?? "low").trim().toLowerCase()];
// Models that rejected a thinking level; they are asked without one from then on.
const noThinkingLevel = new Set<string>();

// Builds the function that makes one real Gemini call for the given images and prompt, and
// records its token use (also for failed or refused attempts) in the usage table.
function makeGenerate(prompt: string, images: PromptImage[], context: CallContext): GenerateFn {
  const contents = [{ role: "user" as const, parts: buildParts(prompt, images) }];
  let attempt = 0;
  return async ({ model, keyIndex }) => {
    const started = Date.now();
    const base = {
      timestamp: new Date(started).toISOString(),
      endpoint: context.endpoint,
      requestId: context.requestId,
      attempt: attempt++,
      document: context.document,
      model,
      keyIndex,
      frames: context.frames,
      uploadKb: context.uploadKb,
    };
    const abort = new AbortController();
    const stop = () => abort.abort();
    context.signal?.addEventListener("abort", stop, { once: true });
    let timer: NodeJS.Timeout | undefined;
    const ask = (withThinking: boolean) =>
      clients[keyIndex].models.generateContent({
        model,
        contents,
        config: {
          maxOutputTokens: 16384,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          abortSignal: abort.signal,
          ...(withThinking ? { thinkingConfig: { thinkingLevel } } : {}),
        },
      });
    const askOnce = async () => {
      const withThinking = thinkingLevel !== undefined && !noThinkingLevel.has(model);
      try {
        return await ask(withThinking);
      } catch (error) {
        // A model that does not support thinking levels: ask again without one.
        const message = error instanceof Error ? error.message : "";
        if (!withThinking || Number((error as { status?: unknown })?.status) !== 400 || !/thinking/i.test(message)) throw error;
        noThinkingLevel.add(model);
        return ask(false);
      }
    };
    try {
      const response = await Promise.race([
        askOnce(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            abort.abort();
            reject(new GeminiTimeoutError(context.timeoutMs));
          }, context.timeoutMs);
        }),
      ]);
      const finishReason = response.candidates?.[0]?.finishReason ? String(response.candidates[0].finishReason) : "";
      const usage = {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        thinkingTokens: response.usageMetadata?.thoughtsTokenCount ?? 0,
      };
      appendUsage({
        ...base,
        outcome: ["", "STOP", "MAX_TOKENS"].includes(finishReason) ? "ok" : "blocked",
        finishReason,
        httpStatus: 200,
        latencyMs: Date.now() - started,
        ...usage,
        totalTokens: response.usageMetadata?.totalTokenCount ?? usage.inputTokens + usage.outputTokens + usage.thinkingTokens,
        note: "",
      });
      return { text: response.text ?? "", finishReason: finishReason || undefined, usage };
    } catch (error) {
      const status = Number((error as { status?: unknown })?.status);
      appendUsage({
        ...base,
        outcome: "error",
        finishReason: "",
        httpStatus: Number.isFinite(status) ? status : "",
        latencyMs: Date.now() - started,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        totalTokens: 0,
        note: error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 160) : String(error).slice(0, 160),
      });
      throw error;
    } finally {
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", stop);
    }
  };
}

const newRequestId = () => randomUUID().slice(0, 8);
const uploadKb = (images: PromptImage[]) => Math.round(images.reduce((total, image) => total + image.data.length * 0.75, 0) / 1024);

router.post("/process-document", async (req, res) => {
  const parsed = ProcessDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "bad_request");
    return;
  }

  const { documentName, frames } = parsed.data;
  const inlineFrames = frames.map((frame) => parseDataUrl(frame.dataUrl));
  if (inlineFrames.some((frame) => !frame || frame.data.length > MAX_INLINE_FRAME_BYTES)) {
    sendError(res, "bad_request", "One of the selected frames is too large to analyze.");
    return;
  }
  if (!reserveGeminiRequest()) {
    sendError(res, "quota");
    return;
  }

  // The app asks for a stream of progress lines (NDJSON) so it can show what is happening and
  // cancel; other callers (the eval tool) get one JSON answer as before.
  const streaming = (req.headers.accept ?? "").includes("application/x-ndjson");
  const send = (event: object) => {
    if (streaming && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
  // Closing the request (the user pressed cancel) stops the Gemini call and any further tries.
  const cancel = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) cancel.abort();
  });
  if (streaming) {
    res.status(200).setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();
  }

  const started = Date.now();
  const requestId = newRequestId();
  const parts = planParts(frames.length);
  try {
    const { pages, extras, failedParts } = await readInParts(parts, async (part, index) => {
      const partFrames = frames.slice(part.from, part.to);
      const images = inlineFrames.slice(part.from, part.to).flatMap((frame, i) =>
        frame ? [{ ...frame, label: `Frame ${i + 1} (${partFrames[i].timestamp.toFixed(1)}s):` }] : [],
      );
      send({ type: "progress", part: index + 1, parts: parts.length, frames: partFrames.length });
      const result = await analyzeWith(
        makeGenerate(buildPrompt(documentName, partFrames), images, {
          endpoint: "process-document", requestId, document: documentName, frames: partFrames.length, uploadKb: uploadKb(images),
          timeoutMs: DOCUMENT_TIMEOUT_MS, signal: cancel.signal,
        }),
        partFrames,
        {
          models: getModelChain(),
          keyCount: clients.length,
          onEvent: logAttempt(req),
          signal: cancel.signal,
          onTry: (model, key, tryNumber) => send({ type: "progress", part: index + 1, parts: parts.length, model, key, try: tryNumber }),
        },
      );
      return { pages: result.pages, extra: result };
    });

    const last = extras[extras.length - 1];
    const usage = {
      model: last.model,
      inputTokens: extras.reduce((n, e) => n + e.usage.inputTokens, 0),
      outputTokens: extras.reduce((n, e) => n + e.usage.outputTokens, 0),
      thinkingTokens: extras.reduce((n, e) => n + e.usage.thinkingTokens, 0),
      keyIndex: last.keyIndex + 1,
      seconds: secondsSince(started),
      attempts: extras.flatMap((e) => e.attempts),
    };
    req.log.info({ usage, parts: parts.length, failedParts }, "Document analyzed");

    const used = new Set(pages.flatMap((page) => page.sourceFrameIndices));
    const result = {
      documentName,
      pages: pages.map((page) => ({ ...page, modelUsed: last.model })),
      selectedFrameCount: frames.length,
      discardedFrameCount: frames.length - used.size,
      processingNote: failedParts
        ? `${failedParts} of ${parts.length} parts of the capture could not be read; those pages are flagged.`
        : "Frames were filtered locally before Gemini checked their order, text, and confidence.",
      usage,
    };
    if (streaming) {
      send({ type: "result", result });
      res.end();
    } else {
      res.json(result);
    }
  } catch (error) {
    if (error instanceof CancelledError) {
      req.log.info({ requestId }, "Document analysis cancelled");
      if (!res.writableEnded) res.end();
      return;
    }
    req.log.error({ err: error }, "Document analysis failed");
    if (streaming) {
      const code = errorCode(error);
      send({ type: "error", error: MESSAGES[code], code });
      res.end();
    } else {
      sendError(res, errorCode(error));
    }
  }
});

// Rebuilds a single page from one retake photo, so it can replace a page that was hard to read.
router.post("/process-page", async (req, res) => {
  const parsed = ProcessPageBody.safeParse(req.body);
  const image = parsed.success ? parseDataUrl(parsed.data.dataUrl) : null;
  if (!parsed.success || !image || image.data.length > MAX_INLINE_FRAME_BYTES) {
    sendError(res, "bad_request", "That photo could not be read. Please try another one.");
    return;
  }
  if (!reserveGeminiRequest()) {
    sendError(res, "quota");
    return;
  }

  const { documentName, pageNumber } = parsed.data;
  const started = Date.now();
  try {
    const images = [{ ...image, label: "Frame 1:" }];
    const { pages, model, keyIndex, usage, attempts } = await analyzeWith(
      makeGenerate(buildPagePrompt(documentName, pageNumber), images, {
        endpoint: "process-page", requestId: newRequestId(), document: documentName, frames: 1, uploadKb: uploadKb(images), timeoutMs: PAGE_TIMEOUT_MS,
      }),
      [{ timestamp: 0, sharpness: 1, difference: 0 }],
      { models: getModelChain(), keyCount: clients.length, onEvent: logAttempt(req) },
    );
    req.log.info({ usage, pageNumber }, "Page rebuilt");
    res.json({
      page: { ...mainPage(pages), pageNumber, modelUsed: model },
      usage: { ...usage, keyIndex: keyIndex + 1, seconds: secondsSince(started), attempts },
    });
  } catch (error) {
    req.log.error({ err: error }, "Page analysis failed");
    sendError(res, errorCode(error));
  }
});

const secondsSince = (started: number) => Math.round((Date.now() - started) / 100) / 10;

function logAttempt(req: { log: { warn: (o: object, m: string) => void } }) {
  return ({ model, kind, attempt, error }: { model: string; kind: string; attempt: number; error: unknown }) =>
    req.log.warn(
      { model, kind, attempt, reason: error instanceof Error ? error.message.slice(0, 200) : String(error) },
      "Gemini attempt failed",
    );
}

function errorCode(error: unknown): ErrorResponseCode {
  if (!(error instanceof AllModelsFailedError)) return "unavailable";
  const kinds = error.failures.map((failure) => failure.kind);
  if (kinds.every((kind) => kind === "daily_quota" || kind === "rate_limit")) return "quota";
  if (kinds.includes("transient")) return "busy";
  if (kinds.includes("blocked")) return "blocked";
  if (kinds.includes("invalid_output")) return "invalid_output";
  return "unavailable";
}

function reserveGeminiRequest() {
  const now = Date.now();
  while (geminiRequestTimes[0] && now - geminiRequestTimes[0] >= 60_000) {
    geminiRequestTimes.shift();
  }
  if (geminiRequestTimes.length >= SAFE_REQUESTS_PER_MINUTE) return false;
  geminiRequestTimes.push(now);
  return true;
}

function parseDataUrl(value: string) {
  const match = value.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/);
  return match
    ? { mimeType: match[1] === "image/jpg" ? "image/jpeg" : match[1], data: match[2] }
    : null;
}

export default router;
