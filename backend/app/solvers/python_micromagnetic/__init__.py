"""Local NumPy finite-difference LLGS solver. Not MuMax3."""

__all__ = ["PythonMicromagneticAdapter"]


def __getattr__(name: str):
    if name == "PythonMicromagneticAdapter":
        from app.solvers.python_micromagnetic.adapter import PythonMicromagneticAdapter

        return PythonMicromagneticAdapter
    raise AttributeError(name)
