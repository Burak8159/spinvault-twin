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
    uncertainty = observation.get("uncertainty")
    if uncertainty is not None:
        if not _number(uncertainty) or uncertainty < 0:
            return unknown("Observation uncertainty is invalid")
        low, high = value - uncertainty, value + uncertainty
        if not math.isfinite(low) or not math.isfinite(high):
            return unknown("Observation uncertainty interval is non-finite")
        if op == "abs<":
            minimum = 0 if low <= 0 <= high else min(abs(low), abs(high))
            maximum = max(abs(low), abs(high))
            verdict = "PASS" if maximum < target else "FAIL" if minimum >= target else "NOT_EVALUATED"
        elif op == "==":
            verdict = "PASS" if low == high == target else "FAIL" if target < low or target > high else "NOT_EVALUATED"
        else:
            compare = {"<": lambda x: x < target, "<=": lambda x: x <= target,
                       ">": lambda x: x > target, ">=": lambda x: x >= target}[op]
            outcomes = [compare(low), compare(high)]
            verdict = "PASS" if all(outcomes) else "FAIL" if not any(outcomes) else "NOT_EVALUATED"
        return {**result, "verdict": verdict, "reason": "Uncertainty interval crosses target" if verdict == "NOT_EVALUATED" else "Qualified observation interval", "interval": {"low": low, "high": high, "unit": requirement["unit"]}}
    return {**result, "verdict": "PASS" if comparisons[op] else "FAIL", "reason": "Comparable qualified observation; uncertainty not supplied"}
