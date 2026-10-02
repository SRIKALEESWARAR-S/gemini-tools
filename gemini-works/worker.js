const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    // 1. Handle CORS Preflight Requests from GitHub Pages
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    try {
      // 2. /api/trending Endpoint
      if (url.pathname === "/api/trending") {
        const cachedTrends = env.TRENDS_KV ? await env.TRENDS_KV.get("current_hashtags") : null;
        if (cachedTrends) {
          return new Response(cachedTrends, {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        return new Response(JSON.stringify({ trends: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 3. /api/generate Endpoint
      if (url.pathname === "/api/generate" && request.method === "POST") {
        if (!env.GEMINI_API_KEY) {
          return new Response(JSON.stringify({ error: "GEMINI_API_KEY missing in Cloudflare environment variables." }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const body = await request.json();
        const premise = body.premise || "";

        const systemPrompt = `Analyze the following core content premise: "${premise}".
Generate exactly 14 category-specific synopses/prompts across diverse domains (e.g., Executive Summary, Technical Architecture, Marketing Hook, Social Video Script, Educational Breakdown, Newsletter Lead, Developer Documentation, etc.).

Return ONLY a single valid JSON object following this exact schema:
{
  "categories": [
    {
      "category": "Category Name",
      "prompt": "Detailed synopsis/prompt action tailored for this category"
    }
  ]
}`;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;

        const geminiRes = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: systemPrompt }] }],
            generationConfig: {
              responseMimeType: "application/json"
            }
          })
        });

        if (!geminiRes.ok) {
          const errText = await geminiRes.text();
          return new Response(JSON.stringify({ error: `Gemini API returned error: ${errText}` }), {
            status: geminiRes.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const geminiData = await geminiRes.json();
        const responseJsonText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

        return new Response(responseJsonText, {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ error: "Route not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
