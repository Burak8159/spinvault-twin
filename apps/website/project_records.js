const $ = id => document.getElementById(id);
let deviceRevision = 0;
let studyRevision = 0;
const queryApi = new URLSearchParams(location.search).get('api');
try { $('api').value = queryApi || localStorage.getItem('spinvault-project-records-api') || $('api').value; } catch { /* use inline default */ }

function apiBase() {
  const url = new URL($('api').value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS API address.');
  try { localStorage.setItem('spinvault-project-records-api', url.origin); } catch { /* storage optional */ }
  $('requirements-link').href = `requirements.html?api=${encodeURIComponent(url.origin)}`;
  return url.origin;
}
function jsonField(id, expected, label) {
  const value = JSON.parse($(id).value);
  if (expected === 'array' ? !Array.isArray(value) : !value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${label} must be a JSON ${expected}.`);
  }
  return value;
}
function layerValues() {
  return [...$('layers-editor').querySelectorAll('.layer-row')].map((row, index) => {
    const name = row.querySelector('[data-field="name"]').value.trim();
    if (!name) throw new Error(`Layer ${index + 1} needs a name.`);
    const rawThickness = row.querySelector('[data-field="thickness"]').value.trim();
    const unit = row.querySelector('[data-field="unit"]').value.trim();
    const missingReason = row.querySelector('[data-field="missing-reason"]').value.trim();
    let thickness;
    if (rawThickness === '') {
      if (!missingReason) throw new Error(`Layer ${index + 1} needs a reason when its thickness is unknown.`);
      thickness = {value: null, unit: null, missing_reason: missingReason};
    } else {
      const value = Number(rawThickness);
      if (!Number.isFinite(value) || !unit) throw new Error(`Layer ${index + 1} needs a finite thickness and unit.`);
      thickness = {value, unit};
    }
    const slug = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'layer';
    return {id: `${slug}-${index + 1}`, name, material_ref: row.querySelector('[data-field="material"]').value.trim() || null,
      thickness, magnetic_role: row.querySelector('[data-field="role"]').value.trim() || null,
      status: row.querySelector('[data-field="status"]').value, source_refs: []};
  });
}
function renderLayers(values) {
  const editor = $('layers-editor'); editor.replaceChildren();
  for (const [index, value] of values.entries()) {
    const row = document.createElement('fieldset'); row.className = 'layer-row';
    const thickness = value.thickness?.value;
    row.innerHTML = `<legend>Layer ${index + 1}</legend>
      <label>Name<input required data-field="name" maxlength="128"></label>
      <label>Material or reference<input data-field="material" maxlength="256"></label>
      <label>Magnetic role<input data-field="role" maxlength="128"></label>
      <label>Thickness<input data-field="thickness" type="number" step="any"></label>
      <label class="thickness-unit"><span>Unit</span><input data-field="unit" maxlength="32"></label>
      <label>Status<select data-field="status"><option value="known">Known</option><option value="assumed">Assumed</option><option value="unresolved">Unresolved</option></select></label>
      <label class="unknown-reason"><span>Unknown thickness reason</span><input data-field="missing-reason" maxlength="512"></label>
      <div class="layer-actions"><button type="button" data-action="up" aria-label="Move layer up">↑</button><button type="button" data-action="down" aria-label="Move layer down">↓</button><button type="button" data-action="remove">Remove</button></div>`;
    row.querySelector('[data-field="name"]').value = value.name || '';
    row.querySelector('[data-field="material"]').value = value.material_ref || '';
    row.querySelector('[data-field="role"]').value = value.magnetic_role || '';
    row.querySelector('[data-field="thickness"]').value = thickness ?? '';
    row.querySelector('[data-field="unit"]').value = value.thickness?.unit || '';
    row.querySelector('[data-field="status"]').value = value.status || 'unresolved';
    row.querySelector('[data-field="missing-reason"]').value = value.thickness?.missing_reason || '';
    row.querySelector('[data-action="remove"]').disabled = values.length === 1;
    const unknown = row.querySelector('.unknown-reason');
    const unit = row.querySelector('.thickness-unit');
    const updateThickness = () => { const known = row.querySelector('[data-field="thickness"]').value.trim() !== ''; unknown.hidden = known; unit.hidden = !known; };
    row.querySelector('[data-field="thickness"]').addEventListener('input', updateThickness); updateThickness();
    row.addEventListener('click', event => {
      const action = event.target.dataset.action; if (!action) return;
      const current = layerValues();
      if (action === 'remove') current.splice(index, 1);
      if (action === 'up' && index > 0) [current[index - 1], current[index]] = [current[index], current[index - 1]];
      if (action === 'down' && index < current.length - 1) [current[index + 1], current[index]] = [current[index], current[index + 1]];
      renderLayers(current);
    });
    editor.append(row);
  }
}
renderLayers([{name: 'Layer 1', thickness: {value: null, unit: null, missing_reason: 'Not yet specified'}, status: 'unresolved'}]);
$('add-layer').addEventListener('click', () => renderLayers([...layerValues(), {name: '', thickness: {value: null, unit: null, missing_reason: 'Not yet specified'}, status: 'unresolved'}]));
async function request(path, options = {}) {
  const response = await fetch(`${apiBase()}${path}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `Request rejected (${response.status}).`);
  return body;
}
function recordPayload(type) {
  if (type === 'device') return {
    schema_version: '1.0', record_type: 'device', id: $('device-id').value.trim(),
    title: $('device-title').value.trim(), layers: layerValues(),
    lateral_dimensions: jsonField('dimensions', 'object', 'Lateral dimensions'),
    operating_domain: jsonField('domain', 'object', 'Operating domain'),
    source_refs: jsonField('device-sources', 'array', 'Source references'), metadata: {}
  };
  const linkedStructure = $('study-structure').value;
  const [structure_id, rawStructureRevision] = linkedStructure ? linkedStructure.split('@') : [null, null];
  return {
    schema_version: '1.0', record_type: 'study', id: $('study-id').value.trim(),
    title: $('study-title').value.trim(), device_id: $('study-device-id').value.trim(),
    device_revision: Number($('study-device-revision').value),
    structure_id, structure_revision: rawStructureRevision ? Number(rawStructureRevision) : null,
    scientific_question: $('question').value.trim(), method: $('method').value.trim(),
    parameter_set: jsonField('parameters', 'object', 'Parameter set'),
    source_refs: jsonField('study-sources', 'array', 'Source references'), metadata: {}, status: $('study-status').value
  };
}
function showStored(type, record) {
  const recordValue = record.record;
  if (type === 'device') {
    $('device-id').value = recordValue.id; $('device-title').value = recordValue.title;
    renderLayers(recordValue.layers);
    $('dimensions').value = JSON.stringify(recordValue.lateral_dimensions, null, 2);
    $('domain').value = JSON.stringify(recordValue.operating_domain, null, 2);
    $('device-sources').value = JSON.stringify(recordValue.source_refs, null, 2);
    deviceRevision = record.revision;
    $('device-revision').textContent = `Device ${record.id}, revision ${record.revision}; SHA-256 ${record.sha256}`;
  } else {
    $('study-id').value = recordValue.id; $('study-title').value = recordValue.title;
    $('study-device-id').value = recordValue.device_id; $('study-device-revision').value = recordValue.device_revision;
    if (recordValue.structure_id && recordValue.structure_revision) {
      const exact = `${recordValue.structure_id}@${recordValue.structure_revision}`;
      if (![...$('study-structure').options].some(option => option.value === exact)) {
        $('study-structure').append(new Option(`${recordValue.structure_id} · revision ${recordValue.structure_revision} (linked exact revision)`, exact));
      }
      $('study-structure').value = exact;
    } else $('study-structure').value = '';
    $('question').value = recordValue.scientific_question; $('method').value = recordValue.method;
    $('parameters').value = JSON.stringify(recordValue.parameter_set, null, 2);
    $('study-sources').value = JSON.stringify(recordValue.source_refs, null, 2);
    $('study-status').value = recordValue.status;
    studyRevision = record.revision;
    $('study-revision').textContent = `Study ${record.id}, revision ${record.revision}; SHA-256 ${record.sha256}`;
  }
}
function download(name, content) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], {type: 'application/json'}));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

$('device-form').onsubmit = async event => {
  event.preventDefault();
  try {
    const record = recordPayload('device');
    const saved = await request('/api/project-records/device', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({record, expected_revision: deviceRevision})});
    showStored('device', saved); $('notice').textContent = 'Device revision saved. Scientific approval is not implied.';
  } catch (error) { $('notice').textContent = error.message; }
};
$('study-form').onsubmit = async event => {
  event.preventDefault();
  try {
    const record = recordPayload('study');
    const saved = await request('/api/project-records/study', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({record, expected_revision: studyRevision})});
    showStored('study', saved); $('notice').textContent = saved.record.structure_id
      ? 'Study saved with exact device and structure revisions.'
      : 'Study revision saved with its exact device revision; no structure is linked.';
  } catch (error) { $('notice').textContent = error.message; }
};
$('device-load').onclick = async () => {
  try { const record = await request(`/api/project-records/device/${encodeURIComponent($('device-id').value.trim())}`); showStored('device', record); $('notice').textContent = 'Latest device revision loaded.'; }
  catch (error) { $('notice').textContent = error.message; }
};
$('study-load').onclick = async () => {
  try { const record = await request(`/api/project-records/study/${encodeURIComponent($('study-id').value.trim())}`); showStored('study', record); $('notice').textContent = 'Latest study revision loaded.'; }
  catch (error) { $('notice').textContent = error.message; }
};
for (const [buttonId, type, idField] of [['device-export', 'device', 'device-id']]) {
  $(buttonId).onclick = async () => {
    try { const bundle = await request(`/api/project-records/${type}/${encodeURIComponent($(idField).value.trim())}/export`);
      download(`${type}-${$(idField).value.trim()}-r${bundle.source_revision}.json`, bundle); $('result').textContent = JSON.stringify(bundle, null, 2); $('notice').textContent = `${type} record exported with hash manifest.`; }
    catch (error) { $('notice').textContent = error.message; }
  };
}
$('study-export').onclick = async () => {
  try {
    const packageData = await request(`/api/project-records/study/${encodeURIComponent($('study-id').value.trim())}/package`);
    download(`study-${$('study-id').value.trim()}-with-device.json`, packageData);
    $('result').textContent = JSON.stringify(packageData, null, 2);
    $('notice').textContent = 'Study and exact linked device revision exported as one hash-checked package.';
  } catch (error) { $('notice').textContent = error.message; }
};
$('import').onclick = async () => {
  try {
    const file = $('bundle-file').files[0]; if (!file) throw new Error('Choose a JSON record bundle first.');
    if (file.size > 3 * 1024 * 1024) throw new Error('Bundle exceeds the 3 MiB limit.');
    const bundle = JSON.parse(await file.text());
    if (['study_with_device_revision', 'study_with_device_and_structure'].includes(bundle.package_type)) {
      const imported = await request('/api/project-records/study-package/import', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({package: bundle})});
      showStored('study', imported); $('result').textContent = JSON.stringify(imported, null, 2);
      $('notice').textContent = bundle.package_type === 'study_with_device_and_structure'
        ? 'Study and its exact linked device and structure revisions imported as new records.'
        : 'Study and exact linked device revision imported as new records.';
    } else {
      const imported = await request('/api/project-records/import', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({bundle})});
      showStored(imported.record_type, imported); $('result').textContent = JSON.stringify(imported, null, 2);
      $('notice').textContent = 'Bundle hash verified and imported as a new record.';
    }
  } catch (error) { $('notice').textContent = error.message; }
};
$('refresh').onclick = async () => {
  const list = $('records'); list.replaceChildren();
  try {
    for (const type of ['device', 'study']) {
      const data = await request(`/api/project-records/${type}`);
      for (const record of data.records) {
        const item = document.createElement('li');
        const description = document.createElement('span');
        description.textContent = `${type}: ${record.id} · r${record.revision} · ${record.record.title} `;
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Load';
        button.addEventListener('click', () => showStored(type, record)); item.append(description, button); list.append(item);
      }
    }
    if (!list.children.length) { const empty = document.createElement('li'); empty.textContent = 'No saved project records.'; list.append(empty); }
    $('notice').textContent = `Loaded ${list.children.length} record(s).`;
  } catch (error) { $('notice').textContent = error.message; }
};
$('archive-export').onclick = async () => {
  const status = $('archive-status'); status.textContent = 'Preparing project archive…';
  try {
    const archive = await request('/api/project-records/archive');
    download(`spinvault-project-records-${new Date().toISOString().slice(0, 10)}.json`, archive);
    status.textContent = `Exported ${archive.records.length} revision(s) with archive SHA-256 ${archive.archive_sha256}. Scientific files are not included.`;
  } catch (error) { status.textContent = error.message; }
};
$('archive-import').onclick = async () => {
  const status = $('archive-status');
  try {
    const file = $('archive-file').files[0];
    if (!file) throw new Error('Choose a project archive first.');
    if (file.size > 12 * 1024 * 1024) throw new Error('Archive exceeds the 12 MiB limit.');
    const archive = JSON.parse(await file.text());
    const imported = await request('/api/project-records/archive/import', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({archive})
    });
    status.textContent = `Imported ${imported.imported_records} record(s) and ${imported.imported_revisions} revision(s). No existing record was overwritten.`;
    await $('refresh').onclick();
    await $('structure-refresh').onclick();
  } catch (error) { status.textContent = error.message; }
};
$('structure-import').onclick = async () => {
  const status = $('structure-status'); status.textContent = 'Validating source structure…';
  try {
    const file = $('structure-file').files[0];
    if (!file) throw new Error('Choose a 72- or 88-atom QE structure JSON file.');
    if (file.size > 2 * 1024 * 1024) throw new Error('Structure record exceeds the 2 MiB limit.');
    const rawText = await file.text();
    const catalogDigest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawText))))
      .map(byte => byte.toString(16).padStart(2,'0')).join('');
    const saved = await request('/api/project-records/import-qe-structure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({catalog_json:rawText,filename:file.name})});
    status.textContent = `Saved ${saved.record.id} revision ${saved.revision}; ${saved.record.atom_count} atoms; source state ${saved.record.source_status}; transport remains unvalidated. Catalog JSON SHA-256 ${catalogDigest}.`;
    $('structure-detail').textContent = JSON.stringify(saved,null,2);
    await $('structure-refresh').onclick();
  } catch (error) { status.textContent = error.message; }
};
$('structure-refresh').onclick = async () => {
  const list = $('structure-list'); const status = $('structure-status'); list.replaceChildren();
  try {
    const result = await request('/api/project-records/structure');
    const select = $('study-structure'); const selected = select.value;
    select.replaceChildren(new Option('No structure linked', ''));
    for (const item of structureRecords) {
      select.append(new Option(`${item.id} · r${item.revision} · ${item.record.atom_count} atoms · ${item.record.source_status}`,
        `${item.id}@${item.revision}`));
    }
    if (selected && ![...select.options].some(option => option.value === selected)) {
      const [identifier, revision] = selected.split('@');
      select.append(new Option(`${identifier} · revision ${revision} (linked exact revision)`, selected));
    }
    select.value = selected;
    for (const item of result.records) {
      const li = document.createElement('li'); const label = document.createElement('span');
      label.textContent = `${item.id} · r${item.revision} · ${item.record.atom_count} atoms · ${item.record.source_status} · transport ${item.record.transport_validated ? 'validated' : 'not validated'} `;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Inspect record';
      button.addEventListener('click',async()=>{try{$('structure-detail').textContent=JSON.stringify(await request(`/api/project-records/structure/${encodeURIComponent(item.id)}?revision=${item.revision}`),null,2);}catch(error){status.textContent=error.message;}});
      li.append(label,button); list.append(li);
    }
    if (!list.children.length) { const empty=document.createElement('li'); empty.textContent='No saved structure records.'; list.append(empty); }
    status.textContent = `Loaded ${list.children.length} structure record(s). Source convergence labels are preserved and not promoted.`;
  } catch (error) { status.textContent = error.message; }
};
