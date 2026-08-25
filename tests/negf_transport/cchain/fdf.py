"""Generate SIESTA/TranSIESTA/TBtrans inputs for the C-chain fixture.

TranSIESTA is a SolutionMethod inside ``siesta``. There is no separate
modern ``transiesta`` executable. ``tbtrans`` remains separate.
"""

from __future__ import annotations

from pathlib import Path

from ..compat.contracts import AppliedBias, StructureRecord
from .geometry import build_electrode, build_unconnected_device
from .parameters import FIXTURE_BIAS, TUTORIAL_PARAMETERS
from .siesta_adapter import ts_voltage_fdf_line


def write_geometry_fdf(record: StructureRecord, path: Path) -> None:
    species = []
    for symbol, *_ in record.atoms:
        if symbol not in species:
            species.append(symbol)
    z_of = {"C": 6, "O": 8}
    a1, a2, a3 = record.lattice_angstrom
    lines = [
        f"NumberOfAtoms {len(record.atoms)}",
        f"NumberOfSpecies {len(species)}",
        "%block ChemicalSpeciesLabel",
    ]
    for i, symbol in enumerate(species, start=1):
        lines.append(f" {i}  {z_of[symbol]}  {symbol}")
    lines.extend(
        [
            "%endblock ChemicalSpeciesLabel",
            "LatticeConstant 1.0 Ang",
            "%block LatticeVectors",
            f" {a1[0]:.8f} {a1[1]:.8f} {a1[2]:.8f}",
            f" {a2[0]:.8f} {a2[1]:.8f} {a2[2]:.8f}",
            f" {a3[0]:.8f} {a3[1]:.8f} {a3[2]:.8f}",
            "%endblock LatticeVectors",
            "AtomicCoordinatesFormat Ang",
            "%block AtomicCoordinatesAndAtomicSpecies",
        ]
    )
    index = {symbol: i for i, symbol in enumerate(species, start=1)}
    for symbol, x, y, z in record.atoms:
        lines.append(f" {x:.8f} {y:.8f} {z:.8f}  {index[symbol]}")
    lines.append("%endblock AtomicCoordinatesAndAtomicSpecies")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def electrode_run_fdf() -> str:
    k1, k2, k3 = TUTORIAL_PARAMETERS["electrode_k_mesh"].value
    cutoff = TUTORIAL_PARAMETERS["electrode_mesh_cutoff"].value
    basis = TUTORIAL_PARAMETERS["pao_basis_size"].value
    return f"""# artifact_role: TEST_FIXTURE
# source: official SIESTA Simple C-chain electrode/RUN.fdf
# XC: PBE is an exchange-correlation functional, not a plane-wave method.
SystemLabel     electrode
%include elec_geom.fdf
PAO.BasisSize {basis}
XC.functional      GGA
XC.authors         PBE
%block kgrid_Monkhorst_Pack
 {k1}  0  0  0.0
  0  {k2}  0  0.0
  0  0  {k3}  0.0
%endblock kgrid_Monkhorst_Pack
Diag.ParallelOverK   true
MeshCutoff         {cutoff} Ry
SCF.Mix              hamiltonian
MaxSCFIterations     100
DM.MixingWeight      0.01
DM.NumberPulay       8
DM.Tolerance         1.d-4
TS.DE.Save             .True.
TS.HS.Save             .True.
"""


def device_run_fdf() -> str:
    k1, k2, k3 = TUTORIAL_PARAMETERS["device_k_mesh"].value
    cutoff = TUTORIAL_PARAMETERS["device_mesh_cutoff"].value
    basis = TUTORIAL_PARAMETERS["pao_basis_size"].value
    return f"""# artifact_role: TEST_FIXTURE
# source: official SIESTA Simple C-chain unconnected/0V/RUN.fdf
%include device_coords.fdf
PAO.BasisSize      {basis}
XC.functional      GGA
XC.authors         PBE
%block kgrid_Monkhorst_Pack
  {k1}  0  0  0.0
  0  {k2}  0  0.0
  0  0  {k3}  0.0
%endblock kgrid_Monkhorst_Pack
MeshCutoff          {cutoff} Ry
DM.UseSaveDM         true
SCF.Mix              hamiltonian
MaxSCFIterations     200
DM.MixingWeight      0.01
DM.NumberPulay       6
DM.Tolerance         9.d-4
%include TS.fdf
%include TBtrans.fdf
SaveRho                      true
SaveElectrostaticPotential   true
WriteHirshfeldPop true
"""


def ts_fdf(bias: AppliedBias | None = None) -> str:
    applied = FIXTURE_BIAS if bias is None else bias
    eta = TUTORIAL_PARAMETERS["ts_eta"].value
    voltage_line = ts_voltage_fdf_line(applied)
    return f"""# artifact_role: TEST_FIXTURE
# TranSIESTA is SolutionMethod transiesta inside the siesta executable.
SolutionMethod transiesta
{voltage_line}
TS.Elecs.DM.Update none
TS.Elecs.DM.Init   diagon
TS.Elecs.Bulk      true
%block TS.ChemPots
  Left
  Right
%endblock TS.ChemPots
%block TS.ChemPot.Left
  mu V/2
  contour.eq
    begin
     C-Left
     T-Left
    end
%endblock TS.ChemPot.Left
%block TS.ChemPot.Right
  mu -V/2
  contour.eq
    begin
      C-Right
      T-Right
    end
%endblock TS.ChemPot.Right
TS.Contours.Eq.Pole 2.5 eV
%block TS.Contour.C-Left
  part circle
   from -40. eV + V/2 to -10 kT + V/2
     points 22
      method g-legendre
%endblock TS.Contour.C-Left
%block TS.Contour.T-Left
  part tail
   from prev to inf
     points 10
      method g-fermi
%endblock TS.Contour.T-Left
%block TS.Contour.C-Right
  part circle
   from -40. eV -V/2 to -10 kT -V/2
     points 22
      method g-legendre
%endblock TS.Contour.C-Right
%block TS.Contour.T-Right
  part tail
   from prev to inf
     points 10
      method g-fermi
%endblock TS.Contour.T-Right
%block TS.Contours.nEq
  neq
%endblock TS.Contours.nEq
%block TS.Contour.nEq.neq
  part line
  from -|V|/2 - 5 kT to |V|/2 + 5 kT
  delta 0.020 eV
  method mid-rule
%endblock TS.Contour.nEq.neq
TS.Contours.nEq.Eta    {eta} meV
TS.Elecs.Eta           {eta} meV
%block TS.Elecs
  Left
  Right
%endblock TS.Elecs
%block TS.Elec.Left
  HS ../../electrode/electrode.TSHS
  chemical-potential Left
  semi-inf-direction -a1
  electrode-position 1
%endblock
%block TS.Elec.Right
  HS ../../electrode/electrode.TSHS
  chemical-potential Right
  semi-inf-direction +a1
  electrode-position end -1
  used-atoms 4
%endblock
"""


def tbtrans_fdf() -> str:
    e0 = TUTORIAL_PARAMETERS["tbtrans_energy_from"].value
    e1 = TUTORIAL_PARAMETERS["tbtrans_energy_to"].value
    de = TUTORIAL_PARAMETERS["tbtrans_energy_delta"].value
    return f"""# artifact_role: TEST_FIXTURE
# source: official SIESTA Simple C-chain unconnected/0V/TBtrans.fdf
TBT.DOS.Gf true
TBT.DOS.A true
TBT.DOS.A.All true
%block TBT.Contours
line
%endblock TBT.Contours
%block TBT.Contour.line
  from {e0} eV to {e1} eV
    delta {de} eV
      method mid-rule
%endblock TBT.Contour
"""


def write_cchain_job(root: Path) -> dict[str, Path]:
    electrode = build_electrode()
    device = build_unconnected_device()
    elec_dir = root / "electrode"
    device_dir = root / "unconnected" / "0V"
    elec_dir.mkdir(parents=True, exist_ok=True)
    device_dir.mkdir(parents=True, exist_ok=True)
    write_geometry_fdf(electrode.record, elec_dir / "elec_geom.fdf")
    (elec_dir / "RUN.fdf").write_text(electrode_run_fdf(), encoding="utf-8")
    write_geometry_fdf(device.record, device_dir / "device_coords.fdf")
    (device_dir / "RUN.fdf").write_text(device_run_fdf(), encoding="utf-8")
    (device_dir / "TS.fdf").write_text(ts_fdf(FIXTURE_BIAS), encoding="utf-8")
    (device_dir / "TBtrans.fdf").write_text(tbtrans_fdf(), encoding="utf-8")
    return {
        "electrode_run": elec_dir / "RUN.fdf",
        "device_run": device_dir / "RUN.fdf",
        "ts": device_dir / "TS.fdf",
        "tbtrans": device_dir / "TBtrans.fdf",
        "elec_geom": elec_dir / "elec_geom.fdf",
        "device_coords": device_dir / "device_coords.fdf",
    }
