"""Solver adapters. Demo is always available; MuMax3 runs only when configured."""

from app.solvers.demo import DemoSolver
from app.solvers.kwant import KwantSolver
from app.solvers.mumax3 import Mumax3Solver
from app.solvers.surrogate import SurrogateSolver

__all__ = ["DemoSolver", "KwantSolver", "Mumax3Solver", "SurrogateSolver"]
