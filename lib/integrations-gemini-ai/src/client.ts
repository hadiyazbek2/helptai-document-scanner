import { GoogleGenAI } from "@google/genai";

const apiKey =
  process.env.AI_INTEGRATIONS_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error(
    "GEMINI_API_KEY must be set. Add it through the workspace Secrets panel.",
  );
}

export const ai = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL
  ? new GoogleGenAI({
      apiKey,
      httpOptions: {
        apiVersion: "",
        baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
      },
    })
  : new GoogleGenAI({ apiKey });
