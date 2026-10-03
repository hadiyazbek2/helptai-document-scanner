import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error(
    "GEMINI_API_KEY must be set. Copy .env.example to .env and add your key.",
  );
}

export const ai = new GoogleGenAI({ apiKey });
