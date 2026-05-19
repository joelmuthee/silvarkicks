// ThriftLux API Worker
// Public:
//   GET  /api/bags                 → { bags, settings }
//   GET  /img/:filename            → image binary (served from KV)
// Admin (Authorization: Bearer <ADMIN_TOKEN>):
//   POST /api/bulk                 → replace { bags, settings }
//   POST /api/image                → upload image, returns { path }
//
// Storage (KV binding "BAGS"):
//   "data"        → JSON { bags, settings }
//   "img:<name>"  → base64 string of image binary
//   "mime:<name>" → mime type for the corresponding image

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...extra },
  });

const isAuthed = (req, env) => {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  return env.ADMIN_TOKEN && auth.slice(7).trim() === env.ADMIN_TOKEN;
};

const b64ToBytes = (b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

// Decode HTML entities IG slathers across og:description and the embed Caption
// div. Named entities + decimal (&#064;) + hex (&#x40;). Without this, captions
// contain literal "&#064;" instead of "@", which breaks admin's @<price> parser.
const decodeEntities = (s) => (s || "")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));

// ---- Caption → brand/category/stock heuristics for IG sync ----
// Order matters: specific models before generic brand fallbacks.
const SHOE_BRANDS = [
  ["nike air force",   "Nike Air Force",    "Sneakers"],
  ["air force",        "Nike Air Force",    "Sneakers"],
  ["nike air max",     "Nike Air Max",      "Sports/Athletic"],
  ["air max",          "Nike Air Max",      "Sports/Athletic"],
  ["nike cortez",      "Nike Cortez",       "Sneakers"],
  ["cortez",           "Nike Cortez",       "Sneakers"],
  ["nike react",       "Nike React",        "Sports/Athletic"],
  ["nike flight",      "Nike Flight",       "Sports/Athletic"],
  ["nike dunk",        "Nike Dunk",         "Sneakers"],
  ["nike pegasus",     "Nike Pegasus",      "Sports/Athletic"],
  ["pegasus",          "Nike Pegasus",      "Sports/Athletic"],
  ["nike free",        "Nike Free",         "Sports/Athletic"],
  ["nike vapormax",    "Nike Vapormax",     "Sports/Athletic"],
  ["vapormax",         "Nike Vapormax",     "Sports/Athletic"],
  ["nike huarache",    "Nike Huarache",     "Sports/Athletic"],
  ["huarache",         "Nike Huarache",     "Sports/Athletic"],
  ["nike sb",          "Nike SB",           "Sneakers"],
  ["nike zoom",        "Nike Zoom",         "Sports/Athletic"],
  ["hyperdunk",        "Nike Hyperdunk",    "Sports/Athletic"],
  ["nike kyrie",       "Nike Kyrie",        "Sports/Athletic"],
  ["kyrie",            "Nike Kyrie",        "Sports/Athletic"],
  ["air 270",          "Nike Air 270",      "Sports/Athletic"],
  ["nike 270",         "Nike Air 270",      "Sports/Athletic"],
  ["nike air",         "Nike Air",          "Sports/Athletic"],
  ["nike tn",          "Nike TN",           "Sneakers"],
  [/\btn\b/,           "Nike TN",           "Sneakers"],
  [/\btn\.\./,         "Nike TN",           "Sneakers"],
  ["jordan 1",         "Jordan 1",          "Sports/Athletic"],
  ["jordan 3",         "Jordan 3",          "Sports/Athletic"],
  ["jordan 4",         "Jordan 4",          "Sports/Athletic"],
  ["jordan 11",        "Jordan 11",         "Sports/Athletic"],
  ["jordan 13",        "Jordan 13",         "Sports/Athletic"],
  ["js13",             "Jordan 13",         "Sports/Athletic"],
  ["js1 ",             "Jordan 1",          "Sports/Athletic"],
  ["js1.",             "Jordan 1",          "Sports/Athletic"],
  ["jordan",           "Jordan",            "Sports/Athletic"],
  ["adidas gazelle",   "Adidas Gazelle",    "Sneakers"],
  ["gazelle",          "Adidas Gazelle",    "Sneakers"],
  ["adidas samba",     "Adidas Samba",      "Sneakers"],
  ["samba",            "Adidas Samba",      "Sneakers"],
  ["adidas samoa",     "Adidas Samoa",      "Sneakers"],
  ["samoa",            "Adidas Samoa",      "Sneakers"],
  ["stan smith",       "Adidas Stan Smith", "Sneakers"],
  ["adidas spezial",   "Adidas Spezial",    "Sneakers"],
  ["adidas superstar", "Adidas Superstar",  "Sneakers"],
  ["adidas ultraboost","Adidas Ultraboost", "Sports/Athletic"],
  ["adidas yeezy",     "Adidas Yeezy",      "Sports/Athletic"],
  ["yeezy",            "Adidas Yeezy",      "Sports/Athletic"],
  ["d rose",           "Adidas D Rose",     "Sports/Athletic"],
  ["drose",            "Adidas D Rose",     "Sports/Athletic"],
  ["adidas",           "Adidas",            "Sneakers"],
  ["under armour",     "Under Armour",      "Sports/Athletic"],
  ["under urmer",      "Under Armour",      "Sports/Athletic"],
  ["under armer",      "Under Armour",      "Sports/Athletic"],
  ["helly hansen",     "Helly Hansen",      "Sneakers"],
  [/\bhh\b/,           "Helly Hansen",      "Sneakers"],
  [/\bhh\.\./,         "Helly Hansen",      "Sneakers"],
  ["puma",             "Puma",              "Sports/Athletic"],
  ["new balance",      "New Balance",       "Sports/Athletic"],
  ["nb.",              "New Balance",       "Sports/Athletic"],
  ["nb ",              "New Balance",       "Sports/Athletic"],
  ["asics",            "Asics",             "Sports/Athletic"],
  ["reebok",           "Reebok",            "Sports/Athletic"],
  ["fila",             "Fila",              "Sneakers"],
  ["vans",             "Vans",              "Sneakers"],
  ["converse",         "Converse",          "Sneakers"],
  ["timberland",       "Timberland",        "Boots"],
  ["dr martens",       "Dr Martens",        "Boots"],
  ["doc martens",      "Dr Martens",        "Boots"],
  ["clark",            "Clarks",            "Loafers"],
  ["ugg",              "UGG",               "Boots"],
  ["lugz",             "Lugz",              "Boots"],
  ["aldo",             "Aldo",              "Loafers"],
  [/\bcat\b/,          "CAT",               "Boots"],
  ["polo",             "Polo",              "Sneakers"],
  ["levis",            "Levi's",            "Sneakers"],
  ["levi's",           "Levi's",            "Sneakers"],
  ["zaraman",          "Zara",              "Sneakers"],
  ["zara",             "Zara",              "Sneakers"],
  ["nike",             "Nike",              "Sneakers"],
  ["loafer",           null,                "Loafers"],
  ["boot",             null,                "Boots"],
  ["slide",            null,                "Slides"],
];

function deriveBrand(caption) {
  let text = (caption || "").toLowerCase().trim();
  text = text.replace(/^[a-z0-9._]+ /, "");  // strip leading "username "
  const padded = " " + text + " ";
  for (const [key, name, cat] of SHOE_BRANDS) {
    if (key instanceof RegExp) {
      if (key.test(padded)) return [name, cat];
    } else if (padded.includes(key)) {
      return [name, cat];
    }
  }
  return [null, null];
}

function parseCaptionForBag(caption) {
  const text = (caption || "").trim();
  const lower = text.toLowerCase();
  const cleaned = text.split(/whastup|whatsapp|wa\.me|0746/i)[0].trim().replace(/[.\s]+$/, "");
  let [brand, category] = deriveBrand(caption);
  if (!brand) {
    const first = cleaned.split(/\.\.|,|\n/)[0].trim();
    brand = first ? first.slice(0, 40).replace(/\b\w/g, c => c.toUpperCase()) : "Pre-loved Pair";
    category = category || "Sneakers";
  }
  const stock = {};
  const mUk = lower.match(/(\d{1,2}(?:\.\d)?)\s*uk/) || lower.match(/uk\s*(\d{1,2}(?:\.\d)?)/);
  const mEu = lower.match(/(\d{2,3}(?:\.\d)?)\s*(?:euro|eu)\b/) || lower.match(/#\s*(\d{2,3})/);
  const mSize = lower.match(/\bsize\s+(\d{2,3})\b/);
  if (mUk) {
    const n = mUk[1];
    if (!n.includes(".") && +n >= 4 && +n <= 13) stock[`UK${+n}`] = 1;
    else stock[`UK${n}`] = 1;
  }
  if (mEu) stock[`EU ${mEu[1]}`] = 1;
  if (!mUk && mSize) {
    const n = +mSize[1];
    if (n >= 30 && n <= 50) stock[`EU ${n}`] = 1;
  }
  if (!Object.keys(stock).length) stock["One Size"] = 1;
  return { name: brand, category: category || "Sneakers", stock, description: "Hand-picked. Inspected. One pair, photographed exactly as it is. Worldwide delivery." };
}

function looksLikeProduct(caption) {
  if (!caption) return false;
  const lower = caption.toLowerCase();
  if (/\d+\s*(?:uk|euro|eu)\b|\bsize\s+\d|#\s*\d{2,3}/.test(lower)) return true;
  for (const [key] of SHOE_BRANDS) {
    if (key instanceof RegExp ? key.test(lower) : lower.includes(key)) return true;
  }
  return false;
}

// Vision-model classifier — looks at the actual shoe photo + caption.
// Llama 3.2 Vision (Workers AI free tier) sees the image, so it can tell
// sneakers from slides from boots even when the caption is just "Size..11#45".
// Returns { is_shoe, name, category, reason } or null on failure.
async function classifyPostWithVision(env, caption, imageUrl) {
  if (!env.AI || !imageUrl) return null;
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return { _debug: `img fetch ${imgRes.status}` };
    const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
    const trimmed = (caption || "").replace(/\s+/g, " ").slice(0, 400);
    const prompt = `You sort Instagram posts from a thrift shoe shop. You're given ONE photo + ONE caption. Decide:
1. Is this a single pair of shoes for sale? (is_shoe true|false)
2. What brand/model is it? (name — short, e.g. "Nike Air Force", or "Pre-loved Pair" if unknown)
3. What category? Pick exactly one: Sneakers, Sports/Athletic, Boots, Loafers, Formal, Slides, Other. NEVER use Heels or Sandals — Silvarkicks doesn't stock those.

Category guide:
- Sneakers: casual lifestyle shoes — Air Force, Cortez, Stan Smith, Gazelle, Vans, Converse, Samba.
- Sports/Athletic: running/training/basketball — Air Max, React, Pegasus, Hyperdunk, Jordan, Puma running, New Balance, Under Armour, Kyrie, D Rose.
- Boots: ankle-high or taller — Timberland, Dr Martens, UGG, Lugz, CAT, work boots, hiking boots, chukka.
- Loafers: slip-on dress shoes, penny loafers, mocassins — Clarks, Aldo loafers.
- Formal: oxford, derby, brogue, dress shoes.
- Slides: open-toe slip-ons, pool slides, rubber sliders, flip-flops.
- Other: anything genuinely unclassifiable (rare). Use this rather than Heels/Sandals.

is_shoe=false ONLY for: shop intros, marketing slides, owner photos, announcements. Posts with a size signal (#45, 9uk, EU 42, size N) are ALWAYS shoes even if the brand isn't clear.

Decode shorthand: Tn=Nike TN, Hh=Helly Hansen, Js13=Jordan 13, Js1=Jordan 1, Drose=Adidas D Rose, Nb=New Balance, "Under urmer"=Under Armour, Cat=CAT boots.

Caption: """${trimmed}"""

Reply with strict minified JSON, no prose, no code fences:
{"is_shoe":true|false,"name":"<brand+model or Pre-loved Pair>","category":"<one from the list>","reason":"<3-6 words>"}`;
    // Workers AI llama-3.2-vision wants the image as a byte array on `image`
    // and the textual prompt on `prompt`. Not OpenAI-style messages.
    const result = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
      prompt,
      image: Array.from(imgBytes),
      max_tokens: 200,
      temperature: 0.1,
    });
    // Vision response shape varies by Workers AI build. Sometimes it's already
    // a parsed object (response = {is_shoe, name, ...}), sometimes a JSON string.
    let parsed = null;
    if (result?.response && typeof result.response === "object") {
      parsed = result.response;
    } else {
      let text = "";
      if (typeof result?.response === "string") text = result.response;
      else if (typeof result?.description === "string") text = result.description;
      else if (typeof result === "string") text = result;
      text = text.trim();
      if (text) {
        const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (m) {
          try { parsed = JSON.parse(m[0]); } catch (_) {}
        }
      }
    }
    if (!parsed) return { _debug: "could not parse vision output", raw: JSON.stringify(result).slice(0, 400) };
    return {
      is_shoe: !!parsed.is_shoe,
      name: parsed.name || null,
      category: parsed.category || null,
      reason: parsed.reason || "",
      via: "vision",
    };
  } catch (err) {
    return { _debug: `vision throw: ${err.message}` };
  }
}

function arrayToB64(buf) {
  let s = "";
  const CHUNK = 8192;
  for (let i = 0; i < buf.length; i += CHUNK) {
    s += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

// Text-only LLM classifier — fallback when the vision call fails.
// Returns { is_shoe: bool, name: string|null, category: string|null, reason: string }.
// Falls through gracefully if AI is unavailable or rate-limited.
async function classifyPostWithAi(env, caption) {
  if (!env.AI || !caption) return null;
  const trimmed = caption.replace(/\s+/g, " ").slice(0, 400);
  const prompt = `You sort Instagram posts from a thrift shoe shop (Silvarkicks Store). Each post is either ONE specific pair of shoes listed for sale, OR a non-product post. Reply with strict minified JSON only, no prose, no code fences.

Schema:
{"is_shoe": true|false, "name": "<short brand + model OR generic descriptor>", "category": "<one of: Sneakers, Sports/Athletic, Boots, Loafers, Formal, Slides, Other>", "reason": "<3-6 words>"}

NEVER output "Heels" or "Sandals" — Silvarkicks does not stock those categories.

Rules (read carefully):
- The shop posts a SINGLE pair per listing. Captions are short, often only a brand/model + size + a WhatsApp number. Examples that are ALL shoes (is_shoe=true): "Air force..10uk 45euro", "Nike cortez.. size 42", "Tn..9uk 44euro", "Hh..11uk 46euro", "Js13..6uk 40euro", "Size..11#45", "Size..8#42", "Puma..6.5uk 40euro", "Aldo..size 42 to 47".
- is_shoe = true whenever there is a size signal (UK/EU/euro/# followed by a number, or the word "size" + a number). Even if no brand is named, the post is a shoe. Use "Pre-loved Pair" as the name in that case.
- is_shoe = false ONLY for: shop intros, owner photos, marketing slides, restock-coming-soon announcements, greetings, holiday posts, anything without any size or shoe brand. Example (is_shoe=false): "Silvarkicks_store.. Whastup 0746262400" (shop intro, no shoe).
- Decode shorthand: "Tn" = Nike TN; "Hh" = Helly Hansen; "Js13" = Jordan 13; "Js1" = Jordan 1; "Drose" = Adidas D Rose; "Nb" / "Nb." = New Balance; "Under urmer"/"Under armer" = Under Armour; "Cat" (standalone) = CAT boots; "Air force" = Nike Air Force; "Air max" = Nike Air Max; "Cortez" = Nike Cortez; "Gazelle" = Adidas Gazelle; "Samba"/"Samoa" = Adidas; "Stan smith" = Adidas Stan Smith.
- name MUST be brand+model when known, never "Size" or "Tn" or "Hh" verbatim. Strip sizes/phone numbers. If truly unknown brand but a size exists, name = "Pre-loved Pair".
- category: match the model to one of the listed options. Defaults: Air Force/Cortez/Gazelle/Samba/Samoa/Stan Smith/Vans/Converse/Zara/Levi's/Polo = Sneakers; Air Max/React/Flight/Zoom/Hyperdunk/Vapormax/Pegasus/Huarache/Kyrie/D Rose/Jordan/Puma/Asics/Reebok/New Balance/Under Armour = Sports/Athletic; Timberland/Dr Martens/UGG/Lugz/CAT = Boots; Clarks/Aldo = Loafers.

Caption: """${trimmed}"""`;
  try {
    const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 120,
    });
    const text = (result?.response || "").trim();
    // Strip code fences if the model wraps the JSON
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    return {
      is_shoe: !!parsed.is_shoe,
      name: parsed.name || null,
      category: parsed.category || null,
      reason: parsed.reason || "",
    };
  } catch (_) {
    return null;
  }
}

// Feed-fetch helper — module-level so /api/ig-feed AND /api/ig-discover share
// the same logic. Workers can't fetch() their own URL (error 1042), so the
// only way to share is via a plain function.
async function fetchIgFeed({ username, userId: directUserId, count = 50, maxId = "" } = {}) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
    "X-IG-App-ID": "936619743392459",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": `https://www.instagram.com/${username || ""}/`,
  };
  let userId, user = null, profile = null;
  if (directUserId) {
    userId = directUserId;
    profile = { id: userId, username: username || null };
  } else {
    const pRes = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, { headers });
    if (!pRes.ok) return { error: `profile lookup ${pRes.status}` };
    const pData = await pRes.json();
    user = pData?.data?.user;
    if (!user?.id) return { error: "user id not found" };
    userId = user.id;
    profile = {
      id: userId,
      username: user.username,
      fullName: user.full_name,
      biography: user.biography,
      profilePicUrl: user.profile_pic_url_hd || user.profile_pic_url,
      followers: user.edge_followed_by?.count,
    };
  }
  const qsTail = `?count=${count}${maxId ? `&max_id=${encodeURIComponent(maxId)}` : ""}`;
  let items = [];
  let moreAvailable = false;
  let nextMaxId = null;
  const embedded = user?.edge_owner_to_timeline_media;
  if (!maxId && embedded?.edges?.length) {
    items = embedded.edges.map(({ node }) => extractFromTimelineNode(node)).filter(it => it.imageUrl);
    moreAvailable = !!embedded.page_info?.has_next_page;
    nextMaxId = embedded.page_info?.end_cursor || null;
  }
  if (items.length < count && (maxId || moreAvailable || directUserId)) {
    const cursor = maxId || nextMaxId;
    const variables = encodeURIComponent(JSON.stringify({ id: userId, first: count, after: cursor || null }));
    const gqlRes = await fetch(`https://www.instagram.com/graphql/query/?query_hash=003056d32c2554def87228bc3fd9668a&variables=${variables}`, { headers });
    if (gqlRes.ok) {
      const gData = await gqlRes.json();
      const media = gData?.data?.user?.edge_owner_to_timeline_media;
      if (media?.edges?.length) {
        items = items.concat(media.edges.map(({ node }) => extractFromTimelineNode(node)).filter(it => it.imageUrl));
        moreAvailable = !!media.page_info?.has_next_page;
        nextMaxId = media.page_info?.end_cursor || null;
      }
    }
  }
  if (!items.length) {
    let fRes = await fetch(`https://www.instagram.com/api/v1/feed/user/${userId}/${qsTail}`, { headers });
    if (!fRes.ok) fRes = await fetch(`https://i.instagram.com/api/v1/feed/user/${userId}/${qsTail}`, { headers });
    if (!fRes.ok) return { error: `feed fetch ${fRes.status}`, profile };
    const fData = await fRes.json();
    items = (fData.items || []).map(extractFromFeedItem).filter(it => it.imageUrl);
    moreAvailable = !!fData.more_available;
    nextMaxId = fData.next_max_id || null;
  }
  return { profile, items, count: items.length, more_available: moreAvailable, next_max_id: nextMaxId };
}

// IG response normalisers — kept module-level so /api/ig-feed can mix sources.
function extractFromTimelineNode(node) {
  const shortcode = node.shortcode || node.code;
  let imageUrls = [];
  const children = node.edge_sidecar_to_children?.edges || [];
  if (children.length) {
    imageUrls = children.map(({ node: c }) => c.display_url || c.image_versions2?.candidates?.[0]?.url).filter(Boolean);
  } else if (node.display_url) {
    imageUrls = [node.display_url];
  } else if (node.image_versions2?.candidates?.length) {
    imageUrls = [node.image_versions2.candidates[0].url];
  }
  const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text || node.caption?.text || "";
  return {
    shortcode,
    imageUrl: imageUrls[0],
    imageUrls,
    caption,
    isCarousel: imageUrls.length > 1,
    postUrl: `https://www.instagram.com/p/${shortcode}/`,
    takenAt: node.taken_at_timestamp ? new Date(node.taken_at_timestamp * 1000).toISOString() : (node.taken_at ? new Date(node.taken_at * 1000).toISOString() : null),
  };
}

function extractFromFeedItem(m) {
  const carousel = m.carousel_media || [];
  let imageUrls = [];
  if (carousel.length) {
    imageUrls = carousel.map(c => c.image_versions2?.candidates?.[0]?.url).filter(Boolean);
  } else if (m.image_versions2?.candidates?.length) {
    imageUrls = [m.image_versions2.candidates[0].url];
  }
  const shortcode = m.code;
  const caption = m.caption?.text || "";
  return {
    shortcode,
    imageUrl: imageUrls[0],
    imageUrls,
    caption,
    isCarousel: imageUrls.length > 1,
    postUrl: `https://www.instagram.com/p/${shortcode}/`,
    takenAt: m.taken_at ? new Date(m.taken_at * 1000).toISOString() : null,
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // --- Public reads ---
    if (request.method === "GET" && path === "/api/bags") {
      const raw = await env.BAGS.get("data");
      const data = raw ? JSON.parse(raw) : { bags: [], settings: {} };
      return json(data, 200, { "Cache-Control": "public, max-age=10" });
    }

    const imgMatch = path.match(/^\/img\/(.+)$/);
    if (request.method === "GET" && imgMatch) {
      const name = decodeURIComponent(imgMatch[1]);
      const b64 = await env.BAGS.get(`img:${name}`);
      if (!b64) return new Response("Not found", { status: 404, headers: CORS });
      const mime = (await env.BAGS.get(`mime:${name}`)) || "image/jpeg";
      return new Response(b64ToBytes(b64), {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Cache-Control": "public, max-age=31536000, immutable",
          ...CORS,
        },
      });
    }

    if (path === "/api/health") {
      return json({ ok: true, time: new Date().toISOString() });
    }

    // Buyer capture → forward to GHL form submit (server-side, no CORS or captcha popup)
    if (request.method === "POST" && path === "/api/buyer") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
      const { name, phone, notes, bag_name, bag_price, captchaV3 } = body;
      if (!name && !phone) return json({ error: "name or phone required" }, 400);
      const fd = new FormData();
      fd.append("formData", JSON.stringify({
        first_name: name || "",
        phone: phone || "",
        multi_line_280v: [notes, bag_name && `Bag: ${bag_name} (Ksh ${bag_price})`].filter(Boolean).join(" | "),
      }));
      fd.append("locationId", "aTZHRdo8ius6WBzGQ5GD");
      fd.append("formId", "BWrG36c6p56ATDThPdN7");
      fd.append("eventData", JSON.stringify({
        source: "thriftlux-admin",
        type: "page-visit",
        domain: "thriftlux-ke.pages.dev",
      }));
      if (captchaV3) fd.append("captchaV3", captchaV3);
      try {
        const r = await fetch("https://backend.leadconnectorhq.com/forms/submit", {
          method: "POST",
          headers: {
            "Origin": "https://link.essenceautomations.com",
            "Referer": "https://link.essenceautomations.com/widget/form/BWrG36c6p56ATDThPdN7",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
          body: fd,
        });
        const text = await r.text().catch(() => "");
        return json({ ok: r.ok, status: r.status, body: text.slice(0, 500) });
      } catch (err) {
        return json({ ok: false, error: err.message }, 502);
      }
    }

    // --- Admin ---
    if (request.method === "POST" && path === "/api/bulk") {
      if (!isAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
      if (!Array.isArray(body.bags)) return json({ error: "bags must be array" }, 400);
      await env.BAGS.put("data", JSON.stringify({ bags: body.bags, settings: body.settings || {} }));
      return json({ ok: true, count: body.bags.length });
    }

    if (request.method === "POST" && path === "/api/image") {
      if (!isAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
      const { base64, ext } = body;
      if (!base64) return json({ error: "base64 required" }, 400);
      const safeExt = (ext || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const name = `bag_${Date.now()}.${safeExt}`;
      const mime = safeExt === "png" ? "image/png" : safeExt === "webp" ? "image/webp" : "image/jpeg";
      await env.BAGS.put(`img:${name}`, base64);
      await env.BAGS.put(`mime:${name}`, mime);
      return json({ path: `/img/${name}`, name });
    }

    // ---- IG image proxy: bypass CORS so the admin can download IG CDN images.
    // Allowlisted to cdninstagram.com + fbcdn.net only.
    if (request.method === "GET" && path === "/api/ig-proxy") {
      const target = url.searchParams.get("url");
      if (!target) return json({ error: "url required" }, 400);
      let host;
      try { host = new URL(target).hostname; } catch { return json({ error: "bad url" }, 400); }
      if (!/(?:^|\.)(cdninstagram\.com|fbcdn\.net)$/i.test(host)) {
        return json({ error: "host not allowed" }, 403);
      }
      try {
        const r = await fetch(target);
        if (!r.ok) return json({ error: `upstream ${r.status}` }, 502);
        return new Response(r.body, {
          status: 200,
          headers: {
            "Content-Type": r.headers.get("Content-Type") || "image/jpeg",
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (err) {
        return json({ error: err.message }, 502);
      }
    }

    // ---- IG quick-add: server-side fetch of a public Instagram post ----
    // Lets the admin paste an IG URL and auto-fill image + caption. CORS prevents this from
    // the browser, so we proxy through the Worker.
    if (request.method === "GET" && path === "/api/ig-fetch") {
      const igUrl = url.searchParams.get("url");
      if (!igUrl) return json({ error: "url required" }, 400);
      const m = igUrl.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/i);
      if (!m) return json({ error: "not an Instagram post URL" }, 400);
      const code = m[1];

      const headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
      };

      try {
        let caption = "", imageUrl = "", imageUrls = [];

        // 1. Embed page (most bot-friendly).
        const embedRes = await fetch(`https://www.instagram.com/p/${code}/embed/captioned/`, { headers });
        if (embedRes.ok) {
          const html = await embedRes.text();
          const img = html.match(/<img[^>]+class=["'][^"']*EmbeddedMediaImage[^"']*["'][^>]+src=["']([^"']+)["']/i)
            || html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
          if (img) imageUrl = img[1].replace(/&amp;/g, "&");
          const capDiv = html.match(/<div[^>]+class=["'][^"']*Caption[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
          if (capDiv) caption = decodeEntities(capDiv[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
          if (!caption) {
            const desc = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
            if (desc) caption = decodeEntities(desc[1]);
          }
        }

        // 2. JSON endpoint (gives full carousel).
        try {
          const jsonRes = await fetch(`https://www.instagram.com/p/${code}/?__a=1&__d=dis`, {
            headers: { ...headers, "X-IG-App-ID": "936619743392459" },
          });
          if (jsonRes.ok) {
            const text = await jsonRes.text();
            if (text.trim().startsWith("{")) {
              const data = JSON.parse(text);
              const media = data?.graphql?.shortcode_media || data?.items?.[0] || data?.shortcode_media;
              if (media) {
                const children = media.edge_sidecar_to_children?.edges?.map(e => e.node) || media.carousel_media || [];
                if (children.length) {
                  imageUrls = children.map(c => c.display_url || c.image_versions2?.candidates?.[0]?.url).filter(Boolean);
                }
                if (!imageUrls.length) {
                  const single = media.display_url || media.image_versions2?.candidates?.[0]?.url;
                  if (single) imageUrls = [single];
                }
                if (!caption) {
                  const cap = media.edge_media_to_caption?.edges?.[0]?.node?.text || media.caption?.text;
                  if (cap) caption = cap;
                }
              }
            }
          }
        } catch (_) {}

        // 3. Final fallback: post-page OG tags.
        if (!imageUrl && !imageUrls.length) {
          const pageRes = await fetch(`https://www.instagram.com/p/${code}/`, { headers });
          if (pageRes.ok) {
            const html = await pageRes.text();
            const img = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
            const desc = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
            if (img) imageUrl = img[1].replace(/&amp;/g, "&");
            if (desc && !caption) {
              caption = decodeEntities(desc[1]);
              const m1 = caption.match(/^"(.+)"\s*-\s*@/s);
              if (m1) caption = m1[1];
            }
          }
        }

        if (!imageUrls.length && imageUrl) imageUrls = [imageUrl];
        if (!imageUrls.length) return json({ error: "Instagram blocked the request. Paste images manually instead." }, 502);

        return json({
          code,
          imageUrl: imageUrls[0],
          imageUrls,
          caption,
          postUrl: `https://www.instagram.com/p/${code}/`,
          isCarousel: imageUrls.length > 1,
        });
      } catch (err) {
        return json({ error: err.message }, 502);
      }
    }

    // ---- IG feed: server-side fetch of a profile's recent posts ----
    // Returns up to `count` recent posts as { items: [{ shortcode, imageUrl, imageUrls, caption, isCarousel, postUrl, takenAt }] }.
    // Used at seed-time to backfill a new catalog.
    if (request.method === "GET" && path === "/api/ig-feed") {
      const username = url.searchParams.get("username");
      const count = Math.min(parseInt(url.searchParams.get("count") || "50", 10), 100);
      const maxId = url.searchParams.get("max_id") || "";
      const directUserId = url.searchParams.get("user_id") || "";
      if (!username && !directUserId) return json({ error: "username or user_id required" }, 400);

      try {
        const result = await fetchIgFeed({ username, userId: directUserId, count, maxId });
        return json(result, result.error ? 502 : 200);
      } catch (err) {
        return json({ error: err.message }, 502);
      }
    }

    // Legacy inline implementation — kept for reference, never reached.
    if (false) {
      const username = "";
      const count = 50;
      const maxId = "";
      const directUserId = "";
      const headers = {};
      try {
        // 1. Resolve user ID. Skip the profile call if the caller passed user_id
        //    explicitly — saves one rate-limited request per paginated call.
        let userId, user = null, profile = null;
        if (directUserId) {
          userId = directUserId;
          profile = { id: userId, username: username || null };
        } else {
          const pRes = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, { headers });
          if (!pRes.ok) return json({ error: `profile lookup ${pRes.status}` }, 502);
          const pData = await pRes.json();
          user = pData?.data?.user;
          if (!user?.id) return json({ error: "user id not found" }, 404);
          userId = user.id;
          profile = {
            id: userId,
            username: user.username,
            fullName: user.full_name,
            biography: user.biography,
            profilePicUrl: user.profile_pic_url_hd || user.profile_pic_url,
            followers: user.edge_followed_by?.count,
          };
        }

        // 2. Pull the recent feed. Three strategies, falling back in order:
        //    a) web_profile_info already embeds `edge_owner_to_timeline_media`
        //       with the first ~12 posts + a cursor — no extra request needed.
        //    b) GraphQL `query_hash` ProfileMedia query for pagination beyond
        //       what's embedded (works unauthenticated, slower to rate-limit
        //       than the /api/v1/feed/user/ endpoint).
        //    c) /api/v1/feed/user/<id>/ — most accurate carousel images, but
        //       hits a 401 wall after a few dozen calls.
        const qsTail = `?count=${count}${maxId ? `&max_id=${encodeURIComponent(maxId)}` : ""}`;
        let items = [];
        let moreAvailable = false;
        let nextMaxId = null;

        // (a) Embedded timeline from the profile we already have (skipped if
        //     caller passed user_id directly so we never fetched the profile).
        const embedded = user?.edge_owner_to_timeline_media;
        if (!maxId && embedded?.edges?.length) {
          items = embedded.edges.map(({ node }) => extractFromTimelineNode(node)).filter(it => it.imageUrl);
          moreAvailable = !!embedded.page_info?.has_next_page;
          nextMaxId = embedded.page_info?.end_cursor || null;
        }

        // (b) GraphQL query for additional pages (uses end_cursor when provided).
        if (items.length < count && (maxId || moreAvailable || directUserId)) {
          const cursor = maxId || nextMaxId;
          const variables = encodeURIComponent(JSON.stringify({ id: userId, first: count, after: cursor || null }));
          const gqlRes = await fetch(`https://www.instagram.com/graphql/query/?query_hash=003056d32c2554def87228bc3fd9668a&variables=${variables}`, { headers });
          if (gqlRes.ok) {
            const gData = await gqlRes.json();
            const media = gData?.data?.user?.edge_owner_to_timeline_media;
            if (media?.edges?.length) {
              items = items.concat(media.edges.map(({ node }) => extractFromTimelineNode(node)).filter(it => it.imageUrl));
              moreAvailable = !!media.page_info?.has_next_page;
              nextMaxId = media.page_info?.end_cursor || null;
            }
          }
        }

        // (c) Last resort: /api/v1/feed/user/ for richer carousel data.
        if (!items.length) {
          let fRes = await fetch(`https://www.instagram.com/api/v1/feed/user/${userId}/${qsTail}`, { headers });
          if (!fRes.ok) {
            fRes = await fetch(`https://i.instagram.com/api/v1/feed/user/${userId}/${qsTail}`, { headers });
          }
          if (!fRes.ok) return json({ error: `feed fetch ${fRes.status}`, profile }, 502);
          const fData = await fRes.json();
          items = (fData.items || []).map(extractFromFeedItem).filter(it => it.imageUrl);
          moreAvailable = !!fData.more_available;
          nextMaxId = fData.next_max_id || null;
        }

        return json({
          profile,
          items,
          count: items.length,
          more_available: moreAvailable,
          next_max_id: nextMaxId,
        });
      } catch (err) {
        return json({ error: err.message }, 502);
      }
    }

    // One-time Llama vision license acceptance. CF Workers AI requires
    // calling the model with prompt='agree' once to accept the EULA before
    // any further inference works.
    if (request.method === "GET" && path === "/api/ig-accept-license") {
      if (!isAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      try {
        const r = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", { prompt: "agree", max_tokens: 8 });
        return json({ ok: true, response: r });
      } catch (err) {
        return json({ error: err.message }, 502);
      }
    }

    // Debug: classify a single IG shortcode through both vision + text models.
    // GET /api/ig-classify?shortcode=...&caption=... (caption optional, admin auth)
    if (request.method === "GET" && path === "/api/ig-classify") {
      if (!isAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      const sc = url.searchParams.get("shortcode");
      const capOverride = url.searchParams.get("caption");
      if (!sc) return json({ error: "shortcode required" }, 400);
      try {
        // Always use the IG CDN URL (workers can't recursively fetch their own URLs).
        const feed = await fetchIgFeed({ userId: "21684819437", count: 50 });
        const found = (feed.items || []).find(i => i.shortcode === sc);
        const imageUrl = found?.imageUrl || null;
        const caption = capOverride || found?.caption || "";
        const vision = await classifyPostWithVision(env, caption, imageUrl);
        const text = await classifyPostWithAi(env, caption);
        return json({ shortcode: sc, caption, imageUrl, vision, text_only: text });
      } catch (err) {
        return json({ error: err.message }, 502);
      }
    }

    // ---- IG sync: discover new posts (admin-only preview) ----
    // GET /api/ig-discover?username=...&user_id=...&limit=20
    // Returns up to `limit` posts in the feed whose ig_<shortcode> isn't
    // already in the catalog, each with a suggested name/category/stock from
    // the caption heuristic. No images downloaded yet — admin previews them
    // and POSTs the approved subset to /api/ig-sync.
    if (request.method === "GET" && path === "/api/ig-discover") {
      if (!isAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      const username = url.searchParams.get("username");
      const directUserId = url.searchParams.get("user_id");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 50);
      if (!username && !directUserId) return json({ error: "username or user_id required" }, 400);

      try {
        const existingRaw = await env.BAGS.get("data");
        const existing = existingRaw ? JSON.parse(existingRaw) : { bags: [] };
        const existingIds = new Set((existing.bags || []).map(b => b.id));

        const feedData = await fetchIgFeed({ username, userId: directUserId, count: 50 });
        if (!feedData.items) return json({ error: feedData.error || "feed empty" }, 502);

        // Classification pipeline (per candidate, in parallel):
        //   1. Heuristic (regex/brand keywords). Liberal, fast, free.
        //   2. Vision model (Llama 3.2 Vision) — actually sees the photo so it
        //      can tell sneakers vs slides vs boots even when caption is sparse.
        //   3. Text-only LLM fallback if vision call fails.
        //   4. Final is_shoe = heuristic OR ai.is_shoe (heuristic acts as safety net).
        //   5. Name + category prefer the AI answer when it's specific; never
        //      accept literal "Size"/"Tn"/"Hh" — those are caption fragments.
        // Hybrid classification: vision model sees the photo (best for category),
        // text LLM reads the caption (best for decoding shorthand like
        // Tn→Nike TN, Hh→Helly Hansen, Js13→Jordan 13). Heuristic is the
        // safety net so we never drop a clear-product caption.
        const fresh = feedData.items.filter(it => !existingIds.has(`ig_${it.shortcode}`)).slice(0, limit * 2);
        const classified = await Promise.all(fresh.map(async (it) => {
          const heuristic = looksLikeProduct(it.caption);
          const [vision, text] = await Promise.all([
            classifyPostWithVision(env, it.caption, it.imageUrl),
            classifyPostWithAi(env, it.caption),
          ]);
          const visionOk = vision && !vision._debug;
          const isShoe = heuristic || (visionOk && vision.is_shoe) || (text && text.is_shoe);
          if (!isShoe) return null;
          const heuristicSuggestion = parseCaptionForBag(it.caption);
          // Name: text LLM is best at brand shorthand; only fall back to vision
          // or heuristic if text didn't get a brand. Strip any literal "Size"/"Tn"/"Hh".
          const looksLikeFragment = (n) => !n || /^(size|tn|hh|js\d+|nb)$/i.test(n.trim());
          let name = heuristicSuggestion.name;
          if (text?.is_shoe && !looksLikeFragment(text.name) && text.name !== "Pre-loved Pair") {
            name = text.name.trim();
          } else if (visionOk && vision.is_shoe && !looksLikeFragment(vision.name) && vision.name !== "Pre-loved Pair") {
            name = vision.name.trim();
          } else if (visionOk && vision.is_shoe && vision.name === "Pre-loved Pair") {
            name = "Pre-loved Pair";
          }
          // Category: vision wins — it actually looked at the photo. Text LLM is
          // second best (caption gives a model hint). Heuristic last.
          // Silvarkicks doesn't stock Heels/Sandals — if the model suggests one
          // of those, coerce to a safer adjacent category.
          const coerce = (c) => {
            if (!c) return c;
            if (/^heels?$/i.test(c)) return "Formal";
            if (/^sandals?$/i.test(c)) return "Slides";
            return c;
          };
          let category = heuristicSuggestion.category;
          if (visionOk && vision.is_shoe && vision.category) {
            category = coerce(vision.category);
          } else if (text?.is_shoe && text.category && text.category !== "Other") {
            category = coerce(text.category);
          }
          const reason = visionOk ? vision.reason : (text?.reason || (heuristic ? "matched product heuristic" : ""));
          let classifier = "heuristic";
          if (visionOk && text) classifier = "vision+text";
          else if (visionOk) classifier = "vision";
          else if (text) classifier = "text";
          return {
            ...it,
            suggested: { name, category, stock: heuristicSuggestion.stock, description: heuristicSuggestion.description },
            ai_reason: reason,
            classifier,
          };
        }));
        const candidates = classified.filter(Boolean).slice(0, limit);

        return json({
          count: candidates.length,
          scanned: fresh.length,
          items: candidates,
          profile: feedData.profile,
          ai_enabled: !!env.AI,
        });
      } catch (err) {
        return json({ error: err.message }, 502);
      }
    }

    // ---- IG sync: commit approved posts ----
    // POST /api/ig-sync (auth) body: { items: [{ shortcode, name, category, stock, description, imageUrls }] }
    // Downloads each item's images directly from IG CDN, uploads to KV, appends
    // bag objects to the catalog. Returns added count + any failures.
    if (request.method === "POST" && path === "/api/ig-sync") {
      if (!isAuthed(request, env)) return json({ error: "unauthorized" }, 401);
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return json({ error: "items required" }, 400);

      const existingRaw = await env.BAGS.get("data");
      const data = existingRaw ? JSON.parse(existingRaw) : { bags: [], settings: {} };
      const existingIds = new Set(data.bags.map(b => b.id));

      const added = [];
      const errors = [];
      const newBags = [];

      for (const it of items) {
        const id = `ig_${it.shortcode}`;
        if (existingIds.has(id)) { errors.push({ shortcode: it.shortcode, reason: "already in catalog" }); continue; }
        const urls = (it.imageUrls || []).slice(0, 4);
        if (!urls.length) { errors.push({ shortcode: it.shortcode, reason: "no images" }); continue; }
        const uploaded = [];
        for (const u of urls) {
          try {
            const r = await fetch(u);
            if (!r.ok) throw new Error(`fetch ${r.status}`);
            const buf = new Uint8Array(await r.arrayBuffer());
            // base64-encode in chunks to avoid call-stack overflow on large images
            let b64 = "";
            const CHUNK = 8192;
            for (let i = 0; i < buf.length; i += CHUNK) {
              b64 += String.fromCharCode(...buf.subarray(i, i + CHUNK));
            }
            b64 = btoa(b64);
            const name = `bag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
            await env.BAGS.put(`img:${name}`, b64);
            await env.BAGS.put(`mime:${name}`, "image/jpeg");
            uploaded.push(`${url.origin}/img/${name}`);
          } catch (e) {
            errors.push({ shortcode: it.shortcode, reason: `image fetch: ${e.message}` });
          }
        }
        if (!uploaded.length) continue;
        const bag = {
          id,
          name: (it.name || "Pre-loved Pair").slice(0, 80),
          category: it.category || "Sneakers",
          description: it.description || "Hand-picked. Inspected. One pair, photographed exactly as it is. Worldwide delivery.",
          price: 0,
          stock: it.stock && typeof it.stock === "object" ? it.stock : { "One Size": 1 },
          sales: [],
          image: uploaded[0],
          createdAt: it.takenAt || new Date().toISOString(),
          instagramUrl: `https://www.instagram.com/p/${it.shortcode}/`,
        };
        if (uploaded.length > 1) bag.images = uploaded;
        newBags.push(bag);
        added.push({ shortcode: it.shortcode, id });
        existingIds.add(id);
      }

      // Newest posts go to the top of the catalog
      data.bags = newBags.concat(data.bags);
      await env.BAGS.put("data", JSON.stringify(data));
      return json({ ok: true, added: added.length, errors, items: added });
    }

    return json({ error: "not found" }, 404);
  },
};
