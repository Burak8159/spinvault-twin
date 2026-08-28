"""Parameter taxonomy: origin, status, and artifact_role are distinct fields."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class ParameterOrigin(str, Enum):
    PAPER_DIRECT_DESIGN = "PAPER_DIRECT_DESIGN"
    PAPER_ILLUSTRATIVE_ASSUMPTION = "PAPER_ILLUSTRATIVE_ASSUMPTION"
    PAPER_LITERATURE_ADOPTED = "PAPER_LITERATURE_ADOPTED"
    PAPER_LITERATURE_MOTIVATED_MODEL_VALUE = "PAPER_LITERATURE_MOTIVATED_MODEL_VALUE"
    PAPER_DERIVED = "PAPER_DERIVED"
    PAPER_PARAMETER_SWEEP = "PAPER_PARAMETER_SWEEP"
    PAPER_ILLUSTRATIVE_CORRECTION = "PAPER_ILLUSTRATIVE_CORRECTION"
    LITERATURE_DIRECT = "LITERATURE_DIRECT"
    PROJECT_METHOD = "PROJECT_METHOD"
    PROPOSED_METHOD = "PROPOSED_METHOD"
    PROPOSED_SIMULATION_DESIGN = "PROPOSED_SIMULATION_DESIGN"
    SOFTWARE_DEFAULT = "SOFTWARE_DEFAULT"
    INFRASTRUCTURE_DEFAULT = "INFRASTRUCTURE_DEFAULT"
    COMPUTED_FIRST_PRINCIPLES = "COMPUTED_FIRST_PRINCIPLES"
    COMPUTED_TRANSPORT = "COMPUTED_TRANSPORT"
    COMPUTED_DERIVED = "COMPUTED_DERIVED"
    FITTED_COMPUTATIONAL = "FITTED_COMPUTATIONAL"
    EXPERIMENTAL_INPUT = "EXPERIMENTAL_INPUT"
    CALIBRATED_TO_EXPERIMENT = "CALIBRATED_TO_EXPERIMENT"
    USER_OVERRIDE = "USER_OVERRIDE"


class ParameterStatus(str, Enum):
    UNSET = "UNSET"
    PROPOSED = "PROPOSED"
    NEEDS_CONVERGENCE = "NEEDS_CONVERGENCE"
    CONVERGED = "CONVERGED"
    COMPUTED = "COMPUTED"
    FITTED = "FITTED"
    VALIDATED = "VALIDATED"
    DEPRECATED = "DEPRECATED"
    REFERENCE_ONLY = "REFERENCE_ONLY"
    UNRESOLVED = "UNRESOLVED"


class ArtifactRole(str, Enum):
    PRODUCTION = "PRODUCTION"
    TEST_FIXTURE = "TEST_FIXTURE"
    BENCHMARK = "BENCHMARK"
    REGRESSION_REFERENCE = "REGRESSION_REFERENCE"


class SourceKind(str, Enum):
    """Where the *number* came from. This is not ParameterOrigin.

    DEVELOPER_2_GOOD_NEGF_TRANSPORT_ENSEMBLES does not add UPSTREAM_REFERENCE
    or SYNTHETIC_TEST_DATA to ParameterOrigin. Those remain platform schema
    requests for DEVELOPER_1_VERY_GOOD_PLATFORM_AWS_INTEGRATION.
    """

    PAPER = "PAPER"
    LITERATURE = "LITERATURE"
    PROJECT = "PROJECT"
    OFFICIAL_SOFTWARE_TUTORIAL = "OFFICIAL_SOFTWARE_TUTORIAL"
    SYNTHETIC_TEST_DATA = "SYNTHETIC_TEST_DATA"
    ENGINE_ADAPTER = "ENGINE_ADAPTER"


# Not members of ParameterOrigin. Platform lead decides whether to promote them.
REQUESTED_ORIGIN_UPSTREAM_REFERENCE = "UPSTREAM_REFERENCE"
REQUESTED_ORIGIN_SYNTHETIC_TEST_DATA = "SYNTHETIC_TEST_DATA"


@dataclass(frozen=True)
class ScientificParameter:
    name: str
    value: Any
    unit: Optional[str]
    origin: ParameterOrigin
    status: ParameterStatus
    artifact_role: ArtifactRole = ArtifactRole.PRODUCTION
    source: Optional[str] = None
    source_kind: Optional[SourceKind] = None
    requested_origin: Optional[str] = None
    notes: Optional[str] = None
    extra: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.origin is ParameterOrigin.PROJECT_METHOD and self.status is ParameterStatus.NEEDS_CONVERGENCE:
            raise ValueError(
                f"{self.name}: PROJECT_METHOD + NEEDS_CONVERGENCE is invalid. "
                "Propose a concrete value (PROPOSED_METHOD) before marking NEEDS_CONVERGENCE."
            )
        if self.requested_origin in ParameterOrigin.__members__:
            raise ValueError(
                f"{self.name}: requested_origin={self.requested_origin} is already a ParameterOrigin. "
                "Use origin= that member instead of a pending request."
            )
        if self.source_kind is SourceKind.OFFICIAL_SOFTWARE_TUTORIAL and not self.source:
            raise ValueError(f"{self.name}: tutorial-derived values require an exact source citation")
        # Absent source_kind is None, not a sentinel UNSET member.
        if self.source_kind is SourceKind.SYNTHETIC_TEST_DATA and self.origin is ParameterOrigin.COMPUTED_TRANSPORT:
            raise ValueError(f"{self.name}: synthetic test data cannot be COMPUTED_TRANSPORT")
        if self.source_kind is SourceKind.SYNTHETIC_TEST_DATA and self.origin is ParameterOrigin.SOFTWARE_DEFAULT:
            raise ValueError(f"{self.name}: synthetic test data is not a software default")
