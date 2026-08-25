"""C-chain geometry matching the official tutorial write_elec / write_unconnected scripts."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json

from ..compat.contracts import StructureRecord, TransportGeometryMetadata
from ..compat.taxonomy import ArtifactRole
from .parameters import TUTORIAL_PARAMETERS


@dataclass(frozen=True)
class CChainGeometry:
    record: StructureRecord
    metadata: TransportGeometryMetadata


def _hash_structure(payload: dict) -> str:
    encoded = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def build_electrode() -> CChainGeometry:
    bond = float(TUTORIAL_PARAMETERS["c_c_bond"].value)
    ax, ay, az = TUTORIAL_PARAMETERS["electrode_lattice"].value
    yz = float(TUTORIAL_PARAMETERS["transverse_vacuum_center"].value)
    atoms = tuple(("C", i * bond, yz, yz) for i in range(4))
    lattice = ((ax, 0.0, 0.0), (0.0, ay, 0.0), (0.0, 0.0, az))
    payload = {"atoms": atoms, "lattice": lattice, "kind": "electrode"}
    record = StructureRecord(
        structure_id="fixture.cchain.electrode.v0",
        chemical_formula="C4",
        atoms=atoms,
        lattice_angstrom=lattice,
        periodicity=(3, 1, 1),
        material_identity="tutorial_carbon_chain_electrode",
        structure_hash=_hash_structure(payload),
        construction_metadata={
            "source": "official Simple C-chain write_elec.py",
            "principal_layer_reason": "four atoms so the SZP electrode couples to one neighbor cell",
        },
        artifact_role=ArtifactRole.TEST_FIXTURE,
    )
    metadata = TransportGeometryMetadata(
        transport_axis="a1",
        electrode_principal_layer_atoms=4,
        left_electrode_atom_indices=(0, 1, 2, 3),
        right_electrode_atom_indices=(0, 1, 2, 3),
        scattering_atom_indices=(),
        atom_ordering="increasing x along a1",
        periodic_directions=("a1",),
        boundary_matching="electrode cell is its own principal layer",
    )
    return CChainGeometry(record=record, metadata=metadata)


def build_unconnected_device() -> CChainGeometry:
    """Two electrode tiles, 3 Ang gap, then the same contact again.

    Reproduces:
        contact = elec.tile(2, 0)
        device = contact.add_vacuum(3, 0).append(contact, 0)
    """
    electrode = build_electrode()
    ax, ay, az = electrode.record.lattice_angstrom[0][0], electrode.record.lattice_angstrom[1][1], electrode.record.lattice_angstrom[2][2]
    gap = float(TUTORIAL_PARAMETERS["unconnected_gap"].value)
    contact_atoms = electrode.record.atoms + tuple(
        (sym, x + ax, y, z) for sym, x, y, z in electrode.record.atoms
    )
    contact_length = 2.0 * ax
    device_atoms = contact_atoms + tuple(
        (sym, x + contact_length + gap, y, z) for sym, x, y, z in contact_atoms
    )
    device_ax = 2.0 * contact_length + gap
    lattice = ((device_ax, 0.0, 0.0), (0.0, ay, 0.0), (0.0, 0.0, az))
    n = len(device_atoms)
    payload = {"atoms": device_atoms, "lattice": lattice, "kind": "unconnected_device"}
    record = StructureRecord(
        structure_id="fixture.cchain.unconnected.v0",
        chemical_formula="C16",
        atoms=device_atoms,
        lattice_angstrom=lattice,
        periodicity=(3, 1, 1),
        material_identity="tutorial_unconnected_carbon_chains",
        structure_hash=_hash_structure(payload),
        construction_metadata={
            "source": "official Simple C-chain write_unconnected.py",
            "gap_angstrom": gap,
            "scientific_role": "software/integration validation only",
        },
        artifact_role=ArtifactRole.TEST_FIXTURE,
    )
    metadata = TransportGeometryMetadata(
        transport_axis="a1",
        electrode_principal_layer_atoms=4,
        left_electrode_atom_indices=(0, 1, 2, 3),
        right_electrode_atom_indices=(n - 4, n - 3, n - 2, n - 1),
        scattering_atom_indices=tuple(range(4, n - 4)),
        atom_ordering="left electrode, left contact, gap, right contact, right electrode",
        periodic_directions=("a1",),
        boundary_matching="left uses electrode-position 1; right uses electrode-position end -1, used-atoms 4",
    )
    return CChainGeometry(record=record, metadata=metadata)
