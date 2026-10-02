export default {
  // 1. Cron Trigger: Automatically fetches live Indian news every 6 hours
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshTrendingHashtags(env));
  },

  // 2. API Endpoint Handler
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // GET /api/trending - Return cached 6-hour Indian trending topics
    if (url.pathname === '/api/trending' && request.method === 'GET') {
      let hashtags = await env.TRENDS_KV.get('current_hashtags');
      if (!hashtags) {
        hashtags = await refreshTrendingHashtags(env);
      }
      return new Response(hashtags, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // POST /api/generate - Generate 12-14 Category Synopses
    if (url.pathname === '/api/generate' && request.method === 'POST') {
      try {
        const { premise, hashtag, categories } = await request.json();

        const systemInstruction = `
You are an expert editorial strategist and newsroom prompt generator.
Take the core premise and selected hashtag, then adapt it into engaging, analytical content hooks across the provided categories.

Rules & Style Guidelines (Trained on Arré Voice Editorial Prompts):
- Ask thought-provoking, multi-perspective questions rather than simple summaries.
- Anchor each synopsis with the exact provided hashtag at the end (e.g., #HashtagName).
- Keep each synopsis between 25 and 40 words.
- Produce angles for 12 to 14 of the listed categories.

Example Reference:
Premise: "Renovated Gandhi Memorial Museum in Madurai reopened" | Hashtag: "#GandhiMemorialMuseum"
- Current Affairs: What should governments measure when public money is spent on restoring historically significant institutions? #GandhiMemorialMuseum
- Technology: Could AR, virtual tours and multilingual digital archives help visitors experience the museum beyond its physical galleries? #GandhiMemorialMuseum
- Education: How can schools use museum visits to encourage students to question, research and understand history more deeply? #GandhiMemorialMuseum
`;

        const promptText = `Core Premise: "${premise}"\nTarget Hashtag: "${hashtag}"\nAvailable Categories: ${categories}`;
        const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;

        const payload = {
          contents: [{ parts: [{ text: promptText }] }],
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                angles: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      category_name: { type: "STRING" },
                      synopsis: { type: "STRING" }
                    },
                    required: ["category_name", "synopsis"]
                  }
                }
              },
              required: ["angles"]
            }
          }
        };

        const apiResponse = await fetch(geminiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await apiResponse.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { 
          status: 500, 
          headers: corsHeaders 
        });
      }
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};

// Helper Function: Parses live Indian News RSS and extracts trending premises + hashtags via Gemini
async function refreshTrendingHashtags(env) {
  try {
    // Fetch live Google News RSS for India
    const rssRes = await fetch("https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en");
    const xmlText = await rssRes.text();

    // Extract item titles from XML
    const titleRegex = /<title>(.*?)<\/title>/g;
    let matches;
    const headlines = [];
    while ((matches = titleRegex.exec(xmlText)) !== null) {
      if (!matches[1].includes("Google News")) {
        headlines.push(matches[1]);
      }
      if (headlines.length >= 10) break;
    }

    // Pass top headlines to Gemini to structure into clean premises & hashtags
    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
    const prompt = `Convert these top Indian news headlines into 6 distinct editorial premises and CamelCase hashtags:\n\n${headlines.join('\n')}`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            trends: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  hashtag: { type: "STRING" },
                  premise: { type: "STRING" }
                },
                required: ["hashtag", "premise"]
              }
            }
          },
          required: ["trends"]
        }
      }
    };

    const res = await fetch(geminiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    const resultJson = data.candidates[0].content.parts[0].text;

    // Save result to Cloudflare KV cache
    await env.TRENDS_KV.put('current_hashtags', resultJson);
    return resultJson;

  } catch (e) {
    const fallback = JSON.stringify({
      trends: [
        { hashtag: "#AsianGames2026", premise: "India competing across shooting, archery, wrestling, and hockey" },
        { hashtag: "#Goldrate", premise: "Movement in gold prices affecting household finances and shopping habits" },
        { hashtag: "#TamilNaduWeather", premise: "Parts of Tamil Nadu experiencing above-normal daytime temperatures" }
      ]
    });
    return fallback;
  }
}
