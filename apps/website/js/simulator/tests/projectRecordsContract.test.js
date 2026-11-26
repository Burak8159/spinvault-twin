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
  assert.match(script, /structure-json-details'\)\.open\s*=\s*true/);
  assert.match(script, /structure-json-details'\)\.open\s*=\s*false/);
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
