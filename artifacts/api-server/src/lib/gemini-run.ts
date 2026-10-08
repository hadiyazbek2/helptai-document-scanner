import { parseModelResult, type AnalyzedPage, type FrameInfo } from "./analysis";
import { BlockedOutputError, InvalidOutputError, classifyGeminiError, runWithModelFallback, type FallbackEvent } from "./gemini-call";
import { buildTargets, parseTarget } from "./gemini-config";

export type PromptImage = { mimeType: string; data: string; label?: string };

// The parts of the request: the instructions, then each image preceded by its own label
// ("Frame 8 ..."). A label right next to its picture keeps the model from losing count when
// there are many frames, which a list of numbers ahead of all the images does not.
export function buildParts(prompt: string, images: PromptImage[]) {
  return [
    { text: prompt },
    ...images.flatMap((image) => [
      ...(image.label ? [{ text: image.label }] : []),
      { inlineData: { mimeType: image.mimeType, data: image.data } },
    ]),
  ];
}

export type Usage = { model: string; inputTokens: number; outputTokens: number; thinkingTokens: number };

// One try against one model on one key, for the developer view: which model and key answered,
// what failed before it, and how long it all took.
export type Attempt = { model: string; key: number; outcome: string; seconds: number };

// One call to Gemini, as the pieces we need from its response.
export type RawResponse = {
  text: string;
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number; thinkingTokens?: number };
};
export type GenerateFn = (target: { model: string; keyIndex: number }) => Promise<RawResponse>;

const BLOCKED_FINISH_REASONS = new Set(["RECITATION", "SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"]);

// Asks Gemini (trying each model on each key as needed) and turns its answer into pages.
export async function analyzeWith(
  generate: GenerateFn,
  frames: FrameInfo[],
  options: {
    models: string[];
    keyCount: number;
    onEvent?: (event: FallbackEvent) => void;
  },
): Promise<{ pages: AnalyzedPage[]; model: string; keyIndex: number; usage: Usage; attempts: Attempt[] }> {
  let usage: RawResponse["usage"];
  const attempts: Attempt[] = [];

  const readPages = async (target: string) => {
    const response = await generate(parseTarget(target));
    const reason = response.finishReason;
    if (reason === "MAX_TOKENS") throw new InvalidOutputError("Model output was cut off");
    if (reason && BLOCKED_FINISH_REASONS.has(reason)) throw new BlockedOutputError(reason);
    const pages = parseModelResult(response.text, frames);
    usage = response.usage;
    return pages;
  };

  const { result: pages, model: target } = await runWithModelFallback(
    buildTargets(options.models, options.keyCount),
    async (target) => {
      const { model, keyIndex } = parseTarget(target);
      const attempt: Attempt = { model, key: keyIndex + 1, outcome: "pending", seconds: 0 };
      attempts.push(attempt);
      const started = Date.now();
      try {
        const pages = await readPages(target);
        attempt.outcome = "ok";
        return pages;
      } catch (error) {
        attempt.outcome = classifyGeminiError(error) === "transient" ? "busy" : classifyGeminiError(error);
        throw error;
      } finally {
        attempt.seconds = Math.round((Date.now() - started) / 100) / 10;
      }
    },
    {
      onEvent: options.onEvent,
      // Busy is per model, not per key: after one "high demand" answer, try the next model rather
      // than the same model on another key. Every attempt counts against the free tier's small
      // daily request limit, even a busy one, so retries are kept to a minimum.
      groupOf: (target) => parseTarget(target).model,
      busyPerGroup: 1,
      attemptsPerModel: 2,
    },
  );
  const { model, keyIndex } = parseTarget(target);
  return {
    pages,
    model,
    keyIndex,
    attempts,
    usage: {
      model,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      thinkingTokens: usage?.thinkingTokens ?? 0,
    },
  };
}
