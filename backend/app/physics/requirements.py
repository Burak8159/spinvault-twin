"""Compare requirement and observable records without inventing targets or units.

Results remain NOT_EVALUATED if source evidence, measurement conditions or
scientific qualification are insufficient. No implicit unit conversion is made.
"""
from __future__ import annotations

import math
from typing import Any


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def evaluate_requirement(requirement: dict[str, Any], observation: dict[str, Any]) -> dict[str, Any]:
    """Evaluate one traceable measurement against an explicit requirement.

    Conditions use exact, structured key/value matching. This intentionally
    does not assume that e.g. different temperatures or bias conditions agree.
    """
    result = {"requirement_id": requirement.get("id"), "verdict": "NOT_EVALUATED", "reason": ""}
    def unknown(reason: str) -> dict[str, Any]:
        return {**result, "reason": reason}

    if not requirement.get("id") or not requirement.get("metric"):
        return unknown("Requirement identity or metric missing")
    if requirement.get("status") != "SPECIFIED":
        return unknown("Target not specified")
    target, value = requirement.get("target"), observation.get("value")
    if not _number(target) or not _number(value):
        return unknown("Target or observation is missing or non-finite")
    if not requirement.get("source") or requirement.get("source") == "UNSPECIFIED":
        return unknown("Requirement source missing")
    if observation.get("metric") != requirement["metric"]:
        return unknown("Observable does not match requirement")
    if not requirement.get("unit") or observation.get("unit") != requirement["unit"]:
        return unknown("Units do not match")
    conditions = requirement.get("conditions")
    if not isinstance(conditions, dict) or not conditions:
        return unknown("Structured requirement conditions missing")
    observed_conditions = observation.get("conditions")
    if not isinstance(observed_conditions, dict) or any(
        observed_conditions.get(k) != v or v is None
        or (isinstance(v, bool) != isinstance(observed_conditions.get(k), bool)) for k, v in conditions.items()
    ):
        return unknown("Operating conditions do not match")
    if observation.get("qualified") is not True or not observation.get("source"):
        return unknown("Qualified observation evidence missing")
    op = requirement.get("comparator")
    comparisons = {"<": value < target, "<=": value <= target, "==": value == target,
                   ">=": value >= target, ">": value > target, "abs<": abs(value) < target}
    if op not in comparisons:
        return unknown("Comparator is unsupported or missing")
    return {**result, "verdict": "PASS" if comparisons[op] else "FAIL", "reason": "Comparable qualified observation"}
