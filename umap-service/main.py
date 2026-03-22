from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="UMAP Service", version="0.1.0")


class HealthResponse(BaseModel):
    status: str


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(status="ok")


class UMAPRequest(BaseModel):
    features: list[list[float]]
    n_neighbors: int = 15
    min_dist: float = 0.1


class UMAPResponse(BaseModel):
    coordinates: list[list[float]]


@app.post("/umap", response_model=UMAPResponse)
async def compute_umap(request: UMAPRequest):
    """Placeholder - will implement UMAP computation in Phase 4."""
    # Return dummy coordinates for now
    return UMAPResponse(
        coordinates=[[0.0, 0.0] for _ in request.features]
    )
