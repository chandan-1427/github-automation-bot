import { env } from "./env.js";

export type AiTriageResult = {
  summary: string;
  suggestedLabel: string;
  priority: "low" | "medium" | "high";
};

/**
 * Calls Gemini's free-tier API to triage an issue or PR: a one-sentence
 * summary, a suggested label, and a priority. We ask for strict JSON
 * back and parse defensively, since a malformed model response should
 * degrade gracefully (skip the AI fields) rather than crash event
 * processing.
 */
export async function triageWithGemini(title: string, body: string): Promise<AiTriageResult | null> {
  if (!env.aiEnabled) return null;

  const prompt = `You are triaging a GitHub issue or pull request. Respond with ONLY raw JSON, no markdown fences, no commentary, matching exactly this shape:
{"summary": "<one sentence, max 20 words>", "suggestedLabel": "<a single short kebab-case label like 'bug' or 'enhancement' or 'question'>", "priority": "<low|medium|high>"}

Title: ${title}
Body: ${body.slice(0, 2000)}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 200 },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini request failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as any;
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;

  try {
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.summary || !parsed.suggestedLabel || !parsed.priority) return null;
    return parsed as AiTriageResult;
  } catch {
    console.warn("[gemini] Failed to parse AI response as JSON, skipping AI fields");
    return null;
  }
}
