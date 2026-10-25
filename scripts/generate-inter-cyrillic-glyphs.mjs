// Inter Medium glyph ranges for the Russian map (Cyrillic and general punctuation), so Russian labels
// use the same typeface as the English map instead of a generic fallback. Glyphs are rendered from the
// self-hosted Inter variable font at weight 500 with TinySDF (24 px, buffer 3, radius 8, the MapLibre
// glyph convention) and aligned to the existing Latin ranges by measuring "A" in both.
//
//   node scripts/generate-inter-cyrillic-glyphs.mjs
import { readFile, writeFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { chromium } from "@playwright/test";
import { PbfReader, PbfWriter } from "pbf";

const DIRECTORY = "public/maps/fonts/inter-medium-v1";
const RANGES = [1024, 1280, 8192];

function readGlyphs(buffer) {
  const glyphs = [];
  new PbfReader(buffer).readFields((tag, _, pbf) => {
    if (tag !== 1) return;
    pbf.readMessage((stackTag, __, stack) => {
      if (stackTag !== 3) return;
      const glyph = {};
      stack.readMessage((field, ___, reader) => {
        if (field === 1) glyph.id = reader.readVarint();
        else if (field === 5) glyph.left = reader.readSVarint();
        else if (field === 6) glyph.top = reader.readSVarint();
        else if (field === 7) glyph.advance = reader.readVarint();
      }, glyph);
      glyphs.push(glyph);
    }, null);
  }, null);
  return glyphs;
}

const latin = readGlyphs(gunzipSync(await readFile(`${DIRECTORY}/0-255.pbf.gz`)));
const reference = latin.find((glyph) => glyph.id === 65);
const [font, sdf] = await Promise.all([readFile("public/fonts/inter-roman.var.woff2"), readFile("node_modules/@mapbox/tiny-sdf/index.js", "utf8")]);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<style>@font-face{font-family:InterMap;font-weight:100 900;src:url(data:font/woff2;base64,${font.toString("base64")}) format("woff2")}</style>`);
  await page.addScriptTag({ content: `${sdf.replace("export default class TinySDF", "class TinySDF")}\nglobalThis.FontSdf=TinySDF;` });
  await page.evaluate(async () => { await document.fonts.load("500 24px InterMap", "AЖ"); });
  const draw = (start) => page.evaluate((start) => {
    const sdf = new globalThis.FontSdf({ fontSize: 24, fontFamily: "InterMap", fontWeight: "500", buffer: 3, radius: 8, cutoff: 0.25 });
    const glyph = (id) => { const char = sdf.draw(String.fromCodePoint(id)); return { id, bitmap: Array.from(char.data), width: char.glyphWidth, height: char.glyphHeight, left: char.glyphLeft, top: char.glyphTop, advance: char.glyphAdvance }; };
    return start === null ? glyph(65) : Array.from({ length: 256 }, (_, offset) => glyph(start + offset));
  }, start);
  // Align the new glyphs to the Latin ranges already served: same top, left and advance for "A".
  const probe = await draw(null);
  const shift = { top: reference.top - Math.round(probe.top), left: reference.left - Math.round(probe.left), advance: reference.advance - Math.round(probe.advance) };
  for (const start of RANGES) {
    const range = `${start}-${start + 255}`;
    const glyphs = await draw(start);
    const writer = new PbfWriter();
    writer.writeMessage(1, (list, pbf) => {
      pbf.writeStringField(1, "Inter Medium");
      pbf.writeStringField(2, range);
      for (const glyph of list) {
        if (!glyph.width || !glyph.height) { pbf.writeMessage(3, (empty, inner) => { inner.writeVarintField(1, empty.id); inner.writeVarintField(3, 0); inner.writeVarintField(4, 0); inner.writeSVarintField(5, 0); inner.writeSVarintField(6, 0); inner.writeVarintField(7, Math.max(0, Math.round(empty.advance) + shift.advance)); }, glyph); continue; }
        pbf.writeMessage(3, (item, inner) => {
          inner.writeVarintField(1, item.id);
          inner.writeBytesField(2, Uint8Array.from(item.bitmap));
          inner.writeVarintField(3, item.width);
          inner.writeVarintField(4, item.height);
          inner.writeSVarintField(5, Math.round(item.left) + shift.left);
          inner.writeSVarintField(6, Math.round(item.top) + shift.top);
          inner.writeVarintField(7, Math.max(0, Math.round(item.advance) + shift.advance));
        }, glyph);
      }
    }, glyphs);
    const data = writer.finish();
    await writeFile(`${DIRECTORY}/${range}.pbf`, data);
    await writeFile(`${DIRECTORY}/${range}.pbf.gz`, gzipSync(data, { level: 9 }));
    console.log(JSON.stringify({ range, bytes: data.length }));
  }
  console.log(JSON.stringify({ shift }));
} finally {
  await browser.close();
}
