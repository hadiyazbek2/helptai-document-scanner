const DEFAULT_MODELS = ["gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.5-flash"];

// Ordered list of models to try. The first is preferred; the rest are fallbacks used
// when a model is busy, out of quota, or no longer available.
export function getModelChain(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env.GEMINI_MODELS ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_MODELS;
}
