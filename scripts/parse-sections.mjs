#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Source markdown lives in two git submodules at the repo root; the parser
// runs from scripts/, so one level up is the repo root.
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.resolve(__dirname, "..", "src", "features", "study", "data");

const exams = [
  {
    id: "cloud-practitioner",
    name: "AWS Certified Cloud Practitioner",
    short: "CLF-C02",
    dir: path.join(repoRoot, "AWS-Certified-Cloud-Practitioner-Notes", "sections"),
    nested: false,
  },
  {
    id: "ai-practitioner",
    name: "AWS Certified AI Practitioner",
    short: "AIF-C01",
    dir: path.join(repoRoot, "aws-certified-ai-practitioner-study-notes", "section"),
    nested: true,
  },
];

function titleFromContent(content, fallback) {
  // Use the first markdown H1 as the title; fall back to a humanized filename.
  const m = content.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : fallback;
}

function humanize(slug) {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\.md$/, "")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Words that appear so generally in question text they would over-match if used
// as keywords (e.g. "AWS", "Amazon", "Service"). Excluded from auto-derivation.
const STOPWORDS = new Set([
  "AWS", "Amazon", "Service", "Services", "What", "Which", "How", "The", "And", "For",
  "Cloud", "Computing", "Introduction", "Overview", "Section", "Summary", "Quick",
  "Revision", "Other", "More",
  // Too broad — appear in nearly every AI/ML question and would over-match.
  "AI", "ML",
  // Storage units / file-size noise.
  "GB", "MB", "KB", "TB", "PB", "TPS", "RPS",
]);

// Sections that aggregate other sections (summary pages) shouldn't mine H2
// headings for keywords — that pulls in every service mentioned and then those
// services double-flag this section alongside their own dedicated page.
function isAggregateSection(title, slug) {
  return /summary|introduction/i.test(title) || /-summary$/i.test(slug) || slug.startsWith("introduction-");
}

// Derive a small set of high-precision keyword phrases per section. We feed
// these into a runtime regex so an incorrect question gets bucketed to one or
// more topics. False positives are unwelcome — better to miss a topic than to
// flag the wrong one.
function deriveKeywords(title, slug, content) {
  const out = new Set();

  // Multi-word "Amazon X" / "AWS X" service captures (highest precision).
  const serviceCaptures = [...title.matchAll(/\b(?:Amazon|AWS)\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)*)/g)];
  for (const m of serviceCaptures) {
    out.add(m[0]);     // e.g. "Amazon Bedrock"
    out.add(m[1]);     // e.g. "Bedrock"
  }

  // Acronyms and ALL-CAPS tokens 2-5 chars from title and slug.
  const text = `${title} ${slug.replace(/[-_]+/g, " ")}`;
  const acronyms = text.match(/\b[A-Z][A-Z0-9]{1,4}\b/g) ?? [];
  for (const a of acronyms) {
    if (!STOPWORDS.has(a)) out.add(a);
  }

  // Title minus parens & "(X)" suffixes. Useful when the title is a phrase
  // ("Elastic Load Balancing"); skip if it's just an acronym or already covered.
  const cleanTitle = title.replace(/\s*\(.*?\)\s*/g, "").replace(/^.+:\s*/, "").trim();
  if (cleanTitle.length > 4 && /\s/.test(cleanTitle) && !STOPWORDS.has(cleanTitle)) {
    out.add(cleanTitle);
  }

  // Slug words joined as a phrase if it's clearly a service name.
  const slugPhrase = slug.replace(/[-_]+/g, " ");
  if (
    slugPhrase.length > 3 &&
    /^(amazon |aws )/i.test(slugPhrase) &&
    /\s/.test(slugPhrase)
  ) {
    out.add(slugPhrase);
  }

  // Pull H2 headings — their headers often name AWS services or core concepts.
  // Skip for aggregate/summary sections to avoid double-flagging dedicated topics.
  if (!isAggregateSection(title, slug)) {
    const h2Lines = (content.match(/^##\s+(.+?)\s*$/gm) ?? []).slice(0, 20);
    for (const line of h2Lines) {
      const heading = line.replace(/^##\s+/, "").replace(/\s*\(.*?\)\s*/g, "");
      const captures = [...heading.matchAll(/\b(?:Amazon|AWS)\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)*)/g)];
      for (const c of captures) {
        out.add(c[0]);
        out.add(c[1]);
      }
      const acro = heading.match(/\b[A-Z][A-Z0-9]{1,4}\b/g) ?? [];
      for (const a of acro) if (!STOPWORDS.has(a)) out.add(a);
    }
  }

  return [...out].filter((k) => k.length >= 2);
}

function stripFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\s*/, "");
}

// The TOC table that auto-generation tools (like markdown-toc) prepend with
// nested links to anchor IDs adds noise without useful navigation in our
// rendered view. Strip when the very first list block is purely TOC links.
function stripLeadingToc(content) {
  const lines = content.split(/\r?\n/);
  let i = 0;
  // Skip blank lines.
  while (i < lines.length && lines[i].trim() === "") i++;
  // Allow a single H1 at the top to remain.
  if (lines[i] && /^#\s+/.test(lines[i])) {
    i++;
    while (i < lines.length && lines[i].trim() === "") i++;
  }
  const start = i;
  let allLinks = true;
  let sawAny = false;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      // A blank line ends the list block.
      if (sawAny) break;
      i++;
      continue;
    }
    // List item linking to a fragment, optionally indented.
    if (/^\s*[-*]\s+\[.*?\]\(#.+?\)\s*$/.test(line)) {
      sawAny = true;
      i++;
      continue;
    }
    allLinks = false;
    break;
  }
  if (sawAny && allLinks) {
    // Strip from `start` through the trailing blank line (i).
    return lines.slice(0, start).concat(lines.slice(i)).join("\n").trimStart();
  }
  return content;
}

async function readSectionFile(filePath, examId, category) {
  const raw = await readFile(filePath, "utf8");
  const cleaned = stripLeadingToc(stripFrontmatter(raw));
  const base = path.basename(filePath, ".md");
  const title = titleFromContent(cleaned, humanize(base));
  return {
    id: `${examId}:${category ? category + "/" : ""}${base}`,
    examId,
    slug: base,
    category: category ?? null,
    title,
    keywords: deriveKeywords(title, base, cleaned),
    content: cleaned,
  };
}

async function build() {
  if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });

  // A lightweight cross-exam index — id, examId, title, keywords — that the
  // app eager-loads so it can map incorrect questions to topics without
  // pulling the heavy section-content chunks.
  const topicIndex = [];

  for (const exam of exams) {
    if (!existsSync(exam.dir)) {
      console.warn(`[sections] Skipping ${exam.id}: ${exam.dir} not found`);
      continue;
    }

    const sections = [];

    if (exam.nested) {
      const categoryDirs = (await readdir(exam.dir, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();

      for (const cat of categoryDirs) {
        const catDir = path.join(exam.dir, cat);
        const files = (await readdir(catDir))
          .filter((f) => f.endsWith(".md"))
          .sort();
        for (const f of files) {
          const filePath = path.join(catDir, f);
          const s = await stat(filePath);
          if (!s.isFile()) continue;
          sections.push(await readSectionFile(filePath, exam.id, cat));
        }
      }
    } else {
      const files = (await readdir(exam.dir))
        .filter((f) => f.endsWith(".md"))
        .sort();
      for (const f of files) {
        sections.push(await readSectionFile(path.join(exam.dir, f), exam.id, null));
      }
    }

    const out = {
      examId: exam.id,
      examName: exam.name,
      examShort: exam.short,
      generatedAt: new Date().toISOString(),
      sectionCount: sections.length,
      sections,
    };

    const outPath = path.join(outDir, `${exam.id}.json`);
    await writeFile(outPath, JSON.stringify(out, null, 2));
    console.log(`[sections] ${exam.id}: ${sections.length} sections`);

    for (const s of sections) {
      topicIndex.push({
        id: s.id,
        examId: s.examId,
        slug: s.slug,
        category: s.category,
        title: s.title,
        keywords: s.keywords,
      });
    }
  }

  await writeFile(
    path.join(outDir, "topic-index.json"),
    JSON.stringify(topicIndex, null, 2)
  );
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
