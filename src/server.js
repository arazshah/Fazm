import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { analyzeConversation, generateMoodImage } from "./avalai.js";
import { initStore, createSession, getOwnedSession, getByShareSlug, updateSession, saveImage, imagePath } from "./store.js";
import { isCrisisText, makePhaseSvg } from "./mood.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const rateBuckets = new Map();
const activeAiSessions = new Set();
let activeAiRequests = 0;
const maxConcurrentAi = Number(process.env.MAX_CONCURRENT_AI || 4);

function historyDetails(session, item) {
  const assistantIndex = session.messages.findIndex((message) => message.role === "assistant" && message.at === item.at);
  const assistant = assistantIndex >= 0 ? session.messages[assistantIndex] : null;
  const user = assistantIndex > 0 ? [...session.messages.slice(0, assistantIndex)].reverse().find((message) => message.role === "user") : null;
  return {
    userText: item.userText || user?.content || "",
    analysis: item.analysis || assistant?.content || "",
    suggestions: item.suggestions || assistant?.suggestions || [],
    insights: item.insights || []
  };
}

const send = (res, status, body, type = "application/json; charset=utf-8", extraHeaders = {}) => {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...extraHeaders });
  res.end(Buffer.isBuffer(body) ? body : type.startsWith("application/json") ? JSON.stringify(body) : body);
};

function applySecurityHeaders(req, res) {
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function clientIp(req) {
  const direct = req.socket.remoteAddress || "unknown";
  if (process.env.TRUST_PROXY !== "1") return direct;
  const candidate = String(req.headers["cf-connecting-ip"] || req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return net.isIP(candidate) ? candidate : direct;
}

function consumeRate(key, limit, windowMs) {
  const now = Date.now();
  let entry = rateBuckets.get(key);
  if (!entry || entry.resetAt <= now) entry = { count: 0, resetAt: now + windowMs };
  if (entry.count >= limit) return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  entry.count += 1;
  rateBuckets.set(key, entry);
  if (rateBuckets.size > 10_000) {
    for (const [bucketKey, bucket] of rateBuckets) {
      if (bucket.resetAt <= now) rateBuckets.delete(bucketKey);
      if (rateBuckets.size <= 8_000) break;
    }
  }
  return 0;
}

function limitRequest(res, key, limit, windowMs, message = "تعداد درخواست‌ها زیاد شده؛ کمی بعد دوباره امتحان کن.") {
  const retryAfter = consumeRate(key, limit, windowMs);
  if (!retryAfter) return false;
  send(res, 429, { error: message, retryAfter }, "application/json; charset=utf-8", { "Retry-After": String(retryAfter) });
  return true;
}

function validWriteOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const publicOrigin = process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL).origin : null;
    return originUrl.host === req.headers.host || originUrl.origin === publicOrigin;
  } catch { return false; }
}

async function withAiSlot(sessionId, task) {
  if (activeAiSessions.has(sessionId)) throw Object.assign(new Error("یک پاسخ برای این گفت‌وگو هنوز در حال آماده‌شدن است."), { status: 409 });
  if (activeAiRequests >= maxConcurrentAi) throw Object.assign(new Error("ظرفیت هوش مصنوعی فعلاً پر است؛ کمی بعد دوباره امتحان کن."), { status: 503 });
  activeAiSessions.add(sessionId);
  activeAiRequests += 1;
  try { return await task(); }
  finally { activeAiSessions.delete(sessionId); activeAiRequests -= 1; }
}

async function bodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32_000) throw Object.assign(new Error("درخواست بیش از حد بزرگ است."), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("درخواست نامعتبر است."), { status: 400 }); }
}

function publicSession(session) {
  const publicBase = (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, "");
  const shareUrl = `${publicBase}/f/${session.shareSlug}`;
  const returnUrl = `${publicBase}/#resume=${encodeURIComponent(session.id)}.${encodeURIComponent(session.secret)}`;
  const phaseHistory = (session.phaseHistory || []).map((item) => {
    const details = historyDetails(session, item);
    return {
      id: item.id,
      at: item.at,
      phase: item.phase,
      ...details,
      hasAiImage: Boolean(item.imageFile),
      imageUrl: `/f/${session.shareSlug}/history/${item.id}/image`
    };
  });
  const latest = phaseHistory.at(-1);
  return {
    id: session.id,
    secret: session.secret,
    shareSlug: session.shareSlug,
    shareUrl,
    returnUrl,
    phase: session.phase,
    messages: session.messages,
    hasAiImage: Boolean(session.imageFile),
    phaseHistory,
    autoGenerateImage: Boolean(session.readyToShare && latest && !latest.hasAiImage)
  };
}

function owner(req, id) {
  return getOwnedSession(id, req.headers["x-session-secret"]);
}

function crisisResult(text) {
  const phase = { primary: "بحرانی", label: "زیر فشار خیلی سنگین", emoji: "!", intensity: 95, valence: -95, energy: 50, confidence: 0.85, palette: ["#201a23", "#7f1d1d", "#d6d3d1"], imagePrompt: "abstract heavy storm beginning to open toward a safe warm light, no text, no people" };
  return {
    reply: "حرفت را جدی می‌گیرم و نمی‌خواهم با این فشار تنها بمانی. اگر خطر فوری است، همین حالا از یک آدم امن بخواه کنارت بماند، وسایل آسیب‌زا را از خودت دور کن و با ۱۲۳ (اورژانس اجتماعی) یا خدمات اضطراری محل زندگی‌ات تماس بگیر.",
    phase,
    suggestions: ["همین حالا به یک آدم قابل‌اعتماد پیام بده: «امن نیستم؛ لطفاً کنارم بمان.»", "با اورژانس اجتماعی ۱۲۳ تماس بگیر", "برای مشاوره تلفنی با ۱۴۸۰ تماس بگیر"],
    insights: [
      { label: "احساس غالب", value: "فشار و ناامیدی شدید" },
      { label: "شدت تجربه", value: "بسیار بالا و نیازمند توجه فوری" },
      { label: "سطح انرژی", value: "نامطمئن و زیر فشار" },
      { label: "جهت حس", value: "بسیار سنگین و ناخوشایند" },
      { label: "نیاز همین حالا", value: "امن‌ماندن و تنها نبودن" },
      { label: "اولویت", value: "ارتباط فوری با یک انسان امن یا ۱۲۳" }
    ],
    nextQuestion: "الان در خطر فوری هستی یا برنامه و وسیله‌ای برای آسیب‌زدن به خودت داری؟",
    readyToShare: false
  };
}

async function serveStatic(res, filename, type) {
  try { send(res, 200, await fs.readFile(path.join(publicDir, filename)), type); }
  catch { send(res, 404, { error: "پیدا نشد." }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    applySecurityHeaders(req, res);
    const ip = clientIp(req);
    if (url.pathname !== "/api/health" && limitRequest(res, `global:${ip}`, 180, 60_000)) return;
    if (url.pathname.startsWith("/api/") && url.pathname !== "/api/health" && limitRequest(res, `api:${ip}`, 60, 60_000)) return;
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && !validWriteOrigin(req)) return send(res, 403, { error: "مبدأ درخواست مجاز نیست." });
    if (req.method === "GET" && url.pathname === "/") return serveStatic(res, "index.html", "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/app.js") return serveStatic(res, "app.js", "text/javascript; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/styles.css") return serveStatic(res, "styles.css", "text/css; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/logo.svg") return serveStatic(res, "logo.svg", "image/svg+xml; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/favicon.svg") return serveStatic(res, "favicon.svg", "image/svg+xml; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/manifest.json") return serveStatic(res, "manifest.json", "application/manifest+json; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/service-worker.js") return serveStatic(res, "service-worker.js", "text/javascript; charset=utf-8");
    const iconMatch = url.pathname.match(/^\/icons\/(icon-(?:192|512)(?:-maskable)?\.png)$/);
    if (req.method === "GET" && iconMatch) return serveStatic(res, `icons/${iconMatch[1]}`, "image/png");
    if (req.method === "GET" && url.pathname === "/.well-known/assetlinks.json") return serveStatic(res, ".well-known/assetlinks.json", "application/json; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/api/health") return send(res, 200, { ok: true, aiConfigured: Boolean(process.env.AVALAI_API_KEY) });

    if (req.method === "POST" && url.pathname === "/api/sessions") {
      if (limitRequest(res, `sessions:${ip}`, 8, 60 * 60_000, "تعداد شروع گفت‌وگو از این اتصال زیاد شده؛ بعداً دوباره امتحان کن.")) return;
      return send(res, 201, publicSession(await createSession()));
    }

    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (req.method === "GET" && sessionMatch) {
      const session = owner(req, sessionMatch[1]);
      return session ? send(res, 200, publicSession(session)) : send(res, 404, { error: "گفت‌وگو پیدا نشد." });
    }

    const resetMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/reset$/);
    if (req.method === "POST" && resetMatch) {
      const session = owner(req, resetMatch[1]);
      if (!session) return send(res, 404, { error: "گفت‌وگو پیدا نشد." });
      const phaseHistory = (session.phaseHistory || []).map((item) => ({ ...item, ...historyDetails(session, item) }));
      await updateSession(session.id, { messages: [], phaseHistory, readyToShare: false });
      return send(res, 200, publicSession(session));
    }

    const chatMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/chat$/);
    if (req.method === "POST" && chatMatch) {
      const session = owner(req, chatMatch[1]);
      if (!session) return send(res, 404, { error: "گفت‌وگو پیدا نشد." });
      if (limitRequest(res, `chat-ip:${ip}`, 12, 10 * 60_000) || limitRequest(res, `chat-session:${session.id}`, 8, 10 * 60_000)) return;
      const { message } = await bodyJson(req);
      const content = String(message || "").trim();
      if (!content || content.length > 2000) return send(res, 400, { error: "پیام باید بین ۱ تا ۲۰۰۰ نویسه باشد." });
      const userMessage = { id: crypto.randomUUID(), role: "user", content, emoji: session.phase?.emoji || "◌", at: new Date().toISOString() };
      const history = [...session.messages, userMessage];
      const result = isCrisisText(content) ? crisisResult(content) : await withAiSlot(session.id, () => analyzeConversation(history));
      const userTurnCount = history.filter((message) => message.role === "user").length;
      if (!isCrisisText(content) && userTurnCount >= 4) {
        result.readyToShare = true;
        result.nextQuestion = "";
      }
      const assistantText = [result.reply, result.nextQuestion].filter(Boolean).join("\n\n");
      userMessage.emoji = result.phase.emoji;
      const now = new Date().toISOString();
      const messages = [...session.messages, userMessage, { id: crypto.randomUUID(), role: "assistant", content: assistantText, emoji: result.phase.emoji, suggestions: result.suggestions, at: now }].slice(-40);
      const phaseHistory = [...(session.phaseHistory || []), {
        id: crypto.randomBytes(9).toString("base64url"),
        at: now,
        phase: result.phase,
        userText: content,
        analysis: result.reply,
        suggestions: result.suggestions,
        insights: result.insights,
        imageFile: null
      }].slice(-100);
      await updateSession(session.id, { phase: result.phase, messages, phaseHistory, imageFile: null, readyToShare: result.readyToShare });
      return send(res, 200, publicSession(session));
    }

    const imageGenerateMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/image$/);
    if (req.method === "POST" && imageGenerateMatch) {
      const session = owner(req, imageGenerateMatch[1]);
      if (!session) return send(res, 404, { error: "گفت‌وگو پیدا نشد." });
      if (limitRequest(res, `image-ip:${ip}`, 6, 60 * 60_000, "سهمیهٔ ساخت تصویر این اتصال فعلاً تمام شده است.") || limitRequest(res, `image-session:${session.id}`, 3, 60 * 60_000, "برای این گفت‌وگو فعلاً تصویرهای زیادی ساخته شده است.")) return;
      let latest = session.phaseHistory?.at(-1);
      if (!latest) {
        latest = { id: crypto.randomBytes(9).toString("base64url"), at: new Date().toISOString(), phase: session.phase, imageFile: null };
        await updateSession(session.id, { phaseHistory: [latest] });
      }
      const bytes = await withAiSlot(session.id, () => generateMoodImage(latest.phase));
      await saveImage(session, bytes, latest.id, "png");
      const shareUrl = `${process.env.PUBLIC_BASE_URL || `http://localhost:${port}`}/f/${session.shareSlug}`;
      const alreadyAnnounced = session.messages.some((message) => message.type === "share" && message.historyId === latest.id);
      if (!alreadyAnnounced) {
        const messages = [...session.messages, {
          id: crypto.randomUUID(), role: "assistant", type: "share", historyId: latest.id,
          content: `تصویر این فازت آماده شد. این لینک تو برای نمایش تصویر به دیگرانه؛ فقط تصویر دیده می‌شه و حرف‌هات خصوصی می‌مونه.`,
          emoji: latest.phase.emoji, link: shareUrl, at: new Date().toISOString()
        }].slice(-40);
        await updateSession(session.id, { messages });
      }
      return send(res, 200, publicSession(session));
    }

    const shareMatch = url.pathname.match(/^\/f\/([A-Za-z0-9_-]+)$/);
    if (req.method === "GET" && shareMatch) {
      const session = getByShareSlug(shareMatch[1]);
      if (!session) return send(res, 404, "این فاز پیدا نشد.", "text/plain; charset=utf-8");
      const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>فازِ الان</title><meta name="robots" content="noindex,nofollow"><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#111}body{display:grid;place-items:center;overflow:hidden}img{width:100%;height:100%;object-fit:cover}</style></head><body><img src="/f/${shareMatch[1]}/image" alt="تصویر انتزاعی فاز فعلی"></body></html>`;
      return send(res, 200, html, "text/html; charset=utf-8");
    }

    const shareImageMatch = url.pathname.match(/^\/f\/([A-Za-z0-9_-]+)\/image$/);
    if (req.method === "GET" && shareImageMatch) {
      const session = getByShareSlug(shareImageMatch[1]);
      if (!session) return send(res, 404, "Not found", "text/plain");
      if (session.imageFile) {
        try { return send(res, 200, await fs.readFile(imagePath(session.imageFile)), "image/png"); } catch {}
      }
      return send(res, 200, makePhaseSvg(session.phase, session.shareSlug), "image/svg+xml; charset=utf-8");
    }

    const historyImageMatch = url.pathname.match(/^\/f\/([A-Za-z0-9_-]+)\/history\/([A-Za-z0-9_-]+)\/image$/);
    if (req.method === "GET" && historyImageMatch) {
      const session = getByShareSlug(historyImageMatch[1]);
      const item = session?.phaseHistory?.find((entry) => entry.id === historyImageMatch[2]);
      if (!session || !item) return send(res, 404, "Not found", "text/plain");
      if (item.imageFile) {
        try { return send(res, 200, await fs.readFile(imagePath(item.imageFile)), "image/png"); } catch {}
      }
      return send(res, 200, makePhaseSvg(item.phase, item.id), "image/svg+xml; charset=utf-8");
    }

    send(res, 404, { error: "پیدا نشد." });
  } catch (error) {
    console.error(error);
    send(res, error.status || 500, { error: error.status ? error.message : "یک خطای غیرمنتظره رخ داد." });
  }
});

await initStore();
server.listen(port, host, () => console.log(`Fazm is running on http://${host}:${port}`));
