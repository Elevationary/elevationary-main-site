// Cloudflare Pages Functions middleware — AI-bot UA detection (Decision #7
// Option A, ratified 2026-06-23). Runs on every Pages route (static asset
// or function) and tags requests by AI engine via response header +
// structured console log for Pages Analytics inspection.
//
// SOURCE-OF-TRUTH: src/_data/ai_bot_signatures.json. The signatures
// below are an INLINED COPY for Pages Functions bundling (functions/
// runtime cannot import from outside the functions/ tree under
// Cloudflare's esbuild config). When src/_data/ai_bot_signatures.json
// updates, update this file in the same PR; keep them in lockstep.
//
// Behavior:
//   - Match first signature whose substring appears (case-insensitive)
//     in the request's User-Agent header.
//   - On match: set X-AI-Bot header on the response with the engine name.
//   - On match: console.log a structured JSON line (Pages Functions logs
//     surface in the Cloudflare dashboard).
//   - No request blocking. No path-based gating. No PII captured —
//     User-Agent strings are public request metadata.

interface AiSignature {
  name: string;
  engine: string;
  userAgentPattern: string;
}

const AI_SIGNATURES: readonly AiSignature[] = [
  { name: "GPTBot", engine: "openai", userAgentPattern: "GPTBot" },
  { name: "ChatGPT-User", engine: "openai", userAgentPattern: "ChatGPT-User" },
  { name: "OAI-SearchBot", engine: "openai", userAgentPattern: "OAI-SearchBot" },
  { name: "ClaudeBot", engine: "anthropic", userAgentPattern: "ClaudeBot" },
  { name: "Claude-Web", engine: "anthropic", userAgentPattern: "Claude-Web" },
  { name: "anthropic-ai", engine: "anthropic", userAgentPattern: "anthropic-ai" },
  { name: "PerplexityBot", engine: "perplexity", userAgentPattern: "PerplexityBot" },
  { name: "Perplexity-User", engine: "perplexity", userAgentPattern: "Perplexity-User" },
  { name: "Google-Extended", engine: "google", userAgentPattern: "Google-Extended" },
  { name: "GoogleOther", engine: "google", userAgentPattern: "GoogleOther" },
  { name: "Bingbot", engine: "microsoft", userAgentPattern: "bingbot" },
  { name: "Applebot", engine: "apple", userAgentPattern: "Applebot" },
  { name: "Applebot-Extended", engine: "apple", userAgentPattern: "Applebot-Extended" },
  { name: "Bytespider", engine: "bytedance", userAgentPattern: "Bytespider" },
  { name: "Meta-ExternalAgent", engine: "meta", userAgentPattern: "meta-externalagent" },
  { name: "FacebookBot", engine: "meta", userAgentPattern: "facebookexternalhit" },
];

function detectAiSignature(userAgent: string | null): AiSignature | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  for (const sig of AI_SIGNATURES) {
    if (ua.includes(sig.userAgentPattern.toLowerCase())) {
      return sig;
    }
  }
  return null;
}

export const onRequest: PagesFunction = async (context) => {
  const { request, next } = context;
  const userAgent = request.headers.get("user-agent");
  const aiSig = detectAiSignature(userAgent);

  const response = await next();

  if (aiSig) {
    const url = new URL(request.url);
    const tagged = new Response(response.body, response);
    tagged.headers.set("X-AI-Bot", aiSig.name);
    tagged.headers.set("X-AI-Bot-Engine", aiSig.engine);
    console.log(
      JSON.stringify({
        event: "ai_bot_request",
        bot_name: aiSig.name,
        engine: aiSig.engine,
        path: url.pathname,
        status: response.status,
        user_agent: userAgent,
      }),
    );
    return tagged;
  }

  return response;
};
