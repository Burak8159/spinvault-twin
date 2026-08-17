from pydantic import BaseModel, Field


class SimulationRequest(BaseModel):
    mode: str = Field(pattern="^(nand|spin)$")
    bit_state: int = Field(ge=0, le=1)
    barrier_height_ev: float = Field(gt=0, le=8)
    electron_energy_ev: float = Field(gt=0, le=8)
    barrier_nm: float = Field(gt=0, le=10)
    spin_polarization: float = Field(ge=0, le=0.95)
    temperature_k: float = Field(ge=1, le=800)
    disturbance: float = Field(ge=0, le=1)
    source: str = "website"


class PredictionResponse(BaseModel):
    run_id: str
    mode: str
    bit_state: int
    tunnel_probability: float
    retention_margin: float
    leakage_pressure: float
    attack_exposure: float
    tmr_ratio: float
    thermal_stability_delta: float
    design_window: str
    model_path: str
    notes: list[str]


class ValidationJobResponse(BaseModel):
    job_id: str
    run_id: str
    status: str
    estimated_seconds: int
    budget_units_reserved: int
