"""
fastapi_server.py  —  CocoLeafGuard persistent prediction server
Place this file inside  ai_model/  (same folder as predict.py).

Start once and leave running:
    python fastapi_server.py

The YOLO and Random Forest models load a single time on startup and stay
in memory for every subsequent request, eliminating the 10-30 s cold-start
that occurs when PHP shells out to Python for every image.

Endpoints
─────────
GET  /health   →  liveness check
POST /predict  →  accepts multipart/form-data with field "image"
                  returns the same JSON structure as before
"""

import os
import sys
import time
import uuid
import asyncio
import logging

import numpy as np
import cv2

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

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

# How long (seconds) to keep generated overlay / annotated images on disk
# before auto-deleting them.  5 minutes gives the browser plenty of time
# to load and display them.
CLEANUP_DELAY_SECONDS = 300

# ── Import predict module (models load here, ONCE at startup) ─
sys.path.insert(0, SCRIPT_DIR)
try:
    from predict import run_prediction, _model, _rf_model
    model_status = {
        "yolo": "loaded" if _model    is not None else "failed",
        "rf":   "loaded" if _rf_model is not None else "failed (using fallback)",
    }
    log.info("Models loaded: %s", model_status)
except Exception as exc:
    log.error("Failed to import predict.py: %s", exc)
    raise SystemExit(1) from exc


# ── Cleanup helpers ───────────────────────────────────────────

def _collect_generated_files(result: dict) -> list:
    """Return absolute paths for every image file predict.py wrote to disk."""
    paths = []
    for key in ("image_with_boxes", "image_without_boxes"):
        url = result.get(key, "")
        if url:
            paths.append(os.path.join(UPLOAD_DIR, os.path.basename(url)))
    for url in result.get("class_overlays", {}).values():
        if url:
            paths.append(os.path.join(UPLOAD_DIR, os.path.basename(url)))
    return paths


async def _delete_after_delay(paths: list) -> None:
    """Background task: wait CLEANUP_DELAY_SECONDS then silently delete files."""
    await asyncio.sleep(CLEANUP_DELAY_SECONDS)
    deleted = 0
    for path in paths:
        try:
            if os.path.exists(path):
                os.remove(path)
                deleted += 1
        except OSError as exc:
            log.warning("Could not delete %s: %s", path, exc)
    if deleted:
        log.info("Auto-cleaned %d temporary file(s)", deleted)

# ── FastAPI app ───────────────────────────────────────────────
app = FastAPI(
    title="CocoLeafGuard Prediction API",
    description="Persistent YOLO + Random Forest leaf disease detection",
    version="1.0.0",
)

# Allow requests from the PHP frontend (same machine, different port)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # lock down to your domain in production
    allow_methods=["GET", "POST"],
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

    File lifecycle
    ──────────────
    • Original upload  → deleted immediately after prediction completes
      (it is only needed during inference; keeping it wastes disk space).
    • Generated overlays / annotated images → auto-deleted after
      CLEANUP_DELAY_SECONDS (default 5 min) so the browser has time
      to load and display them before they disappear.
    """
    # ── Validate content type ─────────────────────────────────
    if image.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported image type: {image.content_type}. Use JPEG or PNG.",
        )

    # ── Save upload temporarily ───────────────────────────────
    ext      = os.path.splitext(image.filename or "upload.jpg")[1].lower() or ".jpg"
    filename = f"{int(time.time())}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    try:
        contents = await image.read()
        with open(filepath, "wb") as fh:
            fh.write(contents)
        log.info("Saved upload → %s  (%d bytes)", filename, len(contents))
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not save upload: {exc}")

    # ── Run prediction (models already in memory) ─────────────
    log.info("Running inference on %s …", filename)
    t0      = time.perf_counter()
    result  = run_prediction(filepath)
    elapsed = time.perf_counter() - t0
    log.info("Inference done in %.2f s  |  status=%s", elapsed, result.get("status"))

    # ── Delete original upload immediately ────────────────────
    try:
        os.remove(filepath)
        log.info("Deleted original upload: %s", filename)
    except OSError:
        pass  # not critical if it fails

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    # ── Schedule auto-cleanup of generated overlay files ──────
    generated_files = _collect_generated_files(result)
    if generated_files:
        asyncio.create_task(_delete_after_delay(generated_files))
        log.info(
            "Scheduled cleanup of %d generated file(s) in %ds",
            len(generated_files), CLEANUP_DELAY_SECONDS,
        )

    return result


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