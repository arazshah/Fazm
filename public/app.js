const $ = (selector) => document.querySelector(selector);
const intro = $("#intro");
const workspace = $("#workspace");
const messages = $("#messages");
const status = $("#status");
const submitButton = $("#chatForm button[type=submit]");
const input = $("#messageInput");
let session = null;
let busy = false;
let thinkingTimer = null;

function credentials() {
  try { return JSON.parse(localStorage.getItem("fazm-session")); } catch { return null; }
}

async function api(path, options = {}, timeout = 75000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(session?.secret ? { "X-Session-Secret": session.secret } : {}), ...options.headers }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "خطایی رخ داد.");
    return body;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("پاسخ بیشتر از حد معمول طول کشید. دوباره امتحان کن؛ پیامت دوباره ثبت نشده است.");
    throw error;
  } finally { clearTimeout(timer); }
}

async function create() {
  session = await api("/api/sessions", { method: "POST" });
  localStorage.setItem("fazm-session", JSON.stringify({ id: session.id, secret: session.secret }));
  render();
}

function showWorkspace() {
  intro.classList.add("hidden");
  workspace.classList.remove("hidden");
  document.body.classList.add("app-active");
  setTimeout(() => input.focus(), 100);
}

function messageEmoji(message) {
  return message.emoji || session?.phase?.emoji || "◌";
}

function renderMessage(message, { temporary = false } = {}) {
  const row = document.createElement("div");
  row.className = `message-row ${message.role}${temporary ? " temporary" : ""}`;
  const avatar = document.createElement("span");
  avatar.className = "mood-avatar";
  avatar.textContent = messageEmoji(message);
  avatar.setAttribute("aria-hidden", "true");
  const article = document.createElement("article");
  article.className = `message ${message.role}${temporary ? " thinking" : ""}`;
  if (temporary) {
    article.innerHTML = `<span class="thinking-label">دارم فکر می‌کنم</span><i></i><i></i><i></i>`;
  } else {
    const text = document.createElement("span");
    text.textContent = message.content;
    article.append(text);
    if (message.suggestions?.length) {
      const recommendations = document.createElement("section");
      recommendations.className = "recommendations";
      const heading = document.createElement("strong");
      heading.textContent = "سه پیشنهاد برای همین حالا";
      const list = document.createElement("ol");
      message.suggestions.forEach((suggestion) => { const li = document.createElement("li"); li.textContent = suggestion; list.append(li); });
      recommendations.append(heading, list);
      article.append(recommendations);
    }
    if (message.link) {
      const link = document.createElement("a");
      link.className = "message-link";
      link.href = message.link;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = message.link;
      article.append(link);
    }
  }
  row.append(avatar, article);
  messages.append(row);
  return row;
}

function formatDate(value) {
  try { return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
  catch { return ""; }
}

function fallbackInsights(phase) {
  const intensity = phase.intensity >= 75 ? "فشار زیاد و پررنگ" : phase.intensity >= 50 ? "قابل‌توجه و درگیرکننده" : phase.intensity >= 25 ? "ملایم اما حاضر" : "کم‌رنگ و گذرا";
  const energy = phase.energy >= 75 ? "بالا و آمادهٔ حرکت" : phase.energy >= 50 ? "متوسط و در دسترس" : phase.energy >= 25 ? "پایین و نیازمند مکث" : "بسیار کم و تحلیل‌رفته";
  const valence = phase.valence <= -50 ? "سنگین و ناخوشایند" : phase.valence < -10 ? "متمایل به ناخوشایند" : phase.valence <= 10 ? "آمیخته یا خنثی" : phase.valence < 50 ? "متمایل به خوشایند" : "روشن و خوشایند";
  return [
    { label: "احساس غالب", value: phase.primary },
    { label: "شدت تجربه", value: intensity },
    { label: "سطح انرژی", value: energy },
    { label: "جهت حس", value: valence },
    { label: "نیاز همین حالا", value: "کمی زمان برای روشن‌ترشدن نیاز" },
    { label: "وضوح برداشت", value: `${Math.round(phase.confidence * 100)}٪ اطمینان` }
  ];
}

function renderInsightItems(container, insights, phase) {
  container.replaceChildren();
  const items = insights?.length === 6 ? insights : fallbackInsights(phase);
  items.forEach((item) => {
    const card = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = item.label;
    const value = document.createElement("strong");
    value.textContent = item.value;
    card.append(label, value);
    container.append(card);
  });
}

function openHistoryDetail(item) {
  $("#detailImage").src = `${item.imageUrl}?v=${item.hasAiImage ? "ai" : item.at}`;
  $("#detailTime").textContent = formatDate(item.at);
  $("#detailLabel").textContent = `${item.phase.emoji} ${item.phase.label}`;
  $("#detailUserText").textContent = item.userText || "متن این لحظه در نسخهٔ قدیمی تاریخچه ذخیره نشده است.";
  $("#detailAnalysis").textContent = item.analysis || "برای این رکورد قدیمی، تحلیل متنی ذخیره نشده؛ شاخص‌های فاز همچنان در دسترس‌اند.";
  renderInsightItems($("#detailInsights"), item.insights, item.phase);
  const suggestions = $("#detailSuggestions");
  suggestions.replaceChildren();
  (item.suggestions || []).forEach((suggestion) => { const li = document.createElement("li"); li.textContent = suggestion; suggestions.append(li); });
  if (!suggestions.children.length) { const li = document.createElement("li"); li.textContent = "برای این رکورد قدیمی پیشنهادی ذخیره نشده است."; suggestions.append(li); }
  $("#historyDetailModal").showModal();
}

function renderHistory() {
  const list = $("#historyList");
  list.replaceChildren();
  const history = [...(session.phaseHistory || [])].reverse();
  $("#historyEmpty").hidden = history.length > 0;
  $("#historyCount").textContent = new Intl.NumberFormat("fa-IR").format(history.length);
  history.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = `history-item${index === 0 ? " current" : ""}`;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `دیدن جزئیات ${item.phase.label}`);
    const image = document.createElement("img");
    image.src = `${item.imageUrl}?v=${item.hasAiImage ? "ai" : item.at}`;
    image.alt = `تصویر فاز ${item.phase.label}`;
    const copy = document.createElement("div");
    const time = document.createElement("time");
    time.textContent = formatDate(item.at);
    const title = document.createElement("h4");
    title.textContent = `${item.phase.emoji} ${item.phase.label}`;
    const stats = document.createElement("div");
    stats.className = "history-stats";
    const intensity = document.createElement("span");
    intensity.textContent = `شدت ${Math.round(item.phase.intensity)}`;
    const energy = document.createElement("span");
    energy.textContent = `انرژی ${Math.round(item.phase.energy)}`;
    stats.append(intensity, energy);
    copy.append(time, title, stats);
    card.append(image, copy);
    card.addEventListener("click", () => openHistoryDetail(item));
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openHistoryDetail(item); } });
    list.append(card);
  });
}

function render() {
  if (!session) return;
  const phase = session.phase;
  $("#phaseLabel").textContent = phase.label;
  $("#phaseEmoji").textContent = phase.emoji;
  $("#confidence").textContent = phase.confidence < .55 ? "هنوز مطمئن نیستیم؛ کمی بیشتر بگو" : `${Math.round(phase.confidence * 100)}٪ به این برداشت مطمئنیم`;
  $("#intensityBar").style.width = `${phase.intensity}%`;
  $("#energyBar").style.width = `${phase.energy}%`;
  $("#phaseArt").src = `/f/${session.shareSlug}/image?v=${Date.now()}`;
  $("#shareUrl").value = session.shareUrl;
  const latestHistory = session.phaseHistory?.at(-1);
  renderInsightItems($("#phaseInsights"), latestHistory?.insights, phase);
  messages.replaceChildren();
  if (!session.messages.length) renderMessage({ role: "assistant", emoji: "🫧", content: "اینجا لازم نیست مرتب و دقیق حرف بزنی. از همین لحظه بگو: بیشتر ذهنت شلوغ است، بدنت خسته است، یا یک اتفاق خاص تو را درگیر کرده؟" });
  session.messages.forEach((message) => renderMessage(message));
  renderHistory();
  messages.scrollTop = messages.scrollHeight;
}

function setBusy(value, label = "") {
  busy = value;
  input.disabled = value;
  submitButton.disabled = value;
  input.placeholder = value ? "فازم دارد به حرفت فکر می‌کند…" : "هرجوری هست بنویس…";
  if (label) status.textContent = label;
  if (!value) {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
    document.querySelector(".message-row.temporary")?.remove();
  }
}

function showThinking() {
  renderMessage({ role: "assistant", emoji: session?.phase?.emoji || "🫧" }, { temporary: true });
  messages.scrollTop = messages.scrollHeight;
  const labels = ["دارم حسِ پشت کلمه‌ها را می‌فهمم…", "دارم تکه‌های حرفت را کنار هم می‌گذارم…", "یک لحظه؛ می‌خواهم دقیق جواب بدهم…", "ارتباط کمی کند شده؛ هنوز اینجام…"];
  let index = 0;
  status.textContent = labels[0];
  thinkingTimer = setInterval(() => { index = (index + 1) % labels.length; status.textContent = labels[index]; }, 3500);
}

function showImageProgress() {
  const row = renderMessage({ role: "assistant", emoji: session?.phase?.emoji || "🎨" }, { temporary: true });
  row.querySelector(".thinking-label").textContent = "دارم تصویر این فاز را می‌سازم";
  messages.scrollTop = messages.scrollHeight;
}

async function makeImage({ automatic = false } = {}) {
  if (!session || busy) return;
  setBusy(true, automatic ? "برداشت کامل شد؛ دارم تصویر نهایی فازت را می‌سازم…" : "دارم تصویر این فاز را می‌سازم؛ ممکن است کمی طول بکشد…");
  showImageProgress();
  try {
    session = await api(`/api/sessions/${session.id}/image`, { method: "POST" }, 90000);
    render();
    status.textContent = "تصویر آماده شد و لینک آن داخل گفت‌وگو قرار گرفت.";
  } catch (error) { status.textContent = error.message; }
  finally { setBusy(false); input.focus(); }
}

$("#start").addEventListener("click", async () => { showWorkspace(); if (!session) await create(); });
$("#newChat").addEventListener("click", () => { if (!busy) $("#newChatModal").showModal(); });
$("#newChatModal").addEventListener("close", async () => {
  if ($("#newChatModal").returnValue !== "confirm") return;
  setBusy(true, "دارم یک گفت‌وگوی تازه آماده می‌کنم…");
  try {
    if (!session) await create();
    else session = await api(`/api/sessions/${session.id}/reset`, { method: "POST" });
    showWorkspace(); render(); status.textContent = "";
  } catch (error) { status.textContent = error.message; }
  finally { setBusy(false); }
});

$("#chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  const content = input.value.trim();
  if (!content || !session) return;
  input.value = "";
  renderMessage({ role: "user", content, emoji: session.phase?.emoji || "◌" });
  setBusy(true);
  showThinking();
  try {
    session = await api(`/api/sessions/${session.id}/chat`, { method: "POST", body: JSON.stringify({ message: content }) });
    setBusy(false);
    status.textContent = "";
    render();
    if (session.autoGenerateImage) await makeImage({ automatic: true });
  } catch (error) {
    setBusy(false);
    status.textContent = error.message;
    input.value = content;
  } finally { input.focus(); }
});

function showToast(message, error = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
}

async function copyText(text) {
  if (!text) throw new Error("لینکی برای کپی وجود ندارد.");
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;opacity:0;pointer-events:none;inset:0";
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, area.value.length);
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw new Error("مرورگر اجازهٔ کپی نداد؛ لینک را دستی انتخاب کن.");
  }
}

$("#copyLink").addEventListener("click", async () => {
  try { await copyText($("#shareUrl").value); $("#copyLink").textContent = "کپی شد"; showToast("لینک تصویر کپی شد"); }
  catch (error) { showToast(error.message, true); }
  setTimeout(() => $("#copyLink").textContent = "کپی", 1600);
});

$("#copyReturnLink").addEventListener("click", async () => {
  if (!session?.returnUrl) return;
  try { await copyText(session.returnUrl); $("#copyReturnLink").textContent = "لینک خصوصی کپی شد"; showToast("لینک بازگشت خصوصی کپی شد؛ فقط برای خودت نگهش دار"); }
  catch (error) { showToast(error.message, true); }
  setTimeout(() => $("#copyReturnLink").textContent = "کپی لینک بازگشت خصوصی", 1800);
});

$("#historyToggle").addEventListener("click", () => $("#historyPanel").classList.add("open"));
$("#historyClose").addEventListener("click", () => $("#historyPanel").classList.remove("open"));
$("#historyDetailClose").addEventListener("click", () => $("#historyDetailModal").close());

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (!busy) $("#chatForm").requestSubmit(); }
});

function credentialsFromHash() {
  const resume = new URLSearchParams(location.hash.slice(1)).get("resume");
  if (!resume) return null;
  const separator = resume.indexOf(".");
  if (separator < 1) return null;
  const restored = { id: resume.slice(0, separator), secret: resume.slice(separator + 1) };
  localStorage.setItem("fazm-session", JSON.stringify(restored));
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  return restored;
}

const saved = credentialsFromHash() || credentials();
if (saved) {
  session = saved;
  api(`/api/sessions/${saved.id}`).then((restored) => { session = restored; showWorkspace(); render(); }).catch(() => localStorage.removeItem("fazm-session"));
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
}
