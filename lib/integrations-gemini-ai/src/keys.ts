// Collects every Gemini API key from the environment, so keys can be added without editing code.
// Accepted: GEMINI_API_KEYS (comma-separated), and any variable whose name starts with
// GEMINI_API_KEY (GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEYv1, ...). The first is tried first.
export function collectApiKeys(env: Record<string, string | undefined>): string[] {
  const clean = (value: string | undefined) => (value ?? "").trim().replace(/^["']|["']$/g, "");
  const single = Object.keys(env)
    .filter((name) => name.startsWith("GEMINI_API_KEY") && name !== "GEMINI_API_KEYS")
    // GEMINI_API_KEY itself first, then the rest in name order.
    .sort((a, b) => (a === "GEMINI_API_KEY" ? -1 : b === "GEMINI_API_KEY" ? 1 : a.localeCompare(b)))
    .map((name) => clean(env[name]));
  const listed = clean(env.GEMINI_API_KEYS).split(",").map(clean);
  return [...new Set([...single, ...listed].filter(Boolean))];
}
