import { Router, type IRouter } from "express";
import { ProcessDocumentBody } from "@workspace/api-zod";
import { ai } from "@workspace/integrations-gemini-ai";

const router: IRouter = Router();

const MAX_INLINE_FRAME_BYTES = 1_150_000;

router.post("/process-document", async (req, res) => {
  const parsed = ProcessDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The selected frames could not be read." });
    return;
  }

  const { documentName, frames } = parsed.data;
  const inlineFrames = frames.map((frame) => parseDataUrl(frame.dataUrl));
  if (
    inlineFrames.some(
      (frame) => !frame || frame.data.length > MAX_INLINE_FRAME_BYTES,
    )
  ) {
    res.status(400).json({
      error: "One of the selected frames is too large to analyze.",
    });
    return;
  }

  const prompt = buildPrompt(documentName, frames);
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            ...inlineFrames.flatMap((frame) =>
              frame
                ? [
                    {
                      inlineData: {
                        mimeType: frame.mimeType,
                        data: frame.data,
                      },
                    },
                  ]
                : [],
            ),
          ],
        },
      ],
      config: {
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    });

    const result = parseModelResult(response.text ?? "");
    if (!result) {
      req.log.error("Gemini returned an invalid document analysis");
      res.status(502).json({ error: "The document could not be reconstructed." });
      return;
    }

    res.json({
      documentName,
      pages: result.pages,
      selectedFrameCount: frames.length,
      discardedFrameCount: Math.max(0, frames.length - result.pages.length),
      processingNote:
        "Frames were filtered locally before Gemini checked their order, text, and confidence.",
    });
  } catch (error) {
    req.log.error({ err: error }, "Document analysis failed");
    res.status(502).json({
      error:
        "The document could not be analyzed right now. Your original capture is still on this device.",
    });
  }
});

function parseDataUrl(value: string) {
  const match = value.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/);
  return match
    ? { mimeType: match[1] === "image/jpg" ? "image/jpeg" : match[1], data: match[2] }
    : null;
}

function buildPrompt(
  documentName: string,
  frames: Array<{
    timestamp: number;
    sharpness: number;
    difference: number;
  }>,
) {
  const frameNotes = frames
    .map(
      (frame, index) =>
        `Frame ${index + 1}: ${frame.timestamp.toFixed(2)}s, local sharpness ${frame.sharpness.toFixed(2)}, visual change from prior candidate ${frame.difference.toFixed(2)}`,
    )
    .join("\n");

  return `You are reconstructing a document for helptai. The user recorded one continuous scroll through a book or bound document. The images are ordered candidate frames, already filtered locally for blur and near-duplicates.

Document name: ${documentName}

${frameNotes}

Inspect the images in sequence. Combine overlapping frames into logical pages or sections. Do not invent content. For each reconstructed page, return:
- pageNumber: 1-based order
- title: a short descriptive title, or "Untitled page"
- text: the readable text from that page, preserving paragraphs where possible
- confidence: a number from 0 to 1 based on readability, completeness, and overlap
- needsReview: true when text is materially hard to read, the page is incomplete, or the sequence has a gap
- reviewReason: a calm, plain-language explanation when needsReview is true, otherwise null

Return only JSON in this exact shape:
{"pages":[{"pageNumber":1,"title":"...","text":"...","confidence":0.92,"needsReview":false,"reviewReason":null}]}

Keep the page list concise. If several candidate frames show the same page, merge them.`;
}

function parseModelResult(text: string) {
  try {
    const cleaned = text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "");
    const value: unknown = JSON.parse(cleaned);
    if (!value || typeof value !== "object" || !Array.isArray((value as { pages?: unknown }).pages)) {
      return null;
    }
    const pages = (value as { pages: unknown[] }).pages
      .map((page, index) => normalizePage(page, index))
      .filter((page): page is NonNullable<typeof page> => page !== null);
    return pages.length ? { pages } : null;
  } catch {
    return null;
  }
}

function normalizePage(value: unknown, index: number) {
  if (!value || typeof value !== "object") return null;
  const page = value as Record<string, unknown>;
  const confidence = Number(page.confidence);
  if (!Number.isFinite(confidence)) return null;
  const normalizedConfidence = Math.max(0, Math.min(1, confidence));
  const needsReview =
    page.needsReview === true || normalizedConfidence < 0.72;
  return {
    pageNumber: Number.isInteger(page.pageNumber) && Number(page.pageNumber) > 0
      ? Number(page.pageNumber)
      : index + 1,
    title: typeof page.title === "string" && page.title.trim()
      ? page.title.trim()
      : "Untitled page",
    text: typeof page.text === "string" ? page.text.trim() : "",
    confidence: normalizedConfidence,
    needsReview,
    reviewReason: needsReview
      ? typeof page.reviewReason === "string" && page.reviewReason.trim()
        ? page.reviewReason.trim()
        : "The text was hard to read from the capture."
      : null,
  };
}

export default router;