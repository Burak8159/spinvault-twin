from __future__ import annotations

from pathlib import Path

from spinvault.transport.cchain.fdf import write_cchain_job
from spinvault.transport.executables import probe_environment


def test_generated_fdf_uses_siesta_solution_method_not_transiesta_binary(tmp_path: Path):
    files = write_cchain_job(tmp_path)
    ts = files["ts"].read_text(encoding="utf-8")
    electrode = files["electrode_run"].read_text(encoding="utf-8")
    tbtrans = files["tbtrans"].read_text(encoding="utf-8")
    assert "DeltaV = 0.0 V" in ts
    assert "DeltaE = q_e * DeltaV" in ts
    assert "TS.Voltage 0.0 eV" in ts
    assert "SolutionMethod transiesta" in ts
    assert "transiesta" not in electrode.lower() or "SolutionMethod" not in electrode
    assert "XC.authors         PBE" in electrode
    assert "from -10.0 eV to 10.0 eV" in tbtrans
    geom = files["elec_geom"].read_text(encoding="utf-8")
    assert "NumberOfAtoms 4" in geom
    device = files["device_coords"].read_text(encoding="utf-8")
    assert "NumberOfAtoms 16" in device


def test_environment_does_not_require_transiesta_binary():
    env = probe_environment()
    if not env.configured:
        assert "transiesta" in env.message
        assert "siesta" in env.message
        assert "tbtrans" in env.message
    assert env.transiesta_binary is None or env.configured
