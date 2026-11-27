import { asObject, loadApiSnapshot, type RequirementRecord, type VersionedRecord } from "@/lib/twin-api";

function text(value: unknown, fallback = "Not recorded"): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function shortHash(value: unknown): string {
  return typeof value === "string" && value ? `${value.slice(0, 12)}…` : "No hash supplied";
}

function recordTitle(item: VersionedRecord): string {
  const record = item.record;
  return text(record.title, text(record.name, item.id));
}

function RecordCard({ item, kind }: { item: VersionedRecord; kind: string }) {
  const record = item.record;
  const metadata = asObject(record.metadata);
  const validation = record.transport_validated === true;
  const atoms = typeof record.atom_count === "number" ? `${record.atom_count} atoms` : null;
  const status = text(record.source_status, text(record.status, "Draft / status not recorded"));
  const references = Array.isArray(record.source_refs) ? record.source_refs : [];
  return (
    <article className="record-card">
      <div className="record-topline"><span className="eyebrow">{kind}</span><span className="revision">r{item.revision}</span></div>
      <h3>{recordTitle(item)}</h3>
      <p className="record-id">{item.id}{atoms ? ` · ${atoms}` : ""}</p>
      <div className="record-facts">
        <div><span>Source state</span><strong>{status}</strong></div>
        <div><span>Transport</span><strong className={validation ? "state-good" : "state-muted"}>{validation ? "Validated in this record" : "Not validated"}</strong></div>
        {typeof record.magnetic_label === "string" && <div><span>Magnetic label</span><strong>{record.magnetic_label}</strong></div>}
        {typeof metadata.model_status === "string" && <div><span>Model status</span><strong>{metadata.model_status}</strong></div>}
      </div>
      {references.length > 0 && <p className="source-line">Source refs: {references.slice(0, 2).map(String).join(" · ")}</p>}
      <footer className="record-footer"><span>SHA-256 {shortHash(item.sha256)}</span><span>{item.created_at ? new Date(item.created_at).toLocaleDateString("en", { dateStyle: "medium" }) : "Date not recorded"}</span></footer>
    </article>
  );
}

function SolverCard({ name, value }: { name: string; value: unknown }) {
  const solver = asObject(value);
  const configured = solver.configured === true;
  return <div className="solver-row">
    <span className={`solver-dot ${configured ? "is-ready" : ""}`} aria-hidden="true" />
    <div className="solver-copy"><strong>{name}</strong><span>{text(solver.message, text(solver.note, configured ? "Configured locally" : "Not connected"))}</span></div>
    <span className={`solver-state ${configured ? "state-good" : "state-muted"}`}>{configured ? "Available" : "Unavailable"}</span>
  </div>;
}

function CountCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <div className="count-card"><strong>{value}</strong><span>{label}</span><small>{detail}</small></div>;
}

function RequirementCard({ item }: { item: RequirementRecord }) {
  const requirement = item.requirement;
  const specified = requirement.status === "SPECIFIED";
  const target = requirement.target;
  const comparator = text(requirement.comparator, "");
  const unit = text(requirement.unit, "");
  const targetText = typeof target === "number" ? `${comparator} ${target} ${unit}`.trim() : "Target not specified";
  return <article className="requirement-card">
    <div className="record-topline"><span className="eyebrow">{text(requirement.status, "STATUS UNKNOWN")}</span><span className="revision">r{item.revision}</span></div>
    <h3>{text(requirement.metric, item.id)}</h3>
    <p className="requirement-target">{targetText}</p>
    <p className="requirement-source"><span>Basis</span>{text(requirement.source, "No source recorded")}</p>
    <footer className="record-footer"><span>{item.id} · {shortHash(item.sha256)}</span><span className="state-muted">{specified ? "Definition only" : "Unspecified"}</span></footer>
  </article>;
}

export default async function Home() {
  const snapshot = await loadApiSnapshot();
  const online = snapshot.health?.status === "ok";
  const allRecords = Object.values(snapshot.records).flat();
  const devices = snapshot.records.device;
  const structures = snapshot.records.structure;
  const studies = snapshot.records.study;
  const solverRows = Object.entries(asObject(snapshot.solvers)).filter(([key]) => key !== "gpu");
  const gpu = asObject(asObject(snapshot.solvers).gpu);
  const worker = asObject(snapshot.worker);
  const unvalidated = allRecords.filter((item) => item.record.transport_validated !== true).length;

  return <main className="shell">
    <header className="topbar">
      <a className="brand" href="#overview" aria-label="SpinVault Twin home"><span className="brand-mark">S</span><span>SpinVault <b>Twin</b></span></a>
      <nav aria-label="Main navigation"><a href="#evidence">Evidence</a><a href="#readiness">Readiness</a><a href={`${snapshot.webUrl}/simulator.html`}>Simulator ↗</a></nav>
      <span className={`connection ${online ? "connected" : "disconnected"}`}><i />{online ? "Local API connected" : "API offline"}</span>
    </header>

    <section className="hero" id="overview">
      <div className="hero-copy"><span className="eyebrow">DEVICE WORKSPACE</span><h1>One place to see<br />what the evidence supports.</h1><p>Review saved structures, device records, study status and local solver availability. A saved model is not automatically a validated device.</p>
        <div className="hero-actions"><a className="button primary" href={`${snapshot.webUrl}/project_records.html`}>Open project records <span>↗</span></a><a className="button secondary" href={`${snapshot.webUrl}/requirements.html`}>Requirements &amp; evidence <span>↗</span></a></div>
      </div>
      <div className="hero-visual" aria-label="Illustrative layered device schematic, not a simulated result">
        <div className="visual-label">STACK OVERVIEW <span>illustrative</span></div>
        <div className="stack"><div className="layer electrode"><i />CFAS</div><div className="layer barrier"><i />NFO / barrier</div><div className="layer electrode"><i />CFAS</div></div>
        <div className="visual-caption">Device sketch only · no transport calculation represented</div>
      </div>
    </section>

    <section className="counts" aria-label="Saved workspace data">
      <CountCard label="Device records" value={devices.length} detail="versioned workspace entries" />
      <CountCard label="Structures" value={structures.length} detail="geometry records available" />
      <CountCard label="Studies" value={studies.length} detail="saved study records" />
      <CountCard label="Requirements" value={snapshot.requirements.length} detail="versioned target definitions" />
    </section>

    <section className="section" id="evidence">
      <div className="section-heading"><div><span className="eyebrow">SOURCE-BACKED RECORDS</span><h2>Models and structures</h2></div><a className="text-link" href={`${snapshot.webUrl}/project_records.html`}>Manage records <span>↗</span></a></div>
      {!online && <div className="notice warning"><strong>Live records are unavailable.</strong><span>Start the local Twin API to load saved revisions. This page does not substitute sample data.</span></div>}
      {online && snapshot.failures.length > 0 && <div className="notice warning"><strong>Some data sources did not respond.</strong><span>{snapshot.failures.join(" · ")}</span></div>}
      {online && allRecords.length === 0 && <div className="empty"><strong>No project records saved yet.</strong><span>Import or create a versioned record in Project Records. Nothing is seeded here.</span><a href={`${snapshot.webUrl}/project_records.html`}>Go to Project Records ↗</a></div>}
      {allRecords.length > 0 && <div className="record-grid">{allRecords.slice(0, 9).map((item) => <RecordCard key={`${item.record_type}:${item.id}:${item.revision}`} item={item} kind={item.record_type} />)}</div>}
      {allRecords.length > 9 && <p className="list-footnote">Showing 9 of {allRecords.length} records. Open Project Records for the complete list.</p>}
    </section>

    <section className="section requirements-section" id="requirements">
      <div className="section-heading"><div><span className="eyebrow">TARGETS AND THEIR BASIS</span><h2>Requirements in the workspace</h2></div><a className="text-link" href={`${snapshot.webUrl}/requirements.html`}>Open evidence review <span>↗</span></a></div>
      {online && snapshot.requirements.length === 0 && <div className="empty"><strong>No requirement revisions saved yet.</strong><span>Use the requirements page to define a target with source and operating conditions before evaluating evidence.</span><a href={`${snapshot.webUrl}/requirements.html`}>Open Requirements ↗</a></div>}
      {snapshot.requirements.length > 0 && <div className="record-grid">{snapshot.requirements.slice(0, 6).map((item) => <RequirementCard key={`${item.id}:${item.revision}`} item={item} />)}</div>}
      {online && snapshot.requirements.length > 6 && <p className="list-footnote">Showing 6 of {snapshot.requirements.length} requirement revisions. Open evidence review for the full workflow.</p>}
      <p className="requirements-note">A target definition is not an evidence pass. Evaluation must use a reviewed evidence item, and a single requirement/evidence pass does not certify a complete device.</p>
    </section>

    <section className="readiness-grid" id="readiness">
      <div className="panel solver-panel"><div className="section-heading compact"><div><span className="eyebrow">LOCAL CAPABILITIES</span><h2>Solver readiness</h2></div></div>
        {!online ? <div className="empty compact-empty"><strong>Cannot check solver state.</strong><span>The API is offline.</span></div> : <div className="solver-list">{solverRows.map(([name, value]) => <SolverCard key={name} name={name === "pythonLlg" ? "Python macrospin LLG" : name === "pythonMicromagnetic" ? "Python micromagnetics" : name === "mumax3" ? "MuMax3" : name} value={value} />)}</div>}
        <div className="runtime-strip"><span>Worker {worker.enabled === true ? "enabled" : worker.enabled === false ? "disabled" : "unknown"}</span><span>Pending jobs {text(worker.pendingJobs, "—")}</span><span>GPU {text(gpu.model, text(gpu.status, "not reported"))}</span></div>
      </div>
      <div className="panel requirements-panel"><span className="eyebrow">VALIDATION STATUS</span><h2>Evidence before claims</h2>
        <p>{snapshot.requirements.length} requirement revisions are available. Evaluation is tied to a specific reviewed evidence item and does not certify a complete device or solver.</p>
        <div className="validation-summary"><div><strong>{unvalidated}</strong><span>saved records not marked transport validated</span></div><span className="status-pill">Transport claims remain evidence-gated</span></div>
        <a className="button secondary" href={`${snapshot.webUrl}/requirements.html`}>Review evidence links <span>↗</span></a>
      </div>
    </section>

    <section className="connection-detail">
      <div><span className="eyebrow">DATA SOURCE</span><strong>{online ? text(snapshot.health?.service, "Twin API") : "Twin API not reachable"}</strong><small>{snapshot.apiUrl}</small></div>
      <div><span className="eyebrow">WORKSPACE WEB APP</span><strong>Existing simulator and record tools</strong><small>{snapshot.webUrl}</small></div>
      <p>Record hashes and revisions are displayed as returned by the API. They identify saved content; they do not certify scientific validity.</p>
    </section>

    <footer className="page-footer"><span>SpinVault Twin · evidence-linked workspace</span><span>Local development view</span></footer>
  </main>;
}
