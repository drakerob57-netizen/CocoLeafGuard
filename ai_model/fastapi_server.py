"""
fastapi_server.py  —  CocoLeafGuard persistent prediction server
Place this file inside  ai_model/  (same folder as predict.py and db.py).

Start once and leave running:
    python fastapi_server.py

The YOLO and Random Forest models load a single time on startup and stay
in memory for every subsequent request, eliminating the 10-30 s cold-start
that occurs when PHP shells out to Python for every image.

Data (trees + captured images + their prediction results) is persisted to
a local SQLite database (cocoleafguard.db, via db.py) so nothing is lost
when the browser tab is closed or refreshed.

Endpoints
─────────
GET    /health              →  liveness check
POST   /predict              →  run inference on an uploaded image, returns
                                the same JSON structure as before (plus
                                "original_image", the permanent URL of the
                                uploaded photo)

GET    /trees                →  list every saved tree with its images
GET    /trees/{tree_id}      →  fetch a single tree with its images
POST   /trees                →  create a tree (optionally with images)
PUT    /trees/{tree_id}      →  update a tree's label / coordinates / photo
DELETE /trees/{tree_id}      →  delete a tree and its images

POST   /trees/{tree_id}/images  →  attach an already-analyzed image to a tree
DELETE /images/{image_id}       →  remove a single image
"""

import os
import sys
import time
import uuid
import logging
from typing import Optional, List

import numpy as np
import cv2

from fastapi import FastAPI, File, UploadFile, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

import db

# ── Logging ───────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("cocoleafguard")

# ── Path setup ────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "uploads"))
os.makedirs(UPLOAD_DIR, exist_ok=True)

# NOTE: generated images (original upload, annotated boxes/no-boxes, class
# overlays) are now kept permanently on disk, because saved tree/image
# records in the database reference them by URL. The old 5-minute
# auto-cleanup was actively deleting files that the frontend needed to
# still be able to show after a refresh, so it has been removed.

# ── Import predict module (models load here, ONCE at startup) ─
sys.path.insert(0, SCRIPT_DIR)
try:
    from predict import run_prediction, run_prediction_from_bytes, _model, _rf_model
    model_status = {
        "yolo": "loaded" if _model    is not None else "failed",
        "rf":   "loaded" if _rf_model is not None else "failed (using fallback)",
    }
    log.info("Models loaded: %s", model_status)
except Exception as exc:
    log.error("Failed to import predict.py: %s", exc)
    raise SystemExit(1) from exc


# ── DB init ───────────────────────────────────────────────────
db.init_db()
log.info("SQLite database ready at %s", db.DB_PATH)


# ── Request/response models ────────────────────────────────────

class Coordinates(BaseModel):
    lat: float
    lng: float


class ImageIn(BaseModel):
    url: str
    timestamp: str
    result: dict


class TreeCreate(BaseModel):
    locationLabel: str = ""
    coordinates: Optional[Coordinates] = None
    photo: Optional[str] = None
    inspectedAt: Optional[str] = None
    images: Optional[List[ImageIn]] = None


class TreeUpdate(BaseModel):
    locationLabel: Optional[str] = None
    coordinates: Optional[Coordinates] = None
    photo: Optional[str] = None


# ── FastAPI app ───────────────────────────────────────────────
app = FastAPI(
    title="CocoLeafGuard Prediction API",
    description="Persistent YOLO + Random Forest leaf disease detection",
    version="1.0.0",
)

# Allow requests from the PHP frontend (same machine, different port)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],   # add PUT and DELETE
    allow_headers=["*"],
)


# ── Routes ────────────────────────────────────────────────────

@app.get("/health")
def health():
    """Quick liveness + model status check."""
    return {
        "status":  "ok",
        "models":  model_status,
        "uploads": UPLOAD_DIR,
    }


@app.post("/predict")
async def predict(image: UploadFile = File(...)):
    """
    Accept an image upload, run inference, return results.

    The original upload and every generated image (boxes / no-boxes /
    class overlays) are written permanently to UPLOAD_DIR so that once the
    frontend saves this result against a tree, everything referenced by
    URL is still there after a browser refresh.
    """
    # ── Validate content type ─────────────────────────────────
    if image.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported image type: {image.content_type}. Use JPEG or PNG.",
        )

    # ── Decode upload in memory with OpenCV ─────────────────────
    try:
        contents = await image.read()
        image_bgr = cv2.imdecode(np.frombuffer(contents, np.uint8), cv2.IMREAD_COLOR)
        if image_bgr is None:
            raise ValueError("Unable to decode uploaded image")
        log.info("Decoded upload in memory (%d bytes)", len(contents))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not decode upload: {exc}")

    # ── Persist the original upload so the gallery thumbnail survives
    #     a refresh (previously this was only kept as a client-side data
    #     URL that lived nowhere once the JS state was gone) ──────────
    ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}.get(
        image.content_type, ".jpg"
    )
    base_stem = f"frame_{int(time.time())}_{uuid.uuid4().hex[:8]}"
    original_filename = f"original_{base_stem}{ext}"
    original_filepath = os.path.join(UPLOAD_DIR, original_filename)
    try:
        with open(original_filepath, "wb") as f:
            f.write(contents)
    except OSError as exc:
        log.warning("Could not save original upload: %s", exc)

    # ── Run prediction (models already in memory) ─────────────
    log.info("Running inference on in-memory upload …")
    t0      = time.perf_counter()
    result  = run_prediction_from_bytes(contents, upload_dir=UPLOAD_DIR, base_stem=base_stem)
    elapsed = time.perf_counter() - t0
    log.info("Inference done in %.2f s  |  status=%s", elapsed, result.get("status"))

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    result["original_image"] = f"../uploads/{original_filename}"
    return result


# ── Tree endpoints ──────────────────────────────────────────────

@app.get("/trees")
def get_trees():
    """Return every saved tree (with nested images) for populating the UI on load."""
    return {"trees": db.list_trees()}


@app.get("/trees/{tree_id}")
def get_tree(tree_id: int):
    tree = db.get_tree(tree_id)
    if not tree:
        raise HTTPException(status_code=404, detail="Tree not found")
    return tree


@app.post("/trees")
def create_tree(payload: TreeCreate):
    lat = payload.coordinates.lat if payload.coordinates else None
    lng = payload.coordinates.lng if payload.coordinates else None
    images = [im.dict() for im in payload.images] if payload.images else None
    tree = db.create_tree(
        location_label=payload.locationLabel,
        lat=lat,
        lng=lng,
        photo=payload.photo,
        inspected_at=payload.inspectedAt or time.strftime("%Y-%m-%dT%H:%M:%S"),
        images=images,
    )
    return tree


@app.put("/trees/{tree_id}")
def update_tree(tree_id: int, payload: TreeUpdate):
    lat = payload.coordinates.lat if payload.coordinates else None
    lng = payload.coordinates.lng if payload.coordinates else None
    tree = db.update_tree(
        tree_id,
        location_label=payload.locationLabel,
        lat=lat,
        lng=lng,
        photo=payload.photo,
    )
    if not tree:
        raise HTTPException(status_code=404, detail="Tree not found")
    return tree


@app.delete("/trees/{tree_id}")
def delete_tree(tree_id: int):
    ok = db.delete_tree(tree_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Tree not found")
    return {"deleted": True, "id": tree_id}


# ── Image endpoints ─────────────────────────────────────────────

@app.post("/trees/{tree_id}/images")
def add_image(tree_id: int, payload: ImageIn):
    image = db.add_image(tree_id, payload.url, payload.timestamp, payload.result)
    if not image:
        raise HTTPException(status_code=404, detail="Tree not found")
    return image


@app.delete("/images/{image_id}")
def delete_image(image_id: int):
    ok = db.delete_image(image_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Image not found")
    return {"deleted": True, "id": image_id}


# ── Entry point ───────────────────────────────────────────────
if __name__ == "__main__":
    log.info("Starting CocoLeafGuard FastAPI server on http://0.0.0.0:8000")
    log.info("Upload directory: %s", UPLOAD_DIR)
    uvicorn.run(
        "fastapi_server:app",
        host="0.0.0.0",
        port=8000,
        reload=False,   # keep False — reload would re-load the models on every change
        log_level="info",
    )