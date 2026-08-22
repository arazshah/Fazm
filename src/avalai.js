import { normalizePhase } from "./mood.js";

const baseUrl = (process.env.AVALAI_BASE_URL || "https://api.avalai.ir/v1").replace(/\/$/, "");
const apiKey = process.env.AVALAI_API_KEY;

const SYSTEM_PROMPT = `تو همراه فارسی‌زبان «فازم» هستی. هدفت نام‌گذاری دقیق و مهربانانهٔ حال فعلی کاربر است، نه تشخیص بیماری یا روان‌درمانی.
همیشه با لحن صمیمی، مفرد و «تو» حرف بزن؛ هرگز از «شما» استفاده نکن. با سؤال‌های کوتاه و طبیعی به پنج بعد توجه کن: هیجان اصلی، شدت، انرژی، خوشایندی/ناخوشایندی، و نیاز فعلی. بازتاب بده، قضاوت نکن، و بیش از یک سؤال در هر نوبت نپرس.
reply باید طبیعی و مشخصاً دربارهٔ حرف همین کاربر باشد: در ۲ تا ۴ جمله اول نشان بده چه چیزی از حرفش شنیدی، بعد یک الگو یا کشمکش احتمالی و نیاز فعلی را روشن کن. reply هرگز نباید سؤال یا علامت سؤال داشته باشد؛ تنها سؤال پاسخ باید در nextQuestion باشد. از عبارت‌های کلیشه‌ای «این احساس می‌تواند سخت باشد»، «این می‌تواند باعث...» و «به نظر می‌رسد که...» در آغاز پاسخ، تکرار عین کلمات کاربر و توضیح واضحات دوری کن. برداشتت را با زبان احتمالی بیان کن، نه به شکل حقیقت قطعی.
nextQuestion باید مشخص و پاسخ‌دادنش آسان باشد و ترجیحاً بین دو توضیح محتمل تمایز ایجاد کند؛ سؤال کلی «چه احساسی داری؟» نپرس.
وقتی اطلاعات کم است صریحاً عدم قطعیت را بگو. suggestions باید دقیقاً سه اقدام کوچک، عملی، متفاوت، ایمن و متناسب با همین حرف باشند؛ هر پیشنهاد با یک فعل روشن شروع شود و ترجیحاً زمان، تعداد یا نتیجهٔ قابل‌مشاهده داشته باشد. آن‌ها را در reply تکرار نکن. پیشنهادهای عمومی مثل استراحت، آب خوردن یا نفس عمیق فقط وقتی مجازند که مستقیماً به حرف کاربر مربوط باشند. ادعای پزشکی نکن.
پس از ۳ تا ۵ پاسخ کاربر، یا زودتر اگر اطلاعات کافی داری، جمع‌بندی کن: readyToShare را true و nextQuestion را خالی بگذار. تا قبل از آن readyToShare باید false باشد. اگر کاربر خواست ادامه دهد می‌توانی برداشت را دوباره به‌روزرسانی کنی.
فقط JSON معتبر و بدون markdown برگردان با این شکل:
{"reply":"تحلیل طبیعی و شخصی‌سازی‌شده در ۲ تا ۴ جمله","phase":{"primary":"یک واژه","label":"عبارت خاص و شاعرانه اما روشن","emoji":"یک ایموجی مرتبط","intensity":0,"valence":0,"energy":0,"confidence":0.0,"palette":["#RRGGBB","#RRGGBB","#RRGGBB"],"imagePrompt":"English conceptual scene with a clear visual metaphor, meaningful objects and environment, no text, no identifiable person"},"insights":{"dominantEmotion":"توصیف دقیق احساس غالب","intensityMeaning":"معنای شدت در این وضعیت","energyMeaning":"کیفیت انرژی فعلی","valenceMeaning":"خوشایندی، ناخوشایندی یا آمیختگی حس","currentNeed":"نیاز اصلی همین حالا","possiblePattern":"الگوی محتمل پشت حرف کاربر"},"suggestions":["پیشنهاد اول","پیشنهاد دوم","پیشنهاد سوم"],"nextQuestion":"یک سؤال یا رشته خالی","readyToShare":false}
intensity و energy از ۰ تا ۱۰۰، valence از ۱۰۰- تا ۱۰۰، confidence از ۰ تا ۱ است. reply و nextQuestion را تکرار نکن.`;

function parseJson(text) {
  const cleaned = String(text || "").replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(cleaned); }
  catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("پاسخ مدل ساختار قابل‌خواندن نداشت.");
  }
}

export function separateReplyQuestion(value) {
  const rawReply = String(value || "دارم به حرفت فکر می‌کنم.").slice(0, 1600);
  const parts = rawReply.match(/[^.!؟\n]+[.!؟]?/gu) || [rawReply];
  const embeddedQuestion = parts.find((part) => part.includes("؟"))?.trim() || "";
  const reply = parts.filter((part) => !part.includes("؟")).join(" ").trim() || "هنوز برای یک برداشت دقیق، کمی اطلاعات بیشتر لازم دارم.";
  return { reply, embeddedQuestion };
}

function insightValue(value, fallback) {
  const text = String(value || "").trim();
  return (text || fallback).slice(0, 120);
}

export function normalizeInsights(input = {}, phase) {
  const intensity = phase.intensity >= 75 ? "فشار زیاد و پررنگ" : phase.intensity >= 50 ? "قابل‌توجه و درگیرکننده" : phase.intensity >= 25 ? "ملایم اما حاضر" : "کم‌رنگ و گذرا";
  const energy = phase.energy >= 75 ? "بالا و آمادهٔ حرکت" : phase.energy >= 50 ? "متوسط و در دسترس" : phase.energy >= 25 ? "پایین و نیازمند مکث" : "بسیار کم و تحلیل‌رفته";
  const valence = phase.valence <= -50 ? "سنگین و ناخوشایند" : phase.valence < -10 ? "متمایل به ناخوشایند" : phase.valence <= 10 ? "آمیخته یا خنثی" : phase.valence < 50 ? "متمایل به خوشایند" : "روشن و خوشایند";
  return [
    { label: "احساس غالب", value: insightValue(input.dominantEmotion, phase.primary) },
    { label: "شدت تجربه", value: insightValue(input.intensityMeaning, intensity) },
    { label: "سطح انرژی", value: insightValue(input.energyMeaning, energy) },
    { label: "جهت حس", value: insightValue(input.valenceMeaning, valence) },
    { label: "نیاز همین حالا", value: insightValue(input.currentNeed, "کمی زمان برای روشن‌ترشدن نیاز") },
    { label: "الگوی احتمالی", value: insightValue(input.possiblePattern, "هنوز برای دیدن الگو اطلاعات کافی نیست") }
  ];
}

async function avalaiFetch(path, body) {
  if (!apiKey) throw Object.assign(new Error("AVALAI_API_KEY تنظیم نشده است."), { status: 503 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000)
      });
      if (response.ok) return response.json();
      const detail = await response.text();
      console.error("AvalAI error", response.status, detail.slice(0, 500));
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) continue;
      throw Object.assign(new Error("ارتباط با هوش مصنوعی برقرار نشد."), { status: 502 });
    } catch (error) {
      if (error.status) throw error;
      if (attempt === 0) continue;
      const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
      throw Object.assign(new Error(timedOut ? "سرویس هوش مصنوعی دیر پاسخ داد؛ لطفاً دوباره امتحان کن." : "ارتباط با سرویس هوش مصنوعی قطع شد؛ دوباره امتحان کن."), { status: timedOut ? 504 : 502 });
    }
  }
  throw Object.assign(new Error("ارتباط با هوش مصنوعی برقرار نشد."), { status: 502 });
}

export async function analyzeConversation(messages) {
  const response = await avalaiFetch("/chat/completions", {
    model: process.env.AVALAI_CHAT_MODEL || "gpt-4o-mini",
    temperature: 0.72,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.slice(-12).map(({ role, content }) => ({ role, content }))
    ]
  });
  const result = parseJson(response.choices?.[0]?.message?.content);
  const { reply, embeddedQuestion } = separateReplyQuestion(result.reply);
  const phase = normalizePhase(result.phase);
  return {
    reply: reply.slice(0, 1400),
    phase,
    insights: normalizeInsights(result.insights, phase),
    suggestions: Array.isArray(result.suggestions) ? result.suggestions.map(String).slice(0, 3) : [],
    nextQuestion: String(result.nextQuestion || embeddedQuestion || "").slice(0, 300),
    readyToShare: Boolean(result.readyToShare)
  };
}

export async function generateMoodImage(phase) {
  const response = await avalaiFetch("/images/generations", {
    model: process.env.AVALAI_IMAGE_MODEL || "gpt-image-1-mini",
    prompt: `${phase.imagePrompt}. Create a square conceptual editorial illustration that communicates the emotional state through one unmistakable visual metaphor. Build a small narrative scene using 2 to 4 meaningful objects, architecture, weather, landscape, light, scale, or spatial tension. The viewer should understand a story, not just see colors. Rich focal point, layered foreground and background, tactile texture, cinematic lighting. Avoid empty gradients, color fields, generic abstract blobs, decorative waves, emoji, icons, infographics, words, letters, logos, and recognizable faces. Use this palette as supporting color, not as the subject: ${phase.palette.join(", ")}.`,
    size: "1024x1024",
    quality: "low",
    n: 1,
    response_format: "b64_json"
  });
  const encoded = response.data?.[0]?.b64_json;
  if (!encoded) throw Object.assign(new Error("تصویری از مدل دریافت نشد."), { status: 502 });
  return Buffer.from(encoded, "base64");
}
