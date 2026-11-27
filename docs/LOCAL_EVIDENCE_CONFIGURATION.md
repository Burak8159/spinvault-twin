# Configure local scientific evidence

The requirements workspace has two separate capabilities:

- A single requirement comparison needs a private evidence folder.
- A grouped same-cycle convergence check also needs the project's acceptance-policy JSON.

Evidence is not bundled with the application. Keep raw calculation files and review keys outside the website directory, source archive, and Git. Do not configure a folder as publicly downloadable merely to make it visible in the UI.

## Configure before starting

Set the paths in the same terminal session used to launch the workspace:

```bash
export SPINVAULT_REQUIREMENT_EVIDENCE_ROOT="/absolute/path/to/private/evidence"
export SPINVAULT_EVIDENCE_SIGNING_KEY_FILE="/absolute/path/to/private/review.key"
export SPINVAULT_ACCEPTANCE_POLICY_FILE="/absolute/path/to/project/acceptance-policy.json"
./scripts/run_workspace.sh
```

The evidence folder and review key are required for qualified single-measurement evaluation. The acceptance policy is additionally required for grouped same-cycle gate checks. The launcher reports whether each path is available; it does not create a key, qualify observations, or infer a policy. If the relevant path is absent, the API intentionally fails closed.

Initialize a new signing key only once, storing it outside the repository with owner-only permissions:

```bash
backend/.venv/bin/python backend/review_evidence.py \
  --key-file "/absolute/path/to/private/review.key" --init-key
```

Review records only after independently checking their source logs and declared scope. Then sign an existing record explicitly:

```bash
backend/.venv/bin/python backend/review_evidence.py \
  --key-file "/absolute/path/to/private/review.key" \
  --record "/absolute/path/to/private/evidence/ID.json" \
  --reviewer "reviewer-id" --reference "review-record-or-document-id" \
  --scope "numerical-log-review"
```

The signature demonstrates that the local key holder approved the record metadata. It does not verify that a reviewer has a particular professional identity, establish peer review, or make a failed/unconverged run scientifically acceptable. The application's final-cycle and device gates still apply.

## After launch

Open **Requirements and evidence** and evaluate an observation using its evidence ID. A comparison must match metric, unit, target, operating conditions, source hash, and verified review. For the grouped SIESTA gate, the project's policy must also state verified runtime semantics; missing or unverified criteria remain `NOT_EVALUATED`.

The current running workspace is not reconfigured by changing these variables. Stop it through its own launcher, then start a new workspace from the terminal where the variables are set. Do not stop a workspace while it is processing a simulation job.
