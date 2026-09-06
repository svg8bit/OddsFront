import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const brand = path.join(root, "assets/brand/oddsfront");
const output = path.join(root, "output/brand-identity");
const publicBrand = path.join(root, "public/brand");
const tokens = JSON.parse(await fs.readFile(path.join(brand, "tokens.json"), "utf8"));
const svgs = new Map();
await fs.mkdir(path.join(output, "png"), { recursive: true });
await fs.mkdir(path.join(output, "social"), { recursive: true });
await fs.mkdir(path.join(output, "platform-icons"), { recursive: true });

for (const file of (await fs.readdir(path.join(brand, "svg"))).sort()) {
  if (!file.endsWith(".svg")) continue;
  const source = await fs.readFile(path.join(brand, "svg", file));
  const name = file.replace(/\.svg$/, "");
  svgs.set(name, source.toString());
  const width = name.startsWith("logo-horizontal") || name.startsWith("wordmark") ? 2400 : name.startsWith("icon") ? 1024 : 1200;
  await sharp(source).resize({ width }).png().toFile(path.join(output, "png", `${name}.png`));
}

const source = Buffer.from(svgs.get("icon-rounded-gradient"));
const square = Buffer.from(svgs.get("icon-square-gradient"));
await fs.writeFile(path.join(publicBrand, "oddsfront-icon-v1.svg"), source);
await fs.writeFile(path.join(publicBrand, "oddsfront-pinned-tab-v1.svg"), svgs.get("safari-pinned-tab"));
for (const size of [16, 32, 48, 64, 96, 128, 192, 256, 512]) {
  const bytes = await sharp(source).resize(size, size).png().toBuffer();
  await fs.writeFile(path.join(output, "platform-icons", `favicon-${size}.png`), bytes);
  if ([32, 48, 96].includes(size)) await fs.writeFile(path.join(publicBrand, `oddsfront-favicon-${size}-v1.png`), bytes);
}
for (const size of [192, 512]) {
  await sharp(square).resize(size, size).png().toFile(path.join(publicBrand, `oddsfront-app-${size}-v1.png`));
}
await sharp(square).resize(180, 180).png().toFile(path.join(publicBrand, "oddsfront-apple-touch-icon-v1.png"));
await fs.copyFile(path.join(publicBrand, "oddsfront-apple-touch-icon-v1.png"), path.join(root, "public/apple-touch-icon.png"));
await sharp(Buffer.from(svgs.get("icon-maskable"))).png().toFile(path.join(publicBrand, "oddsfront-maskable-512-v1.png"));

// Real multi-resolution ICO with uncompressed 32-bit DIB entries, including
// explicit AND masks, for clients that do not support SVG or PNG-in-ICO.
const icoSizes = [16, 32, 48, 64];
const icoHeader = Buffer.alloc(6 + 16 * icoSizes.length);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(icoSizes.length, 4);
const frames = [];
let offset = icoHeader.length;
for (const [index, size] of icoSizes.entries()) {
  const pixels = await sharp(source).resize(size, size).ensureAlpha().raw().toBuffer();
  const maskStride = Math.ceil(size / 32) * 4;
  const frame = Buffer.alloc(40 + size * size * 4 + maskStride * size);
  frame.writeUInt32LE(40, 0);
  frame.writeInt32LE(size, 4);
  frame.writeInt32LE(size * 2, 8);
  frame.writeUInt16LE(1, 12);
  frame.writeUInt16LE(32, 14);
  frame.writeUInt32LE(size * size * 4, 20);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dest = 40 + ((size - 1 - y) * size + x) * 4;
      frame[dest] = pixels[src + 2];
      frame[dest + 1] = pixels[src + 1];
      frame[dest + 2] = pixels[src];
      frame[dest + 3] = pixels[src + 3];
      if (pixels[src + 3] === 0) frame[40 + size * size * 4 + (size - 1 - y) * maskStride + (x >> 3)] |= 0x80 >> (x % 8);
    }
  }
  const entry = 6 + index * 16;
  icoHeader[entry] = size;
  icoHeader[entry + 1] = size;
  icoHeader.writeUInt16LE(1, entry + 4);
  icoHeader.writeUInt16LE(32, entry + 6);
  icoHeader.writeUInt32LE(frame.length, entry + 8);
  icoHeader.writeUInt32LE(offset, entry + 12);
  frames.push(frame);
  offset += frame.length;
}
await fs.writeFile(path.join(root, "public/favicon.ico"), Buffer.concat([icoHeader, ...frames]));

const manifest = {
  id: "/", name: "OddsFront", short_name: "OddsFront",
  description: "Live conflict and geopolitics prediction market map.",
  lang: "en", start_url: "/", scope: "/", display: "browser",
  background_color: "#0F172A", theme_color: "#020a16",
  icons: [
    { src: "/brand/oddsfront-app-192-v1.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/brand/oddsfront-app-512-v1.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/brand/oddsfront-maskable-512-v1.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};
await fs.writeFile(path.join(root, "public/site.webmanifest"), JSON.stringify(manifest, null, 2) + "\n");

const font = (await fs.readFile(path.join(root, "public/fonts/inter-latin.var.woff2"))).toString("base64");
const fontStyle = `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900;font-style:normal;font-display:block;}`;
const dataSvg = (name) => `data:image/svg+xml;base64,${Buffer.from(svgs.get(name)).toString("base64")}`;
const img = (name, style = "", cls = "") => `<img class="${cls}" src="${dataSvg(name)}" alt="OddsFront ${name.replaceAll("-", " ")}" style="${style}">`;
const pngData = async (file) => `data:image/png;base64,${(await fs.readFile(file)).toString("base64")}`;
const browser = await chromium.launch({ headless: true, chromiumSandbox: false });
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function raster(name, width, height, html, css = "") {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${fontStyle}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%}body{font-family:Inter,sans-serif;color:#F8FAFC;background:#0F172A}img{display:block;max-width:100%} ${css}</style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(output, "social", `${name}.png`), animations: "disabled" });
}

await raster("social-preview-1200x630", 1200, 630,
  `<div class="eyebrow">DATA / PERSPECTIVE / BETTER DECISIONS</div>${img("logo-horizontal-reversed", "width:980px;position:absolute;left:108px;top:180px")}
  <div class="sub">Live conflict &amp; geopolitics prediction markets.</div><div class="foot">oddsfront.com <span>See the world through the odds.</span></div>`,
  `.eyebrow{position:absolute;top:68px;left:108px;font-size:15px;letter-spacing:3px;color:#A5A8FC}.sub{position:absolute;top:365px;left:108px;font-size:26px;color:#C8CEDB}.foot{position:absolute;left:108px;right:108px;bottom:55px;padding-top:25px;border-top:1px solid #374151;font-size:19px}.foot span{float:right;color:#919BAD;font-size:16px}`);
await fs.copyFile(path.join(output, "social/social-preview-1200x630.png"), path.join(publicBrand, "oddsfront-social-preview-v2.png"));
await raster("profile-header-1500x500", 1500, 500,
  `${img("logo-horizontal-reversed", "width:770px;position:absolute;right:95px;top:110px")}<p>Data. Perspective. Better decisions.</p>`,
  `body{background:linear-gradient(115deg,#111B31,#0F172A)}p{position:absolute;left:636px;top:289px;font-size:27px;color:#CBD5E1;margin:0}`);
await raster("social-square-1080x1080", 1080, 1080,
  `<div class="kicker">ODDSFRONT / PERSPECTIVE</div>${img("logo-horizontal-reversed", "width:850px;position:absolute;top:178px;left:115px")}<h1>See the world<br>through the odds.</h1><p>Live conflict &amp; geopolitics prediction markets.</p><footer>oddsfront.com <span>DATA → PERSPECTIVE</span></footer>`,
  `.kicker{position:absolute;left:115px;top:82px;letter-spacing:3px;font-size:17px;color:#A5A8FC}h1{position:absolute;left:115px;top:411px;font-size:82px;letter-spacing:-4px;font-weight:650;line-height:1.04;margin:0}p{position:absolute;left:115px;top:652px;font-size:23px;color:#CBD5E1}footer{position:absolute;left:115px;right:115px;bottom:82px;border-top:1px solid #374151;padding-top:32px;font-size:23px}footer span{float:right;font-size:16px;letter-spacing:2px;color:#A5A8FC}`);
await raster("story-1080x1920", 1080, 1920,
  `${img("logo-horizontal-reversed", "width:850px;position:absolute;top:225px;left:115px")}<div class="line"></div><h1>Data.<br>Perspective.<br><span>Better<br>decisions.</span></h1><p>Live conflict &amp; geopolitics<br>prediction markets.</p><footer>oddsfront.com</footer>`,
  `.line{position:absolute;top:523px;left:115px;right:115px;border-top:1px solid #374151}h1{position:absolute;top:640px;left:115px;font-size:108px;letter-spacing:-5px;line-height:1.04;font-weight:650;margin:0}h1 span{color:#A5A8FC}p{position:absolute;top:1265px;left:115px;font-size:30px;line-height:1.55;color:#CBD5E1}footer{position:absolute;bottom:255px;left:115px;font-size:32px}`);

const socialPreview = await pngData(path.join(output, "social/social-preview-1200x630.png"));
const socialSquare = await pngData(path.join(output, "social/social-square-1080x1080.png"));
const socialStory = await pngData(path.join(output, "social/story-1080x1920.png"));
const socialHeader = await pngData(path.join(output, "social/profile-header-1500x500.png"));
const pages = [];
function section(title, subtitle, body, className = "") {
  const number = String(pages.length + 1).padStart(2, "0");
  pages.push(`<section class="page ${className}"><header><span>ODDSFRONT / BRAND GUIDELINES</span><span>IDENTITY SYSTEM · 1.0</span></header><div class="heading"><h1>${title}</h1><p>${subtitle}</p></div>${body}<footer><span>OddsFront</span><span>SEPTEMBER 2026</span><span>${number} / 16</span></footer></section>`);
}
const box = (content, className = "", caption = "") => `<div class="box ${className}">${content}${caption ? `<span class="caption">${caption}</span>` : ""}</div>`;
const rule = (number, title, copy) => `<div class="rule"><b>${number}</b><div><h3>${title}</h3><p>${copy}</p></div></div>`;

section("Brand identity", "A modern identity for a more informed tomorrow.",
  `<div class="cover-mark">${img("logo-horizontal-primary")}</div><div class="cover-bottom"><h2>Data.<br>Perspective.<br><em>Better decisions.</em></h2><p>One mark.<br>A consistent identity.<br>Every external touchpoint.</p></div>`, "cover");
section("A clearer perspective", "The identity turns a complex world into a clear, recognizable signal.",
  `<div class="two"><div>${img("symbol-primary", "width:290px;margin:35px 0 65px")}<h2>Parallel lines.<br>Shared direction.</h2><p class="lead">OddsFront maps live conflict and geopolitics prediction markets. Its identity is precise, calm and direct.</p></div><div class="rules">${rule("01", "Clarity", "Lead with the signal. Use generous space, clear typography and one visual focus.")}${rule("02", "Perspective", "Two parallel strokes form one distinctive mark. Preserve their angle, spacing and equal width.")}${rule("03", "Consistency", "Use the supplied masters across browser icons, social profiles, previews and project resources.")}</div></div>`);
section("The primary signature", "The symbol and the wordmark form the preferred horizontal lockup.",
  box(img("logo-horizontal-primary", "width:990px"), "hero light", "PRIMARY / LIGHT BACKGROUND") + `<div class="two lower">${box(img("logo-horizontal-reversed", "width:510px"), "navy", "REVERSED / DARK BACKGROUND")}${box(img("wordmark-primary", "width:470px"), "light", "WORDMARK / WHEN THE SYMBOL IS ALREADY PRESENT")}</div>`);
section("Built from two strokes", "Normalized vector geometry derived from the supplied logo references.",
  `<div class="two"><div class="construction"><div class="measure-top">300 units</div><svg viewBox="-24 -28 348 286"><defs><pattern id="grid" width="25" height="28" patternUnits="userSpaceOnUse"><path d="M25 0H0V28" fill="none" stroke="#DCE0EF" stroke-width=".6"/></pattern></defs><rect x="-20" y="-24" width="340" height="272" fill="url(#grid)"/><path d="${tokens.symbol.path}" fill="#6366F1"/><path d="M0 0H300V224H0Z" fill="none" stroke="#0F172A" stroke-dasharray="3 3" stroke-width=".8"/></svg><span>224 units</span></div><div class="rules">${rule("72", "Equal stroke widths", "Both bars have the same horizontal width. Their top and bottom edges remain level.")}${rule("50", "Consistent separation", "The horizontal gap between strokes is fixed at 50 units at every height.")}${rule("25.3°", "A shared forward lean", "The strokes shift 106 units horizontally across a 224-unit height. Do not rotate or reshape them.")}</div></div>`);
section("A flexible lockup system", "Choose the composition for the available space, then keep its proportions fixed.",
  `<div class="two lockups">${box(img("logo-horizontal-primary", "width:540px"), "light", "HORIZONTAL / DEFAULT SIGNATURE")}${box(img("logo-stacked-primary", "width:270px"), "light", "STACKED / CENTERED COMPOSITIONS")}${box(img("wordmark-primary", "width:440px"), "light", "WORDMARK / TEXT-LED PLACEMENTS")}${box(img("symbol-primary", "width:172px"), "light", "SYMBOL / SMALL OR REPEATED BRAND SURFACES")}</div>`);
section("Color, reversed, monochrome", "Use the supplied variant that gives the mark a clear silhouette.",
  `<div class="two lockups">${box(img("logo-horizontal-primary", "width:540px"), "light", "PRIMARY / PERIWINKLE + DEEP NAVY")}${box(img("logo-horizontal-reversed", "width:540px"), "navy", "REVERSED / PERIWINKLE + WHITE")}${box(img("logo-horizontal-black", "width:540px"), "white", "ONE COLOR / BLACK")}${box(img("logo-horizontal-white", "width:540px"), "purple", "ONE COLOR / WHITE")}</div>`);

const colors = [
  ["Periwinkle", "#6366F1", "99, 102, 241", "59, 58, 0, 5", "Primary brand color"],
  ["Deep Navy", "#0F172A", "15, 23, 42", "64, 45, 0, 84", "Primary type / dark field"],
  ["Charcoal", "#374151", "55, 65, 81", "32, 20, 0, 68", "Secondary text"],
  ["Light Gray", "#F8FAFC", "248, 250, 252", "2, 1, 0, 1", "Light background"],
];
section("Four colors. One identity.", "The core palette follows the supplied brand reference.",
  `<div class="palette">${colors.map(([name, hex, rgb, cmyk, use]) => `<div><div class="swatch" style="background:${hex}"></div><h3>${name}</h3><b>${hex}</b><p>RGB ${rgb}<br>CMYK ≈ ${cmyk}</p><small>${use}</small></div>`).join("")}</div><div class="palette-bottom"><div class="gradient-chip"></div><div><h3>Optional icon gradient</h3><p>#6366F1 → #5548FF. Keep flat color for the primary logo and monochrome masters.</p></div><p>Digital masters use sRGB.<br>CMYK values are calculated starting points.<br>Approve a physical proof before print.</p></div>`);
section("Typography with intention", "Inter keeps the identity legible, contemporary and consistent with the product.",
  `<div class="two"><div class="type-display">Aa<span>Inter</span><p>ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>abcdefghijklmnopqrstuvwxyz<br>0123456789 / % + − →</p></div><div class="type-scale"><div><b>750</b><h2>OddsFront</h2><p>Production wordmark · outlined masters · tracking −0.035em</p></div><div><b>700</b><h2 style="font-size:42px">Clear perspective</h2><p>Headings · strong, concise hierarchy</p></div><div><b>400</b><p class="lead">Make complex information easier to read.</p><p>Body copy · comfortable line height of 1.45–1.6</p></div><p class="note">The raster references did not include a font file. The production wordmark is reconstructed in Inter 750 and delivered as vector outlines; no installed font is required to use the logos.</p></div></div>`);
section("Space protects the mark", "The reference defines X as the height of the symbol. Leave at least 1X around the logo.",
  `<div class="clearspace"><div class="safe-label">1X CLEAR SPACE</div><div class="safe-inner">${img("logo-horizontal-primary", "width:690px")}</div></div><div class="three size-row"><div><h3>Horizontal</h3>${img("logo-horizontal-primary", "width:144px")}<p>144 px digital / 30 mm print</p></div><div><h3>Stacked</h3>${img("logo-stacked-primary", "width:100px;height:64px;object-fit:contain")}<p>100 px digital / 22 mm print</p></div><div><h3>Symbol</h3><div class="icon-size-line">${[16,24,32,48].map(size => img("icon-rounded-gradient", `width:${size}px;height:${size}px`)).join("")}</div><p>16 px digital / 5 mm print</p></div></div><p class="note">Locked favicon, app-icon and avatar canvases use their supplied internal padding. Do not add the full logo clear space inside those canvases.</p>`);
section("Contrast before decoration", "Choose a readable pairing. Decorative brand color is not automatically suitable for small text.",
  `<div class="contrast-grid"><div class="contrast light"><span>Aa</span><h3>Deep Navy on Light Gray</h3><b>17.06 : 1</b><p>Suitable for normal and large text.</p></div><div class="contrast navy"><span>Aa</span><h3>White on Deep Navy</h3><b>17.85 : 1</b><p>Suitable for normal and large text.</p></div><div class="contrast purple"><span>Aa</span><h3>White on Periwinkle</h3><b>4.47 : 1</b><p>Large text and graphics only.<br>Below the 4.5 : 1 normal-text threshold.</p></div></div><div class="do-dont"><div><b class="good">DO</b><p>Keep proportions, clear space and approved colors. Use the white mark on busy dark backgrounds.</p></div><div><b class="bad">AVOID</b><p>Stretching, changing the angle, merging the strokes, outlining the wordmark, adding shadows, or placing the mark on low-contrast backgrounds.</p></div></div>`);
section("Icons and avatars", "The symbol carries the identity at small sizes. Reserve the wordmark for wider surfaces.",
  `<div class="icon-grid">${["rounded-gradient","square-purple","round-purple","rounded-light","square-dark","round-light","rounded-black","square-white","round-dark"].map((name) => `<div>${img(`icon-${name}`, "width:136px;height:136px")}<p>${name.replaceAll("-", " / ")}</p></div>`).join("")}</div><p class="note">Use the square source for platform-managed corner shapes. Use the rounded and circular variants only where the platform preserves the exported canvas.</p>`);
section("A recognizable browser presence", "Tabs, bookmarks, pinned shortcuts and saved home-screen icons share one identity.",
  `<div class="browser-example"><div class="browser-chrome"><span class="dots">● ● ●</span><div>${img("icon-rounded-gradient", "width:20px;height:20px")} OddsFront · Global Conflict Prediction Map <span>×</span></div><b>+</b></div><div class="browser-address">⌕ &nbsp; oddsfront.com</div><div class="browser-body"><p>Browser identity lives outside the page.</p><span>Existing website buttons, menu, map and DropsBot branding remain unchanged.</span></div></div><div class="three lower"><div><h3>Favicon</h3><p>SVG + PNG 32 / 48 / 96<br>ICO 16 / 32 / 48 / 64</p></div><div><h3>Apple &amp; pinned tabs</h3><p>Opaque Apple touch PNG · 180<br>Monochrome Safari SVG</p></div><div><h3>App icons</h3><p>PNG · 192 / 512<br>Maskable PNG · 512</p></div></div>`);
section("A first impression worth sharing", "A clean preview makes the brand visible when someone shares the map.",
  `<div class="two social-layout"><img class="social-card" src="${socialPreview}" alt="OddsFront social link preview"><div><h2>One identity.<br>Before the click.</h2><p class="lead">The preview carries the new logo, the product purpose and the canonical domain.</p><div class="rules">${rule("1200 × 630", "Link preview", "Open Graph, X cards and repository presentation.")}${rule("No live figures", "A stable brand asset", "Avoid dated odds, market results or claims that could become stale.")}</div></div></div>`);
section("A ready-to-use social family", "Consistent exports for square posts, vertical stories and wide profile headers.",
  `<div class="social-family"><div><img src="${socialSquare}" alt="Square social template"><p>SQUARE / 1080 × 1080</p></div><div><img src="${socialStory}" alt="Story template"><p>STORY / 1080 × 1920</p></div><div><img src="${socialHeader}" alt="Profile header template"><p>PROFILE HEADER / 1500 × 500</p><div class="social-avatar">${img("icon-round-purple", "width:116px;height:116px")}<div><h3>OddsFront</h3><p>Avatar masters<br>SVG + 1024 px PNG</p></div></div><p class="note">These are authored canvas presets. Check the current crop in the destination app before publishing, especially around avatars and profile controls.</p></div></div>`);
section("A restrained visual language", "Let the two-stroke geometry create rhythm without competing with the message.",
  `<div class="two patterns"><div class="pattern light">${img("symbol-primary", "width:375px;position:absolute;right:-65px;bottom:-36px;opacity:.1")}<h2>Data.<br>Perspective.<br>Better decisions.</h2><p>Use the mark as a quiet structural motif.</p></div><div class="pattern navy">${img("symbol-primary", "width:430px;position:absolute;right:-88px;top:32px;opacity:.35")}<h2>A global<br>perspective.</h2><p>Keep imagery and decoration secondary.</p></div></div><div class="three lower"><div><h3>Layout</h3><p>Generous margins.<br>Clear alignment.<br>One primary focal point.</p></div><div><h3>Voice</h3><p>Clear, calm and specific.<br>Describe what the data shows.<br>Avoid promises or certainty.</p></div><div><h3>Motion</h3><p>Short, subtle transitions.<br>Preserve the two-stroke shape.<br>Respect reduced-motion settings.</p></div></div>`);
section("Ready for every external surface", "Use the masters as the source of truth. Keep generated exports together with their version.",
  `<div class="two"><div class="delivery"><h3>Inside the package</h3><p><b>37</b> SVG masters with outlined wordmarks</p><p><b>37</b> high-resolution PNG logo variants</p><p><b>4</b> social and profile canvases</p><p><b>16</b> brandbook pages + editable HTML</p><p>Platform icons · design tokens · source references<br>SHA-256 inventory · reproducible generation scripts</p></div><div class="rules">${rule("01", "Start with the master", "Select horizontal, stacked, wordmark or symbol. Pick the matching color variant.")}${rule("02", "Choose the destination", "Use SVG for scalable artwork, transparent PNG for raster tools, and the dedicated exports for browsers and devices.")}${rule("03", "Respect the product boundary", "This release applies the new identity to external surfaces only. Existing website controls and DropsBot elements stay intact.")}</div></div>`, "last");

if (pages.length !== 16) throw new Error("The brandbook must contain exactly 16 pages.");
const css = `${fontStyle}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#DCE0EA;color:#0F172A;font-family:Inter,sans-serif}img{display:block;max-width:100%}p{color:#647084;line-height:1.55;font-size:20px;margin:12px 0}h1,h2,h3{margin:0;letter-spacing:-.04em}h1{font-size:58px;font-weight:700;line-height:1.12}h2{font-size:48px;line-height:1.13;font-weight:650}h3{font-size:25px;font-weight:650;letter-spacing:-.025em}em{font-style:normal;color:#6366F1}.page{position:relative;width:1440px;height:900px;background:#F8FAFC;padding:52px 80px 68px;margin:28px auto;overflow:hidden;break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}header{display:flex;justify-content:space-between;font-size:12px;font-weight:600;letter-spacing:2px;color:#8792A8;padding-bottom:26px;border-bottom:1px solid #DDE2EA}.heading{margin:34px 0 35px}.heading>p{font-size:20px;margin:12px 0 0}footer{position:absolute;left:80px;right:80px;bottom:30px;border-top:1px solid #DDE2EA;padding-top:18px;display:flex;justify-content:space-between;font-size:12px;color:#8C96A7;letter-spacing:1px}footer span:first-child{letter-spacing:-.3px;font-weight:650;font-size:15px}.two{display:grid;grid-template-columns:1fr 1fr;gap:36px}.three{display:grid;grid-template-columns:repeat(3,1fr);gap:40px}.lead{font-size:23px;max-width:550px}.rules{display:flex;flex-direction:column;gap:28px}.rule{display:flex;gap:26px;border-top:1px solid #DDE2EA;padding-top:23px}.rule>b{color:#6366F1;min-width:80px;font-size:23px;font-weight:550}.rule p{font-size:18px;margin-top:10px}.box{position:relative;display:flex;align-items:center;justify-content:center;min-height:218px;border:1px solid #DFE4ED;border-radius:14px;padding:28px 28px 54px}.caption{position:absolute;bottom:20px;left:26px;font-size:11px;letter-spacing:1.4px;color:#8D98AB}.light{background:#F1F4F9}.white{background:#FFF}.navy{background:#0F172A;color:white;border-color:#0F172A}.navy p{color:#BFC7D5}.purple{background:#6366F1;color:#FFF;border-color:#6366F1}.purple .caption{color:#DDDDFC}.hero{height:264px}.lower{margin-top:30px}.lockups .box{height:250px}.cover-mark{margin-top:60px;width:1210px}.cover .heading{margin-top:40px}.cover-bottom{display:flex;justify-content:space-between;align-items:flex-end;margin-top:43px}.cover-bottom h2{font-size:53px}.cover-bottom p{font-size:20px;text-align:right;line-height:1.65;padding-right:6px}.construction{position:relative;padding-top:0}.construction svg{display:block;width:540px}.measure-top{padding-left:240px;font-size:17px;color:#647084}.construction>span{position:absolute;right:15px;top:210px;writing-mode:vertical-rl;font-size:17px;color:#647084}.palette{display:grid;grid-template-columns:repeat(4,1fr);gap:28px}.swatch{height:194px;border-radius:12px;margin-bottom:25px;border:1px solid #E1E5EC}.palette b{display:block;font-size:24px;margin-top:12px}.palette p{font-size:16px;line-height:1.7}.palette small{font-size:15px;color:#8792A8}.palette-bottom{display:flex;gap:24px;align-items:center;border-top:1px solid #DDE2EA;padding-top:29px;margin-top:30px}.palette-bottom>p{font-size:14px;margin-left:auto;min-width:310px}.palette-bottom h3{font-size:22px}.palette-bottom p{font-size:16px}.gradient-chip{height:86px;min-width:120px;border-radius:12px;background:linear-gradient(135deg,#6366F1,#5548FF)}.type-display{font-size:205px;font-weight:650;line-height:1.05;letter-spacing:-15px}.type-display>span{display:block;font-size:53px;letter-spacing:-2px;margin-top:25px}.type-display p{font-size:21px;letter-spacing:1px;line-height:1.8;margin-top:50px;color:#374151}.type-scale>div{border-bottom:1px solid #DDE2EA;padding-bottom:20px;margin-bottom:20px}.type-scale b{float:right;color:#8C96A7;font-size:18px}.type-scale p{font-size:16px}.type-scale .lead{font-size:25px}.note{font-size:15px!important;line-height:1.55;color:#8C96A7}.clearspace{height:292px;border:1px dashed #BAC3D3;margin:5px 95px 25px;padding:75px 94px;position:relative}.safe-inner{border:1px dashed #9EA9BD;display:flex;justify-content:center;align-items:center;height:140px}.safe-label{position:absolute;top:28px;left:39px;font-size:14px;letter-spacing:2px;color:#919CAF}.size-row>div{border-top:1px solid #DDE2EA;padding-top:20px}.size-row h3{margin-bottom:20px}.size-row p{font-size:17px;margin-top:22px}.size-row{align-items:start}.icon-size-line{display:flex;gap:25px;height:64px;align-items:center}.contrast-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}.contrast{border-radius:14px;padding:25px 28px;min-height:326px}.contrast>span{font-size:84px;letter-spacing:-6px}.contrast h3{font-size:20px;margin:7px 0 15px}.contrast>b{font-size:26px;font-weight:550}.contrast p{font-size:16px}.contrast.purple p{color:#FFF}.do-dont{display:grid;grid-template-columns:1fr 1fr;gap:48px;margin-top:40px}.do-dont>div{border-top:1px solid #DDE2EA;padding-top:22px}.do-dont p{font-size:19px}.good{color:#167350}.bad{color:#AA334E}.icon-grid{display:grid;grid-template-columns:repeat(3,1fr);row-gap:26px}.icon-grid>div{display:flex;gap:23px;align-items:center}.icon-grid p{font-size:17px;text-transform:capitalize;max-width:120px}.icon-grid img{border:1px solid #E2E5EB;border-radius:0}.browser-example{border:1px solid #C9D0DE;border-radius:15px;overflow:hidden}.browser-chrome{height:57px;background:#E1E6EF;display:flex;align-items:center;gap:24px;padding:0 25px;color:#647084}.browser-chrome .dots{font-size:12px;letter-spacing:4px;color:#A1AABB}.browser-chrome>div{height:43px;align-self:flex-end;border-radius:10px 10px 0 0;padding:10px 15px;background:#F8FAFC;font-size:14px;display:flex;gap:12px;align-items:center}.browser-chrome>div span{margin-left:25px}.browser-address{height:49px;padding:13px 32px;background:#F8FAFC;color:#7B879A;font-size:16px}.browser-body{height:236px;background:#0F172A;text-align:center;padding:67px 30px}.browser-body p{font-size:27px;color:white;margin-top:0}.browser-body span{font-size:17px;color:#AAB5C7}.social-layout{grid-template-columns:1.16fr 1fr;align-items:center;gap:48px;padding-top:23px}.social-card{border-radius:12px;border:1px solid #DDE2EA;width:100%;box-shadow:0 18px 48px #0F172A14}.social-layout h2{font-size:44px}.social-layout .rule>b{min-width:110px;font-size:18px}.social-layout .rule h3{font-size:22px}.social-layout .rules{margin-top:35px}.social-family{display:grid;grid-template-columns:360px 234px 1fr;gap:28px;align-items:start}.social-family>div>img{width:100%;border-radius:8px}.social-family>div>p{font-size:13px;letter-spacing:.8px}.social-avatar{display:flex;align-items:center;gap:27px;margin-top:47px}.social-avatar h3{font-size:30px}.social-avatar p{font-size:18px}.social-family .note{letter-spacing:0;margin-top:32px}.patterns .pattern{height:315px;overflow:hidden;position:relative;padding:42px 34px;border-radius:12px}.pattern h2{position:relative;font-size:48px}.pattern p{position:absolute;bottom:20px;font-size:17px}.delivery{background:#EEF1F8;border-radius:12px;padding:34px 35px}.delivery>p{border-top:1px solid #DCE2EB;padding-top:12px;margin-top:16px;font-size:18px}.delivery b{display:inline-block;min-width:48px;color:#6366F1;font-size:30px;font-weight:650}.delivery>p:last-child{font-size:17px;line-height:1.7}.endline{font-size:38px;font-weight:550;letter-spacing:-1.4px;margin-top:42px;padding-top:28px;border-top:1px solid #DDE2EA}@page{size:1440px 900px;margin:0}@media print{html,body{background:#FFF}.page{margin:0}}
`;
const bookHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OddsFront Brand Guidelines v1.0</title><style>${css}</style></head><body>${pages.join("\n")}</body></html>`;
await fs.writeFile(path.join(brand, "oddsfront-brandbook-v1.html"), bookHtml);
await page.setViewportSize({ width: 1440, height: 950 });
await page.setContent(bookHtml, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
const overflow = await page.locator(".page").evaluateAll((elements) => elements.flatMap((element, index) => {
  const limit = element.getBoundingClientRect().bottom - 72;
  return [...element.querySelectorAll(".heading, .page > div, .page > p")].filter(child => child.getBoundingClientRect().bottom > limit).map(child => ({ page: index + 1, className: child.className, bottom: child.getBoundingClientRect().bottom - element.getBoundingClientRect().top }));
}));
if (overflow.length) throw new Error(`Brandbook page overflow: ${JSON.stringify(overflow)}`);
await page.pdf({ path: path.join(brand, "oddsfront-brandbook-v1.pdf"), preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
for (let index = 0; index < pages.length; index++) {
  await page.locator(".page").nth(index).screenshot({ path: path.join(output, `brandbook-page-${String(index + 1).padStart(2, "0")}.png`) });
}

// A compact overview is a real export contact sheet, not a design placeholder.
const sheet = `<div class="intro"><div>ODDSFRONT</div><h1>Brand Identity</h1><p>A modern identity for a more informed tomorrow.</p></div>
<div class="row primary"><div><h3>Primary Logo</h3>${img("logo-horizontal-primary")}</div><div><h3>Wordmark</h3>${img("wordmark-primary")}</div></div>
<div class="row icons"><div><h3>Icon</h3>${img("symbol-primary")}</div><div><h3>Square App Icon</h3>${img("icon-rounded-gradient")}</div><div><h3>Round App Icon</h3>${img("icon-round-light")}</div><div><h3>Monochrome</h3>${img("logo-horizontal-black")}</div></div>
<div class="row reverse"><div><h3>Reversed</h3><div class="dark">${img("logo-horizontal-reversed")}</div></div><div><h3>Lockups</h3><div class="mini">${img("logo-stacked-primary")}${img("logo-horizontal-primary")}</div></div></div>
<div class="row palette-row"><div><h3>Color Palette</h3><div class="swatches">${colors.map(([name, hex])=>`<div><i style="background:${hex}"></i><b>${name}</b><p>${hex}</p></div>`).join("")}</div></div><div><h3>Typography</h3><strong>Inter</strong><p>Clear. Precise. Legible.</p></div></div>
<div class="row usage"><div><h3>Light Background</h3>${img("logo-horizontal-primary")}</div><div class="dark"><h3>Dark Background</h3>${img("logo-horizontal-reversed")}</div><div><h3>App Icon</h3>${img("icon-rounded-gradient")}</div></div><div class="end">OddsFront <span>BRAND GUIDELINES · v1.0</span></div>`;
await raster("oddsfront-brand-overview", 1440, 1800, sheet,
  `body{background:#F8FAFC;color:#0F172A;padding:58px 64px}h1{font-size:82px;letter-spacing:-4px;margin:8px 0}h3{font-size:19px;color:#6C7990;font-weight:550;margin:0 0 30px}p{color:#94A0B6;margin:0;font-size:24px}.intro>div{font-size:17px;letter-spacing:5px;color:#94A0B6}.intro{height:210px}.row>div{min-width:0}.row{border-top:1px solid #DCE2ED;padding:32px 0;display:grid;gap:45px}.primary{grid-template-columns:1.15fr 1fr;height:236px}.primary img{width:100%;margin-top:40px}.icons{grid-template-columns:190px 230px 230px 1fr;height:290px}.icons img{width:145px;height:145px;object-fit:contain}.icons>div:last-child img{width:350px}.icons>div:nth-child(3) img{border-radius:50%;box-shadow:0 7px 24px #0F172A14}.reverse{grid-template-columns:1fr 1fr;height:273px}.dark{background:#0F172A;border-radius:14px}.reverse .dark{height:158px;padding:25px 35px;display:flex;align-items:center}.reverse .dark img{width:100%;height:100%;object-fit:contain}.mini{display:flex;gap:43px;align-items:center}.mini img:first-child{width:205px;height:160px;object-fit:contain}.mini img:last-child{width:280px}.palette-row{grid-template-columns:1.5fr 1fr;height:287px}.swatches{display:flex;gap:24px}.swatches i{display:block;width:136px;height:110px;border-radius:9px;border:1px solid #DCE2ED;margin-bottom:14px}.swatches b{font-size:17px;font-weight:550}.swatches p{font-size:17px;margin-top:8px}.palette-row strong{font-size:94px;letter-spacing:-5px;line-height:1.1}.palette-row>div:last-child p{font-size:20px;margin-top:10px}.usage{height:272px;grid-template-columns:1fr 1fr 220px;align-items:center}.usage>div{padding:23px 25px;height:168px}.usage h3{font-size:15px;margin-bottom:26px}.usage img{width:100%}.usage>div:last-child{padding-top:0}.usage>div:last-child img{width:132px;height:132px}.end{border-top:1px solid #DCE2ED;padding-top:24px;font-size:16px;color:#8A96AC}.end span{float:right;font-size:12px;letter-spacing:2px}`);
await fs.copyFile(path.join(output, "social/oddsfront-brand-overview.png"), path.join(brand, "oddsfront-brand-overview.png"));
await browser.close();

for (const file of (await fs.readdir(publicBrand)).filter(file => file.startsWith("oddsfront-") && !file.includes("social-preview-v1"))) {
  await fs.copyFile(path.join(publicBrand, file), path.join(output, "platform-icons", file));
}
for (const file of ["favicon.ico", "apple-touch-icon.png", "site.webmanifest"]) await fs.copyFile(path.join(root, "public", file), path.join(output, "platform-icons", file));
const inventory = [];
for (const [base, prefix] of [[brand, "brand"], [output, "exports"]]) {
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (!entry.name.startsWith("inventory")) {
        const bytes = await fs.readFile(file);
        inventory.push({ path: `${prefix}/${path.relative(base, file)}`, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
      }
    }
  }
  await walk(base);
}
await fs.writeFile(path.join(output, "inventory.json"), JSON.stringify({ brand: "OddsFront", version: "1.0", date: "2026-09-06", files: inventory }, null, 2) + "\n");
console.log(JSON.stringify({ svgMasters: svgs.size, brandbookPages: pages.length, exports: inventory.length, output, publicFavicon: "public/favicon.ico", preview: "public/brand/oddsfront-social-preview-v2.png" }, null, 2));
