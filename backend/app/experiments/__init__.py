"""Structured scientific experiment definitions."""

from .equilibrium import V01_EQUILIBRIUM

EXPERIMENTS = {V01_EQUILIBRIUM.experiment_id: V01_EQUILIBRIUM}

__all__ = ["EXPERIMENTS", "V01_EQUILIBRIUM"]
