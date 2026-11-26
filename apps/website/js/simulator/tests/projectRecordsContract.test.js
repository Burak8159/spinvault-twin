import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const html = readFileSync(resolve(root, 'project_records.html'), 'utf8');
const script = readFileSync(resolve(root, 'project_records.js'), 'utf8');

test('study form round-trips every supported execution status without implying acceptance', () => {
  for (const status of ['draft', 'prepared', 'running', 'complete', 'failed']) {
    assert.match(html, new RegExp(`<option value="${status}">`));
  }
  assert.match(html, /“Complete” does not mean scientifically reviewed or accepted/);
});

test('study structure selection records an exact revision and imports its package type', () => {
  assert.match(html, /id="study-structure"/);
  assert.match(script, /structure_revision: rawStructureRevision \? Number\(rawStructureRevision\) : null/);
  assert.match(script, /study_with_device_and_structure/);
  assert.match(script, /linked exact revision/);
});

test('structure inspection keeps long atom tables collapsed until explicitly requested', () => {
  assert.match(html, /<details id="structure-json-details">/);
  assert.match(html, /summary>View full structure record JSON/);
  assert.match(script, /structure-json-details'\)\.open\s*=\s*false/);
  assert.match(script, /renderStructureSummary\(detail\)/);
  assert.match(script, /summary\.append\(term, description\)/);
});

test('structure overview exposes source state and provenance without deriving acceptance', () => {
  assert.match(html, /id="structure-summary"/);
  assert.match(script, /\['Source state', record\.source_status\]/);
  assert.match(script, /\['Transport', record\.transport_validated \? 'Validated in source record' : 'Not validated'\]/);
  assert.match(script, /catalog_sha256=/);
  assert.match(script, /description\.textContent = value/);
});

test('structure refresh renders the records returned by the API', () => {
  assert.match(script, /const result = await request\('\/api\/project-records\/structure'\)/);
  assert.match(script, /for \(const item of result\.records\)/);
  assert.doesNotMatch(script, /for \(const item of structureRecords\)/);
});

test('saved study list exposes its workflow status and exact structure revision honestly', () => {
  assert.match(script, /workflow: \$\{record\.record\.status\} \(not scientific acceptance\)/);
  assert.match(script, /\$\{record\.record\.structure_id\}@\$\{record\.record\.structure_revision\}/);
  assert.match(script, /'none linked'/);
});

test('repeated record actions have accessible names that identify their targets', () => {
  assert.match(script, /Load \$\{type\} \$\{record\.id\} revision \$\{record\.revision\}/);
  assert.match(script, /Inspect \$\{item\.id\} revision \$\{item\.revision\}/);
});

test('hash-checked exports preserve the server JSON text instead of reserializing numbers', () => {
  assert.match(script, /async function downloadResponse\(path, name\)/);
  assert.match(script, /const raw = await response\.text\(\)/);
  assert.match(script, /downloadText\(name, raw\)/);
  assert.match(script, /downloadResponse\('\/api\/project-records\/archive'/);
  assert.match(script, /downloadResponse\(`\/api\/project-records\/study/);
  assert.doesNotMatch(script, /download\([^\n]+, archive\)/);
});

test('hash-checked imports preserve raw numeric tokens in record, study, and archive envelopes', () => {
  assert.match(script, /const raw = await file\.text\(\); const bundle = JSON\.parse\(raw\)/);
  assert.match(script, /body: `\{"package":\$\{raw\}\}`/);
  assert.match(script, /body: `\{"bundle":\$\{raw\}\}`/);
  assert.match(script, /body: `\{"archive":\$\{raw\}\}`/);
  assert.match(script, /const raw = await file\.text\(\); JSON\.parse\(raw\)/);
});
