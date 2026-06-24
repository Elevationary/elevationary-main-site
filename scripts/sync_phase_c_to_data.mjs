#!/usr/bin/env node
// Sync Marketing's Phase C Q&A authoring (Markdown) into Website's
// _data/answers.json (JSON consumed by Eleventy templates).
//
// Source: ~/Antigravity/Elevationary_Marketing/brand/aeo_geo/_phase_c_working/<slug>.md
// Target: src/_data/answers.json
//
// Why a sync script vs Eleventy _data/answers.js dynamic loader:
//   Cloudflare Pages builds from the github.com/Elevationary/elevationary-main-site
//   repo only. Marketing's working dir is OUTSIDE this repo. The sync committed
//   into the Website repo is what Pages picks up at build time.
//
// Run before commit/push when Marketing's authoring has updated.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PHASE_C_DIR = "/Users/jamesszmak/Antigravity/Elevationary_Marketing/brand/aeo_geo/_phase_c_working";
const TARGET = "/Users/jamesszmak/Antigravity/Website/src/_data/answers.json";

const DEPT_SLUG_ORDER = [
  "finance", "legal", "hr", "operations", "marketing",
  "sales", "it", "customer-success", "executive",
];

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return fm;
}

function parseDeptBrief(raw) {
  // Section: "## Dept brief ... " then a paragraph (could be placeholder)
  const m = raw.match(/##\s*Dept brief[^\n]*\n+([\s\S]*?)(?=\n---|\n##\s)/);
  if (!m) return "";
  const text = m[1].trim();
  // Strip italic placeholder markers like _[awaiting ...]_
  if (text.startsWith("_[") || text.startsWith("*[")) return "";
  return text;
}

function parseQA(raw) {
  // Match: ### Q-<id>: <type>\n\n**Q:** ... \n\n*[...]*\n\n**A:** ...
  const qas = [];
  // Allow up to 2 optional **Label:** metadata lines between heading and **Q:**
  // (e.g. cross-functional adds a "**Dept overlap:** X + Y" line).
  const blockRegex = /###\s*Q-([a-z]+-\d+):\s*([a-zA-Z\-]+)\s*\n+(?:\*\*[A-Z][^*]+\*\*[^\n]*\n+){0,2}\*\*Q:\*\*\s*([\s\S]*?)\n+\*\[([\s\S]*?)\]\*\s*\n+\*\*A:\*\*\s*([\s\S]*?)(?=\n+---|\n+###\s|$)/g;
  let m;
  while ((m = blockRegex.exec(raw)) !== null) {
    const id = m[1];
    const headingType = m[2];
    const question = m[3].trim();
    const metaRaw = m[4];
    const answer = m[5].trim();

    const meta = {};
    for (const part of metaRaw.split("|").map((s) => s.trim())) {
      const kv = part.match(/^([a-zA-Z\-_]+):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].trim();
    }
    qas.push({
      id,
      type: meta.type || headingType,
      question,
      answer,
      capability: meta.capability || "",
      outcome: meta.outcome || "",
      action: meta.action || "none",
    });
  }
  return qas;
}

function parseFile(path) {
  const raw = readFileSync(path, "utf8");
  const fm = parseFrontmatter(raw);
  const deptBrief = parseDeptBrief(raw);
  const qa = parseQA(raw);
  return { fm, deptBrief, qa };
}

const out = {
  version: "0.2.0-phase-c-synced",
  lastUpdated: new Date().toISOString().slice(0, 10),
  sourceContract: "Synced from brand/aeo_geo/_phase_c_working/<slug>.md via scripts/sync_phase_c_to_data.mjs",
  index: {
    title: "Answers — Elevationary on Agentic AI Deployment",
    intro: "Working-buyer answers from Elevationary on agentic AI deployment across departments. Practitioners' perspective on what installs, what costs, what works, and when to bring outside help.",
  },
  depts: [],
  crossFunctional: { slug: "cross-functional", name: "Cross-Functional", intro: "", qa: [] },
  qaItemSchema: {
    _description: "Reference shape for items in dept.qa[] and crossFunctional.qa[].",
    id: "<dept-slug-prefix>-<3-digit> e.g. fin-001",
    type: "what-is | how-do-I | when-should-I | what-does-it-cost | how-do-I-prove-it-worked",
    question: "Q line",
    answer: "A paragraph",
    capability: "metadata caption fragment",
    outcome: "metadata caption fragment",
    action: "subscribe | consulting-15 | consulting-30 | consulting-60 | consulting-90 | none",
  },
};

const files = readdirSync(PHASE_C_DIR).filter((f) => f.endsWith(".md") && f !== "README.md");

for (const slug of DEPT_SLUG_ORDER) {
  const file = `${slug}.md`;
  if (!files.includes(file)) {
    console.warn(`SKIP: ${file} not found in ${PHASE_C_DIR}`);
    continue;
  }
  const { fm, deptBrief, qa } = parseFile(join(PHASE_C_DIR, file));
  out.depts.push({
    slug: fm.slug || slug,
    name: fm.name || slug,
    deptBrief: deptBrief || "Dept brief authoring in progress.",
    qa,
  });
}

if (files.includes("cross-functional.md")) {
  const { fm, deptBrief, qa } = parseFile(join(PHASE_C_DIR, "cross-functional.md"));
  out.crossFunctional = {
    slug: fm.slug || "cross-functional",
    name: fm.name || "Cross-Functional",
    intro: deptBrief || "Cross-functional answers on agentic AI deployment — questions that span two or more departments.",
    qa,
  };
}

writeFileSync(TARGET, JSON.stringify(out, null, 2) + "\n", "utf8");

let totalQa = 0;
for (const d of out.depts) totalQa += d.qa.length;
totalQa += out.crossFunctional.qa.length;

console.log(`Wrote ${TARGET}`);
console.log(`  depts: ${out.depts.length}`);
for (const d of out.depts) {
  console.log(`    ${d.slug}: ${d.qa.length} Q&A, brief_len=${d.deptBrief.length}`);
}
console.log(`  cross-functional: ${out.crossFunctional.qa.length} Q&A, intro_len=${out.crossFunctional.intro.length}`);
console.log(`  total Q&A: ${totalQa}`);
