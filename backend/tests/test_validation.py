from app.models.simulation import Quantity, SimulationRequest
from app.services.validation import validate_simulation_request
from tests.conftest import sample_demo_payload, sample_mumax_payload


def test_valid_demo_request_has_no_blocking_errors() -> None:
    request = SimulationRequest.model_validate(sample_demo_payload())
    result = validate_simulation_request(request)
    assert result.ok


def test_invalid_quantity_value_rejected_by_schema() -> None:
    payload = sample_demo_payload()
    payload["geometry"]["freeLayerThickness"]["value"] = float("nan")
    try:
        SimulationRequest.model_validate(payload)
        raised = False
    except Exception:
        raised = True
    assert raised


def test_nonpositive_length_fails_validation() -> None:
    payload = sample_demo_payload()
    payload["geometry"]["freeLayerLength"]["value"] = 0
    request = SimulationRequest.model_validate(payload)
    result = validate_simulation_request(request)
    assert not result.ok
    assert any(error.field == "geometry.freeLayerLength" for error in result.errors)


def test_quantity_unit_must_be_known() -> None:
    try:
        Quantity(value=1.0, unit="not-a-unit")
        raised = False
    except Exception:
        raised = True
    assert raised


def test_mesh_cell_may_equal_film_thickness() -> None:
    payload = sample_mumax_payload()
    payload["geometry"]["freeLayerThickness"] = {"value": 1.2, "unit": "nm", "source": "preset"}
    payload["solverDrafts"]["mumax3"]["gridSize"] = {"nx": 8, "ny": 4, "nz": 1}
    payload["solverDrafts"]["mumax3"]["meshCellSize"]["z"] = {"value": 1.2, "unit": "nm"}
    request = SimulationRequest.model_validate(payload)
    result = validate_simulation_request(request)
    assert result.ok
    assert not any(error.code == "mesh-z-dimension" for error in result.errors)


def test_mesh_cell_larger_than_device_is_rejected() -> None:
    payload = sample_mumax_payload()
    payload["geometry"]["freeLayerThickness"] = {"value": 1.2, "unit": "nm", "source": "preset"}
    payload["solverDrafts"]["mumax3"]["meshCellSize"]["z"] = {"value": 2.4, "unit": "nm"}
    request = SimulationRequest.model_validate(payload)
    result = validate_simulation_request(request)
    assert not result.ok
    assert any(error.code == "mesh-z-dimension" for error in result.errors)
