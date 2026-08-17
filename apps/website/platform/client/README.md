# Client / Presentation Layer

Purpose:

- Website pages and navigation.
- Interactive parameter controls.
- Canvas/SVG graphics for the single-cell simulator.
- Future 3D/WebGL rendering of SpinVault and NAND cell structures.

Current implementation:

- Static HTML, CSS, and JavaScript in the repository root.
- Calls the local FastAPI gateway at `http://127.0.0.1:8000/api/predict` when available.

Production direction:

- Move to Next.js or another component framework only when the interface becomes too large for static files.
- Keep the public simulator fast, readable, and transparent about assumptions.
