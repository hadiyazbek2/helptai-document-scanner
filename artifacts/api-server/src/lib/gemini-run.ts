import { parseModelResult, type AnalyzedPage, type FrameInfo } from "./analysis";
import { BlockedOutputError, InvalidOutputError, runWithModelFallback, type FallbackEvent } from "./gemini-call";
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
): Promise<{ pages: AnalyzedPage[]; model: string; usage: Usage }> {
  let usage: RawResponse["usage"];
  const { result: pages, model: target } = await runWithModelFallback(
    buildTargets(options.models, options.keyCount),
    async (target) => {
      const response = await generate(parseTarget(target));
      const reason = response.finishReason;
      if (reason === "MAX_TOKENS") throw new InvalidOutputError("Model output was cut off");
      if (reason && BLOCKED_FINISH_REASONS.has(reason)) throw new BlockedOutputError(reason);
      const pages = parseModelResult(response.text, frames);
      usage = response.usage;
      return pages;
    },
    { onEvent: options.onEvent },
  );
  const { model } = parseTarget(target);
  return {
    pages,
    model,
    usage: {
      model,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      thinkingTokens: usage?.thinkingTokens ?? 0,
    },
  };
}
