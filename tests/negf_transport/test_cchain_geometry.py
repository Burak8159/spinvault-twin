from __future__ import annotations

from spinvault.transport.cchain.geometry import build_electrode, build_unconnected_device
from spinvault.core.taxonomy import ArtifactRole


def test_electrode_is_four_carbon_atoms_with_tutorial_spacing():
    electrode = build_electrode()
    assert len(electrode.record.atoms) == 4
    assert all(symbol == "C" for symbol, *_ in electrode.record.atoms)
    xs = [atom[1] for atom in electrode.record.atoms]
    assert xs == [0.0, 1.5, 3.0, 4.5]
    assert electrode.record.lattice_angstrom[0][0] == 6.0
    assert electrode.record.artifact_role is ArtifactRole.TEST_FIXTURE


def test_unconnected_device_matches_official_tile_vacuum_append():
    device = build_unconnected_device()
    assert len(device.record.atoms) == 16
    assert device.record.lattice_angstrom[0][0] == 27.0
    assert device.metadata.left_electrode_atom_indices == (0, 1, 2, 3)
    assert device.metadata.right_electrode_atom_indices == (12, 13, 14, 15)
    left_contact_end = device.record.atoms[7][1]
    right_contact_start = device.record.atoms[8][1]
    assert left_contact_end == 10.5
    assert right_contact_start == 15.0
    assert right_contact_start - left_contact_end == 4.5
