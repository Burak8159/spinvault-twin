#!/usr/bin/env node
/**
 * Lightweight honesty lint for the Twin UI shell.
 * Flags copy that would imply a connected physics solver.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const websiteRoot = fileURLToPath(new URL("../../..", import.meta.url));
const targets = [
  join(websiteRoot, "simulator.html"),
  join(websiteRoot, "simulator.css"),
  join(websiteRoot, "js/simulator"),
  join(websiteRoot, "js/api")
];
const allowedExt = new Set([".js", ".d.ts", ".html", ".css", ".md", ".mjs"]);
const forbidden = [
  /computed by MuMax3/i,
  /Kwant result/i,
  /physics-accurate/i,
  /real-time solver/i,
  /AI prediction/i,
  /isPhysicalSimulation:\s*true/,
  /\bsimulates\b/i,
  /\bvalidated result\b/i
];

/** @param {string} dir */
function walk(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...walk(path));
    else if (allowedExt.has(extname(entry)) || entry.endsWith(".d.ts")) files.push(path);
  }
  return files;
}

const files = targets
  .flatMap((target) => (statSync(target).isDirectory() ? walk(target) : [target]))
  .filter((file) => !file.endsWith("/scripts/lint.mjs"));
/** @type {string[]} */
const hits = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(text)) hits.push(`${relative(websiteRoot, file)} matches ${pattern}`);
  }
}

if (hits.length) {
  console.error("Honesty lint failed:\n" + hits.map((hit) => ` - ${hit}`).join("\n"));
  process.exit(1);
}

console.log(`Honesty lint passed (${files.length} files).`);
