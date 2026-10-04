import { Router, type IRouter, type Response } from "express";
import { ProcessDocumentBody, ProcessPageBody, type ErrorResponseCode } from "@helptai/api-zod";
import { clients } from "@helptai/integrations-gemini-ai";
import { buildPagePrompt, buildPrompt, mainPage, RESPONSE_SCHEMA } from "../lib/analysis";
import { AllModelsFailedError } from "../lib/gemini-call";
import { getModelChain } from "../lib/gemini-config";
import { analyzeWith, buildParts, type GenerateFn, type PromptImage } from "../lib/gemini-run";

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

// Builds the function that makes one real Gemini call for the given images and prompt.
function makeGenerate(prompt: string, images: PromptImage[]): GenerateFn {
  const contents = [{ role: "user" as const, parts: buildParts(prompt, images) }];
  return async ({ model, keyIndex }) => {
    const response = await clients[keyIndex].models.generateContent({
      model,
      contents,
      config: {
        maxOutputTokens: 16384,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    return {
      text: response.text ?? "",
      finishReason: response.candidates?.[0]?.finishReason ? String(response.candidates[0].finishReason) : undefined,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
        thinkingTokens: response.usageMetadata?.thoughtsTokenCount,
      },
    };
  };
}

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
    const { pages, model, usage } = await analyzeWith(
      makeGenerate(
        buildPrompt(documentName, frames),
        inlineFrames.flatMap((frame, index) =>
          frame ? [{ ...frame, label: `Frame ${index + 1} (${frames[index].timestamp.toFixed(1)}s):` }] : [],
        ),
      ),
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
    const { pages, model, usage } = await analyzeWith(
      makeGenerate(buildPagePrompt(documentName, pageNumber), [{ ...image, label: "Frame 1:" }]),
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
