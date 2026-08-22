import crypto from "node:crypto";

export const DEFAULT_PHASE = {
  primary: "نامشخص",
  label: "هنوز داریم پیدایش می‌کنیم",
  emoji: "◌",
  intensity: 35,
  valence: 0,
  energy: 45,
  confidence: 0.2,
  palette: ["#5b5bd6", "#f4a7bb", "#f5d7a1"],
  imagePrompt: "an abstract quiet inner landscape, soft gradients, minimal, no text, no people"
};

const PHASE_RULES = [
  { words: ["خوشحال", "عالی", "ذوق", "شاد", "خوبم"], primary: "شاد", emoji: "✦", valence: 70, energy: 70, palette: ["#ffb703", "#fb8500", "#fff1b8"] },
  { words: ["عصبانی", "حرص", "خشم", "کلافه"], primary: "عصبانی", emoji: "↯", valence: -55, energy: 90, palette: ["#d62828", "#f77f00", "#3d0c11"] },
  { words: ["ناراحت", "غمگین", "دلم گرفته", "گریه"], primary: "غمگین", emoji: "≈", valence: -65, energy: 30, palette: ["#355070", "#6d597a", "#b8c0d9"] },
  { words: ["خسته", "بی انرژی", "بی‌انرژی", "فرسوده"], primary: "خسته", emoji: "…", valence: -25, energy: 15, palette: ["#6b705c", "#a5a58d", "#ddbea9"] },
  { words: ["استرس", "مضطرب", "نگران", "دلشوره"], primary: "مضطرب", emoji: "≋", valence: -50, energy: 75, palette: ["#4a4e69", "#9a8c98", "#c9ada7"] },
  { words: ["کسل", "حوصله", "بی حوصله", "بی‌حوصله"], primary: "بی‌حوصله", emoji: "○", valence: -20, energy: 20, palette: ["#577590", "#90be6d", "#d9ed92"] }
];

export function localPhaseGuess(text) {
  const normalized = text.toLowerCase();
  const rule = PHASE_RULES.find((item) => item.words.some((word) => normalized.includes(word)));
  if (!rule) return null;
  return {
    ...DEFAULT_PHASE,
    ...rule,
    label: `یه جور حسِ ${rule.primary}`,
    intensity: 62,
    confidence: 0.55,
    imagePrompt: `minimal abstract emotional landscape expressing ${rule.primary}, organic shapes, cinematic light, no text, no face`
  };
}

export function isCrisisText(text) {
  return /(خودکشی|خودمو بکشم|خودم را بکشم|دیگه نمی.?خوام زنده|آسیب به خودم|کشتن خودم)/i.test(text);
}

export function normalizePhase(input = {}) {
  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  const palette = Array.isArray(input.palette)
    ? input.palette.filter((color) => /^#[0-9a-f]{6}$/i.test(color)).slice(0, 3)
    : [];
  return {
    primary: String(input.primary || DEFAULT_PHASE.primary).slice(0, 40),
    label: String(input.label || DEFAULT_PHASE.label).slice(0, 80),
    emoji: String(input.emoji || DEFAULT_PHASE.emoji).slice(0, 4),
    intensity: clamp(input.intensity, 0, 100, 50),
    valence: clamp(input.valence, -100, 100, 0),
    energy: clamp(input.energy, 0, 100, 50),
    confidence: clamp(input.confidence, 0, 1, 0.5),
    palette: palette.length === 3 ? palette : DEFAULT_PHASE.palette,
    imagePrompt: String(input.imagePrompt || DEFAULT_PHASE.imagePrompt).slice(0, 800)
  };
}

export function makePhaseSvg(phase, seed = "fazm") {
  const safe = normalizePhase(phase);
  const [a, b, c] = safe.palette;
  const hash = crypto.createHash("sha256").update(seed + safe.label).digest();
  const x = 20 + (hash[0] % 60);
  const y = 20 + (hash[1] % 60);
  const turbulence = (0.008 + safe.energy / 9000).toFixed(3);
  const intensity = (0.25 + safe.intensity / 150).toFixed(2);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" role="img" aria-label="تصویر انتزاعی یک حال درونی">
  <defs>
    <radialGradient id="g1" cx="${x}%" cy="${y}%" r="85%"><stop stop-color="${a}"/><stop offset=".5" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></radialGradient>
    <filter id="f"><feTurbulence baseFrequency="${turbulence}" numOctaves="3" seed="${hash[2]}"/><feDisplacementMap in="SourceGraphic" scale="${20 + safe.intensity}"/></filter>
    <filter id="grain"><feTurbulence baseFrequency=".7" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 .11 0"/></filter>
  </defs>
  <rect width="1200" height="1200" fill="url(#g1)"/>
  <circle cx="${250 + hash[3] * 2}" cy="${240 + hash[4]}" r="${190 + safe.energy * 2}" fill="${c}" opacity="${intensity}" filter="url(#f)"/>
  <path d="M-80 ${800 - safe.energy * 2} Q 300 ${450 + hash[5]} 620 ${720 - safe.valence} T 1280 ${520 + safe.intensity}" fill="none" stroke="${a}" stroke-width="${90 + safe.intensity}" opacity=".45" filter="url(#f)"/>
  <rect width="1200" height="1200" filter="url(#grain)" opacity=".5"/>
</svg>`;
}
