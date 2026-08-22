import test from "node:test";
import assert from "node:assert/strict";
import { isCrisisText, localPhaseGuess, makePhaseSvg, normalizePhase } from "../src/mood.js";

test("detects clear crisis language", () => assert.equal(isCrisisText("فکر خودکشی دارم"), true));
test("does not flag ordinary sadness", () => assert.equal(isCrisisText("امروز خیلی ناراحتم"), false));
test("local guess recognizes common Persian feelings", () => assert.equal(localPhaseGuess("خیلی خسته و بی انرژی‌ام").primary, "خسته"));
test("normalization clamps numeric fields and rejects bad colors", () => {
  const phase = normalizePhase({ intensity: 200, valence: -500, palette: ["red"] });
  assert.equal(phase.intensity, 100);
  assert.equal(phase.valence, -100);
  assert.equal(phase.palette.length, 3);
});
test("svg contains no private mood label", () => {
  const svg = makePhaseSvg({ label: "راز خصوصی" }, "seed");
  assert.ok(svg.startsWith("<?xml"));
  assert.equal(svg.includes("راز خصوصی"), false);
});
