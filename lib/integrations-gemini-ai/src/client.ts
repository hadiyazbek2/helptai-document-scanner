import { GoogleGenAI } from "@google/genai";

// One or more API keys. With several, the server moves to the next key when one runs out of
// quota. GEMINI_API_KEYS is a comma-separated list; GEMINI_API_KEY (a single key) also works.
const apiKeys = (process.env.GEMINI_API_KEYS ?? process.env.GEMINI_API_KEY ?? "")
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);

if (!apiKeys.length) {
  throw new Error(
    "GEMINI_API_KEY (or GEMINI_API_KEYS) must be set. Copy .env.example to .env and add your key.",
  );
}

export const clients = apiKeys.map((apiKey) => new GoogleGenAI({ apiKey }));
export const ai = clients[0];
