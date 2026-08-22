import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_PHASE } from "./mood.js";

const dataDir = path.resolve("data");
const dbPath = path.join(dataDir, "db.json");
const imagesDir = path.join(dataDir, "images");
let state = { sessions: {} };
let writeChain = Promise.resolve();

export async function initStore() {
  await fs.mkdir(imagesDir, { recursive: true });
  try {
    state = JSON.parse(await fs.readFile(dbPath, "utf8"));
    for (const session of Object.values(state.sessions || {})) {
      session.phaseHistory ||= [];
      session.readyToShare ||= false;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await persist();
  }
}

function persist() {
  writeChain = writeChain.then(async () => {
    const tmp = `${dbPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await fs.rename(tmp, dbPath);
  });
  return writeChain;
}

const token = (bytes = 18) => crypto.randomBytes(bytes).toString("base64url");

export async function createSession() {
  const id = crypto.randomUUID();
  const session = {
    id,
    secret: token(24),
    shareSlug: token(9),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    phase: DEFAULT_PHASE,
    messages: [],
    imageFile: null,
    phaseHistory: [],
    readyToShare: false
  };
  state.sessions[id] = session;
  await persist();
  return session;
}

export function getOwnedSession(id, secret) {
  const session = state.sessions[id];
  if (!session || typeof secret !== "string" || secret.length !== session.secret.length) return null;
  return crypto.timingSafeEqual(Buffer.from(session.secret), Buffer.from(secret)) ? session : null;
}

export function getByShareSlug(slug) {
  return Object.values(state.sessions).find((session) => session.shareSlug === slug) || null;
}

export async function updateSession(id, changes) {
  const session = state.sessions[id];
  if (!session) return null;
  Object.assign(session, changes, { updatedAt: new Date().toISOString() });
  await persist();
  return session;
}

export async function saveImage(session, bytes, historyId, extension = "png") {
  const safeExt = ["png", "jpg", "jpeg", "webp"].includes(extension) ? extension : "png";
  const safeHistoryId = String(historyId || "current").replace(/[^a-zA-Z0-9_-]/g, "");
  const file = `${session.id}-${safeHistoryId}.${safeExt}`;
  await fs.writeFile(path.join(imagesDir, file), bytes);
  const phaseHistory = (session.phaseHistory || []).map((item) => item.id === historyId ? { ...item, imageFile: file } : item);
  await updateSession(session.id, { imageFile: file, phaseHistory, readyToShare: false });
  return file;
}

export function imagePath(file) {
  return path.join(imagesDir, path.basename(file));
}
