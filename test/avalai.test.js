import test from "node:test";
import assert from "node:assert/strict";
import { normalizeInsights, separateReplyQuestion } from "../src/avalai.js";

test("keeps analysis in the reply and extracts an accidental embedded question", () => {
  const result = separateReplyQuestion("ذهنت بین چند کار کشیده شده. بیشتر فشار زمان اذیتت می‌کند یا انتخاب کار؟ نیازت احتمالاً یک نقطهٔ شروع روشن است.");
  assert.equal(result.reply.includes("؟"), false);
  assert.equal(result.reply.includes("نقطهٔ شروع روشن"), true);
  assert.equal(result.embeddedQuestion, "بیشتر فشار زمان اذیتت می‌کند یا انتخاب کار؟");
});

test("always returns six useful insight slots", () => {
  const insights = normalizeInsights({ currentNeed: "یک شروع روشن و کوچک" }, { primary: "آشفته", intensity: 68, energy: 32, valence: -45 });
  assert.equal(insights.length, 6);
  assert.equal(insights[4].value, "یک شروع روشن و کوچک");
  assert.equal(insights.every((item) => item.label && item.value), true);
});
