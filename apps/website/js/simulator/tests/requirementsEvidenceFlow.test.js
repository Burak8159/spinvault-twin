import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../../../requirements.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../../../requirements.js', import.meta.url), 'utf8');

class Element {
  constructor(id = '') { this.id = id; this._value = ''; this.textContent = ''; this.children = []; this.listeners = {}; }
  get value() { return this._value; }
  set value(value) { this._value = value == null ? '' : String(value); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  dispatch(name) { this.listeners[name]?.({target: this}); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this[name] = value; }
}

test('entering evidence preserves the loaded immutable requirement revision for evaluation', async () => {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, new Element(id)]));
  for (const id of ['identifier','metric','unit','status','target','comparator','source','conditions','evidence','api']) elements.set(id, elements.get(id) || new Element(id));
  Object.assign(elements.get('api'), {value: 'http://127.0.0.1:18704'});
  const saved = {
    id: 'NFO-CHARGE', revision: 3,
    requirement: {id: 'NFO-CHARGE', metric: 'NFO charge deviation', unit: 'e', status: 'SPECIFIED', target: 0.01, comparator: '<=', source: 'test-only policy fixture', conditions: {stage: 'OBC', bias_V: 0}},
  };
  const requests = [];
  const document = {getElementById: id => elements.get(id), createElement: tag => new Element(tag)};
  const localStorage = {getItem: () => null, setItem: () => {}};
  const fetch = async (url, options = {}) => {
    requests.push({url, options});
    const payload = options.method === 'POST'
      ? {verdict: 'PASS', review_integrity_verified: true, evidence_id: 'reviewed-fixture'}
      : {requirements: [saved]};
    return {ok: true, status: 200, json: async () => payload};
  };
  runInNewContext(script, {
    document, localStorage, fetch, URL, URLSearchParams, location: {search: ''},
    JSON, Number, Object, Error, encodeURIComponent, Blob, setTimeout, console,
  });

  await elements.get('refresh-requirements').onclick();
  const loadButton = elements.get('saved-requirements').children[0].children[1];
  loadButton.onclick();
  elements.get('evidence').value = 'reviewed-fixture';
  elements.get('evidence').dispatch('input');
  await elements.get('form').onsubmit({preventDefault() {}});

  const evaluation = requests.find(request => request.options.method === 'POST');
  assert.ok(evaluation, `no evaluation request; message=${elements.get('message').textContent}`);
  assert.equal(evaluation.url, 'http://127.0.0.1:18704/api/requirements/NFO-CHARGE/evaluate');
  assert.deepEqual(JSON.parse(evaluation.options.body), {revision: 3, evidence_id: 'reviewed-fixture'});
  assert.match(elements.get('message').textContent, /PASS/);
  assert.equal(JSON.parse(evaluation.options.body).qualified, undefined, 'qualification is never client-supplied');
});

test('changing a loaded requirement id clears its revision binding so a new record can be saved', async () => {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, new Element(id)]));
  for (const id of ['identifier','metric','unit','status','target','comparator','source','conditions','evidence','api']) elements.set(id, elements.get(id) || new Element(id));
  Object.assign(elements.get('api'), {value: 'http://127.0.0.1:18704'});
  const saved = {
    id: 'NFO-CHARGE', revision: 3,
    requirement: {id: 'NFO-CHARGE', metric: 'NFO charge deviation', unit: 'e', status: 'SPECIFIED', target: 0.01, comparator: '<=', source: 'test-only policy fixture', conditions: {stage: 'OBC', bias_V: 0}},
  };
  const requests = [];
  const document = {getElementById: id => elements.get(id), createElement: tag => new Element(tag)};
  const fetch = async (url, options = {}) => {
    requests.push({url, options});
    if (url.endsWith('/api/requirements') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      return {ok: true, status: 200, json: async () => ({id: body.requirement.id, revision: 1, requirement: body.requirement})};
    }
    if (url.endsWith('/api/requirements/NFO-CHARGE')) return {ok: true, status: 200, json: async () => saved};
    if (url.endsWith('/api/requirements/NEW-REQUIREMENT')) return {ok: false, status: 404, json: async () => ({detail: 'Requirement revision unavailable'})};
    return {ok: true, status: 200, json: async () => ({requirements: [saved]})};
  };
  runInNewContext(script, {
    document, localStorage: {getItem: () => null, setItem: () => {}}, fetch, URL, URLSearchParams,
    location: {search: ''}, JSON, Number, Object, Error, encodeURIComponent, Blob, setTimeout, console,
  });

  await elements.get('refresh-requirements').onclick();
  elements.get('saved-requirements').children[0].children[1].onclick();
  elements.get('identifier').value = 'NEW-REQUIREMENT';
  elements.get('identifier').dispatch('input');
  assert.equal(elements.get('revision').textContent, 'Project revision: unsaved');
  await elements.get('server-load').onclick();
  await elements.get('server-save').onclick();

  const save = requests.find(request => request.options.method === 'POST');
  assert.ok(save, `no save request; message=${elements.get('message').textContent}`);
  assert.deepEqual(JSON.parse(save.options.body), {requirement: {id: 'NEW-REQUIREMENT', metric: 'NFO charge deviation', unit: 'e', status: 'SPECIFIED', target: 0.01, comparator: '<=', source: 'test-only policy fixture', conditions: {stage: 'OBC', bias_V: 0}}, expected_revision: 0});
  assert.equal(elements.get('revision').textContent, 'Project revision: NEW-REQUIREMENT / 1');
});
