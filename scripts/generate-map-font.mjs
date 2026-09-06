import { readFile, mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";
import { PbfWriter } from "pbf";

// Bake Inter's SDF glyphs once instead of generating them on every phone.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const font = await readFile("public/fonts/inter-latin.var.woff2");
  await page.setContent(`<style>@font-face{font-family:MapInter;src:url(data:font/woff2;base64,${font.toString("base64")});font-weight:100 900}</style>`);
  const source = await readFile("node_modules/@mapbox/tiny-sdf/index.js", "utf8");
  await page.addScriptTag({ content: source.replace("export default class TinySDF", "class TinySDF") + "\nglobalThis.FontSdf = TinySDF;" });
  const ranges = await page.evaluate(async () => {
    await document.fonts.load("500 24px MapInter");
    const sdf = new globalThis.FontSdf({ fontSize: 24, fontFamily: "MapInter", fontWeight: "500", buffer: 3, radius: 8, cutoff: 0.25 });
    return [0, 256, 512].map((start) => ({
      range: `${start}-${start + 255}`,
      glyphs: Array.from({ length: 256 }, (_, offset) => {
        const id = start + offset;
        const char = sdf.draw(String.fromCodePoint(id));
        return { id, bitmap: Array.from(char.data), width: char.glyphWidth, height: char.glyphHeight,
          left: Math.round(char.glyphLeft + 0.5), top: Math.round(char.glyphTop - 27.5), advance: Math.round(char.glyphAdvance) };
      }),
    }));
  });
  const directory = "public/maps/fonts/inter-medium-v1";
  await mkdir(directory, { recursive: true });
  for (const range of ranges) {
    const writer = new PbfWriter();
    writer.writeMessage(1, (stack, pbf) => {
      pbf.writeStringField(1, "Inter Medium");
      pbf.writeStringField(2, stack.range);
      for (const glyph of stack.glyphs) pbf.writeMessage(3, (glyph, pbf) => {
        pbf.writeVarintField(1, glyph.id);
        pbf.writeBytesField(2, Uint8Array.from(glyph.bitmap));
        pbf.writeVarintField(3, glyph.width);
        pbf.writeVarintField(4, glyph.height);
        pbf.writeSVarintField(5, glyph.left);
        pbf.writeSVarintField(6, glyph.top);
        pbf.writeVarintField(7, glyph.advance);
      }, glyph);
    }, range);
    const data = writer.finish();
    await writeFile(`${directory}/${range.range}.pbf`, data);
    const compressed = gzipSync(data, { level: 9 });
    await writeFile(`${directory}/${range.range}.pbf.gz`, compressed);
    process.stdout.write(`${range.range}: ${data.byteLength} bytes, ${compressed.byteLength} bytes compressed\n`);
  }
} finally {
  await browser.close();
}
