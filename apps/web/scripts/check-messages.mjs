// Fails when the translation catalogs drift apart: every key in en.json must
// exist in es.json and vice versa, with the same ICU placeholders. CLAUDE.md
// makes a missing translation a review blocker -- this makes it a CI blocker
// too, instead of something a reviewer has to spot by eye.
import { readFileSync } from 'node:fs';

const LOCALES = ['en', 'es'];
const catalogs = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8')),
  ]),
);

function flatten(object, prefix = '') {
  return Object.entries(object).flatMap(([key, value]) =>
    value && typeof value === 'object'
      ? flatten(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, String(value)]],
  );
}

// `{name}`, `{count, plural, ...}` -> the argument names only.
const placeholders = (text) =>
  [...text.matchAll(/\{\s*([A-Za-z0-9_]+)/g)].map((m) => m[1]).sort().join(',');

const flat = Object.fromEntries(LOCALES.map((l) => [l, new Map(flatten(catalogs[l]))]));
const problems = [];

for (const locale of LOCALES) {
  for (const other of LOCALES.filter((l) => l !== locale)) {
    for (const key of flat[locale].keys()) {
      if (!flat[other].has(key)) problems.push(`missing in ${other}.json: ${key}`);
    }
  }
}
for (const [key, text] of flat.en) {
  const translated = flat.es.get(key);
  if (translated !== undefined && placeholders(text) !== placeholders(translated)) {
    problems.push(`placeholder mismatch for ${key}: en {${placeholders(text)}} vs es {${placeholders(translated)}}`);
  }
  if (!text.trim() || (translated !== undefined && !translated.trim())) {
    problems.push(`empty translation: ${key}`);
  }
}

if (problems.length > 0) {
  console.error(`Translation catalogs are out of sync:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Translation catalogs in sync (${flat.en.size} keys, ${LOCALES.join('/')}).`);
