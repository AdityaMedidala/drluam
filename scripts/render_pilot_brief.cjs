// Render docs/pilot-brief.md to docs/pilot-brief.pdf (A4) with Playwright's Chromium.
// Usage (from the repo root): NODE_PATH=frontend/node_modules node scripts/render_pilot_brief.cjs
// A tiny Markdown subset (headings, paragraphs, nested lists, bold, italic) is converted inline,
// so the brief needs no extra dependency.
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "docs", "pilot-brief.md");
const OUT = path.join(ROOT, "docs", "pilot-brief.pdf");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");

function toHtml(md) {
  const out = [];
  const stack = [];           // open list indents
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const closeTo = (indent) => { while (stack.length && stack[stack.length - 1] >= indent) { out.push("</li></ul>"); stack.pop(); } };
  for (const raw of md.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const h = line.match(/^(#{1,3}) (.*)$/);
    const li = line.match(/^(\s*)- (.*)$/);
    if (h) { flush(); closeTo(0); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    if (li) {
      flush();
      const indent = li[1].length;
      if (stack.length && stack[stack.length - 1] === indent) out.push("</li><li>");
      else if (stack.length && stack[stack.length - 1] > indent) { closeTo(indent + 1); out.push("</li><li>"); }
      else { out.push("<ul><li>"); stack.push(indent); }
      out.push(inline(li[2]));
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    if (stack.length && /^\s+/.test(line)) { out.push(`<p class="cont">${inline(line.trim())}</p>`); continue; }   // paragraph inside a list item
    closeTo(0);
    para.push(line.trim());
  }
  flush(); closeTo(0);
  return out.join("\n");
}

const CSS = `
  @page { size: A4; margin: 13mm 15mm 12mm; }
  body { font-family: "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif; font-size: 8.9pt; line-height: 1.38; color: #161616; }
  h1 { font-size: 15pt; font-weight: 600; margin: 0 0 2pt; color: #161616; }
  h1 + p em { color: #525252; font-style: normal; font-size: 8.4pt; }
  h1 + p { margin: 0 0 8pt; padding-bottom: 6pt; border-bottom: 2px solid #0f62fe; }
  h2 { font-size: 10.6pt; font-weight: 600; color: #0f62fe; margin: 9pt 0 3pt; }
  h3 { font-size: 9.4pt; font-weight: 600; margin: 7pt 0 2pt; }
  p { margin: 2pt 0 3pt; }
  ul { margin: 1pt 0 3pt; padding-left: 13pt; }
  li { margin: 0.5pt 0; }
  p.cont { margin: 2pt 0 1pt; }
  em { color: #525252; }
  strong { font-weight: 600; }
`;

(async () => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Wind forecast pilot brief</title><style>${CSS}</style></head><body>${toHtml(fs.readFileSync(SRC, "utf8"))}</body></html>`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({ path: OUT, format: "A4", printBackground: true, preferCSSPageSize: true });
  await browser.close();
  const pages = (fs.readFileSync(OUT, "latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log(`Wrote ${path.relative(ROOT, OUT)} (${pages} page${pages === 1 ? "" : "s"})`);
  if (pages > 2) process.exitCode = 1;
})();
