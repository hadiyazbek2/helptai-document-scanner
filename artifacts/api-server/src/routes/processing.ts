import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { ProcessDocumentBody, ProcessPageBody, type ErrorResponseCode } from "@helptai/api-zod";
import { clients } from "@helptai/integrations-gemini-ai";
import { buildPagePrompt, buildPrompt, mainPage, RESPONSE_SCHEMA } from "../lib/analysis";
import { AllModelsFailedError } from "../lib/gemini-call";
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

type CallContext = { endpoint: string; requestId: string; document: string; frames: number; uploadKb: number };

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
    try {
      const response = await clients[keyIndex].models.generateContent({
        model,
        contents,
        config: {
          maxOutputTokens: 16384,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      });
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

  try {
    const images = inlineFrames.flatMap((frame, index) =>
      frame ? [{ ...frame, label: `Frame ${index + 1} (${frames[index].timestamp.toFixed(1)}s):` }] : [],
    );
    const { pages, model, usage } = await analyzeWith(
      makeGenerate(buildPrompt(documentName, frames), images, {
        endpoint: "process-document", requestId: newRequestId(), document: documentName, frames: frames.length, uploadKb: uploadKb(images),
      }),
      frames,
      { models: getModelChain(), keyCount: clients.length, onEvent: logAttempt(req) },
    );
    req.log.info({ usage }, "Document analyzed");

    const used = new Set(pages.flatMap((page) => page.sourceFrameIndices));
    res.json({
      documentName,
      pages: pages.map((page) => ({ ...page, modelUsed: model })),
      selectedFrameCount: frames.length,
      discardedFrameCount: frames.length - used.size,
      processingNote:
        "Frames were filtered locally before Gemini checked their order, text, and confidence.",
      usage,
    });
  } catch (error) {
    req.log.error({ err: error }, "Document analysis failed");
    sendError(res, errorCode(error));
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
  try {
    const images = [{ ...image, label: "Frame 1:" }];
    const { pages, model, usage } = await analyzeWith(
      makeGenerate(buildPagePrompt(documentName, pageNumber), images, {
        endpoint: "process-page", requestId: newRequestId(), document: documentName, frames: 1, uploadKb: uploadKb(images),
      }),
      [{ timestamp: 0, sharpness: 1, difference: 0 }],
      { models: getModelChain(), keyCount: clients.length, onEvent: logAttempt(req) },
    );
    req.log.info({ usage, pageNumber }, "Page rebuilt");
    res.json({ page: { ...mainPage(pages), pageNumber, modelUsed: model }, usage });
  } catch (error) {
    req.log.error({ err: error }, "Page analysis failed");
    sendError(res, errorCode(error));
  }
});

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
