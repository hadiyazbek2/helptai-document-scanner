import { GoogleGenAI } from "@google/genai";
import { collectApiKeys } from "./keys";

const apiKeys = collectApiKeys(process.env);

if (!apiKeys.length) {
  throw new Error(
    "No Gemini API key found. Copy .env.example to .env and add GEMINI_API_KEY (more keys: GEMINI_API_KEY_2, ...).",
  );
}

// One client per key. With several, the server moves to the next key when one runs out of quota.
export const clients = apiKeys.map((apiKey) => new GoogleGenAI({ apiKey }));
export const ai = clients[0];
