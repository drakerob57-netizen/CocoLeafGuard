import sys
import json
import torch
import os
import cv2
import joblib
import numpy as np
from ultralytics import YOLO

# ── Force CPU — avoids CUDA OOM errors on web server environments ─
os.environ["CUDA_VISIBLE_DEVICES"] = ""   # hide all GPUs before any CUDA init
torch.set_num_threads(4)                  # cap CPU threads to avoid PHP worker contention

# ── Constants ────────────────────────────────────────────────
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH   = os.path.join(SCRIPT_DIR, 'best_seed456.pt')
RF_MODEL_PATH   = os.path.join(SCRIPT_DIR, 'rf_severity_model.pkl')
RF_ENCODER_PATH = os.path.join(SCRIPT_DIR, 'rf_label_encoder.pkl')
CONF_THRESH  = 0.25

# Fallback thresholds if RF model is unavailable
SEVERITY_THRESHOLDS = {
    "Severe":   0.50,
    "Moderate": 0.15,
}

COLOR_MAP = {
    "yellowing": "#FFC107",
    "gray-spot": "#6C757D",
    "gray spot": "#6C757D",
    "leaf rot":  "#A52A2A",
    "leaf-rot":  "#A52A2A",
}

# BGR format for OpenCV text
LABEL_COLOR_MAP_BGR = {
    "yellowing": (0, 193, 255),
    "gray-spot": (117, 117, 108),
    "gray spot": (117, 117, 108),
    "leaf rot":  (42, 42, 165),
    "leaf-rot":  (42, 42, 165),
}

# RGBA overlay colors per class for transparent PNG overlays
OVERLAY_COLOR_RGBA = {
    "yellowing": (255, 193, 7,   160),
    "gray-spot": (108, 117, 125, 160),
    "gray spot": (108, 117, 125, 160),
    "leaf rot":  (165, 42,  42,  160),
    "leaf-rot":  (165, 42,  42,  160),
}

RECOMMENDATIONS = {
    "Severe": [
        "Isolate affected palms immediately to prevent spread.",
        "Apply appropriate fungicide or treatment as advised by an agronomist.",
        "Increase monitoring frequency to every 3 days.",
        "Document affected fronds for disease progression tracking.",
    ],
    "Moderate": [
        "Monitor the affected area closely over the next 7 days.",
        "Consider targeted treatment on visibly affected fronds.",
        "Ensure proper drainage and avoid overhead irrigation.",
    ],
    "Mild": [
        "Continue standard care and monitoring.",
        "Re-assess in 14 days to check for progression.",
        "Ensure adequate nutrition and soil health.",
    ],
    "Healthy": [
        "Continue standard care and monitoring.",
    ],
}

# Canonical symptom classes expected by the RF model
RF_SYMPTOM_CLASSES = ['gray-spot', 'yellowing']

# ── Model loading — once at module level ─────────────────────
try:
    _model = YOLO(MODEL_PATH)
    _model.to('cpu')   # explicit CPU — avoids CUDA OOM on web servers
except Exception as e:
    _model = None
    _model_error = str(e)

try:
    _rf_model   = joblib.load(RF_MODEL_PATH)
    _rf_encoder = joblib.load(RF_ENCODER_PATH)
except Exception as e:
    _rf_model   = None
    _rf_encoder = None
    _rf_error   = str(e)


# ── Dynamic HSV Leaflet Area Estimation ──────────────────────
def estimate_leaflet_area_dynamic(image_bgr):
    """
    Estimate the actual leaf area using adaptive HSV thresholding.
    Returns (leaf_bool mask, leaf_area in pixels).
    Falls back to the full image if no leaf region is confidently found.
    """
    hsv     = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    oh, ow  = image_bgr.shape[:2]

    # Broad initial green/yellow-green mask
    broad = (
        ((h >= 18) & (h <= 100) & (s >= 20) & (v >= 20)) |
        ((h >= 10) & (h <= 35)  & (s >= 30) & (v >= 30))
    )

    if broad.sum() > 50:
        h_min = max(0,   int(np.percentile(h[broad],  5)) - 5)
        h_max = min(179, int(np.percentile(h[broad], 95)) + 5)
        s_min = max(0,   int(np.percentile(s[broad],  5)) - 10)
        s_max = min(255, int(np.percentile(s[broad], 95)) + 10)
        v_min = max(0,   int(np.percentile(v[broad],  5)) - 10)
        v_max = min(255, int(np.percentile(v[broad], 95)) + 10)
    else:
        h_min, h_max = 10, 100
        s_min, s_max = 20, 255
        v_min, v_max = 20, 255

    lower = np.array([h_min, s_min, v_min], dtype=np.uint8)
    upper = np.array([h_max, s_max, v_max], dtype=np.uint8)
    mask  = cv2.inRange(hsv, lower, upper)

    # Morphological cleanup
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    mask   = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask   = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  kernel)

    # Keep only the largest connected component
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if n > 1:
        largest = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
        mask    = (labels == largest).astype(np.uint8) * 255

    leaf_bool = mask > 0
    leaf_area = int(leaf_bool.sum())

    # Fall back to full image if leaf area is implausibly small
    if leaf_area < oh * ow * 0.05:
        leaf_bool = np.ones((oh, ow), dtype=bool)
        leaf_area = oh * ow

    return leaf_bool, leaf_area


# ── RF Feature Extraction ─────────────────────────────────────
def extract_rf_features(result, image_bgr, leaf_bool, leaf_area):
    """
    Extract the same feature set used during RF training:
      Total_Leaf_Area, Symptom_Count, Overlap_Area,
      Avg_R, Avg_G, Avg_B, Dominant_Symptom (one-hot).

    Returns a 1-D numpy array in the exact column order the RF expects.
    """
    oh, ow = image_bgr.shape[:2]
    names  = result.names

    # Per-class boolean masks aligned to the original image size
    class_masks = {c: np.zeros((oh, ow), dtype=bool) for c in RF_SYMPTOM_CLASSES}

    if result.masks is not None and len(result.masks) > 0:
        masks   = result.masks.data
        classes = result.boxes.cls.int()
        for i in range(len(classes)):
            cls = names[int(classes[i])]
            if cls not in class_masks:
                continue
            m = masks[i].cpu().numpy().astype(np.uint8)
            if m.shape != (oh, ow):
                m = cv2.resize(m, (ow, oh), interpolation=cv2.INTER_NEAREST)
            # Intersect with the leaf region so background doesn't inflate counts
            class_masks[cls] |= (m.astype(bool) & leaf_bool)

    # Overlap: pixels covered by more than one class
    stacked      = np.stack(list(class_masks.values()), axis=0)   # (n_classes, H, W)
    overlap_mask = stacked.sum(axis=0) > 1
    overlap_area = int(overlap_mask.sum())

    # Symptom count (classes with at least one detected pixel)
    areas        = {c: int(class_masks[c].sum()) for c in RF_SYMPTOM_CLASSES}
    symptom_count = sum(1 for c in RF_SYMPTOM_CLASSES if areas[c] > 0)

    # Dominant symptom (most pixels, or 'none')
    if symptom_count > 0:
        dominant = max(RF_SYMPTOM_CLASSES, key=lambda c: areas[c])
    else:
        dominant = 'none'

    # Average RGB inside the leaf region
    leaf_pixels = image_bgr[leaf_bool]          # shape (N, 3) in BGR
    if len(leaf_pixels) > 0:
        avg_b, avg_g, avg_r = leaf_pixels.mean(axis=0)
    else:
        avg_r = avg_g = avg_b = 0.0

    # ── Assemble feature vector ───────────────────────────────
    # Numeric features (must match NUMERIC_FEATURES order in training)
    numeric = [
        float(leaf_area),        # Total_Leaf_Area
        float(symptom_count),    # Symptom_Count
        float(overlap_area),     # Overlap_Area
        float(avg_r),            # Avg_R
        float(avg_g),            # Avg_G
        float(avg_b),            # Avg_B
    ]

    # One-hot for Dominant_Symptom (pandas get_dummies sorts columns alphabetically)
    # Possible values: 'gray-spot', 'none', 'yellowing'  →  sorted: same order
    possible_dominant = sorted(['gray-spot', 'none', 'yellowing'])
    dom_onehot = [1 if dominant == d else 0 for d in possible_dominant]
    # Column names: Dom_gray-spot, Dom_none, Dom_yellowing

    feature_vector = np.array(numeric + dom_onehot, dtype=np.float32)
    return feature_vector, dominant


# ── Severity via RF (primary) or threshold fallback ───────────
def predict_severity(feature_vector):
    """
    Use the Random Forest model to predict severity.
    Falls back to threshold-based logic if the model isn't available.
    """
    if _rf_model is not None and _rf_encoder is not None:
        pred_encoded = _rf_model.predict(feature_vector.reshape(1, -1))[0]
        severity_label = _rf_encoder.inverse_transform([pred_encoded])[0]
        # Capitalise to match RECOMMENDATIONS keys
        return severity_label.capitalize()
    return None   # caller will fall back


def get_severity_fallback(affected_pct):
    """Simple threshold fallback when RF model is unavailable."""
    if affected_pct > SEVERITY_THRESHOLDS["Severe"] * 100:
        return "Severe"
    elif affected_pct > SEVERITY_THRESHOLDS["Moderate"] * 100:
        return "Moderate"
    return "Mild"


# ── Annotation helpers ────────────────────────────────────────
def draw_centroid_labels(annotated, masks, classes, names, leaflet_pixels):
    """Draw class + percentage labels at each mask centroid."""
    for i in range(len(classes)):
        cls_name     = names[int(classes[i])]
        mask_np      = masks[i].cpu().numpy().astype(np.uint8)
        affected_pct = round(mask_np.sum() / leaflet_pixels * 100, 1)

        if affected_pct < 0.3:
            continue

        label_text = f"{cls_name} {affected_pct}%"
        M = cv2.moments(mask_np)
        if M["m00"] == 0:
            continue

        cx = int(M["m10"] / M["m00"])
        cy = int(M["m01"] / M["m00"])

        font       = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.52
        thickness  = 2
        color_bgr  = LABEL_COLOR_MAP_BGR.get(cls_name.lower().strip(), (255, 255, 255))

        (tw, th), baseline = cv2.getTextSize(label_text, font, font_scale, thickness)
        x1 = max(cx - tw // 2, 0)
        y1 = max(cy - th - baseline - 4, 0)
        x2 = min(x1 + tw + 6, annotated.shape[1])
        y2 = min(y1 + th + baseline + 6, annotated.shape[0])

        overlay = annotated.copy()
        cv2.rectangle(overlay, (x1, y1), (x2, y2), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.5, annotated, 0.5, 0, annotated)
        cv2.putText(
            annotated, label_text,
            (x1 + 3, y2 - baseline - 2),
            font, font_scale, color_bgr, thickness, cv2.LINE_AA,
        )

    return annotated


def save_with_boxes(result, save_path):
    """Full annotation — masks + bounding boxes + conf scores + labels."""
    annotated = result.plot(
        boxes=True, labels=True, conf=True,
        masks=True, line_width=2,
    )
    cv2.imwrite(save_path, annotated)


def save_without_boxes(result, save_path, leaflet_pixels):
    """Masks only with centroid labels — no bounding boxes."""
    annotated = result.plot(
        boxes=False, labels=False, conf=False,
        masks=True, line_width=2,
    )
    if result.masks is not None and len(result.masks) > 0:
        annotated = draw_centroid_labels(
            annotated,
            result.masks.data,
            result.boxes.cls.int(),
            result.names,
            leaflet_pixels,
        )
    cv2.imwrite(save_path, annotated)


def save_class_overlays(result, upload_dir, base_stem, leaf_bool, leaf_area):
    """
    Save one transparent RGBA PNG overlay per detected class.

    FIX: Masks are now:
      1. Resized to the original image resolution (INTER_LINEAR then thresholded)
         instead of INTER_NEAREST, which preserves soft mask edges.
      2. Intersected with the HSV leaf_bool mask so overlay pixels that fall
         outside the actual leaf region are suppressed — matching exactly what
         the feature extractor does.
      3. Morphologically closed (small kernel) to fill tiny holes inside the
         disease region caused by the resize step.

    Returns: { class_name: url_path }
    """
    if result.masks is None or len(result.masks) == 0:
        return {}

    masks   = result.masks.data        # float32 tensor, shape (N, H_mask, W_mask)
    classes = result.boxes.cls.int()
    names   = result.names
    oh, ow  = result.orig_img.shape[:2]

    # Small kernel for post-resize cleanup
    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

    # Group masks by class
    class_mask_map = {}
    for i in range(len(classes)):
        cls_name = names[int(classes[i])]
        if cls_name not in class_mask_map:
            class_mask_map[cls_name] = []
        class_mask_map[cls_name].append(masks[i])

    overlay_urls = {}

    for cls_name, mask_list in class_mask_map.items():
        canvas = np.zeros((oh, ow, 4), dtype=np.uint8)

        # --- Union across all instances of this class ---
        union_mask = torch.any(torch.stack(mask_list), dim=0)

        # --- FIX 1: Resize with bilinear then threshold ---
        # Using float→bilinear→threshold preserves soft mask edges far better
        # than INTER_NEAREST on low-resolution YOLO mask outputs.
        mask_float = union_mask.float().cpu().numpy()           # 0.0 – 1.0
        if mask_float.shape != (oh, ow):
            mask_float = cv2.resize(mask_float, (ow, oh),
                                    interpolation=cv2.INTER_LINEAR)
        mask_np = (mask_float >= 0.5).astype(np.uint8)         # crisp binary

        # --- FIX 2: Morphological close to fill resize artefact holes ---
        mask_np = cv2.morphologyEx(mask_np, cv2.MORPH_CLOSE, close_kernel)

        # --- FIX 3: Intersect with the HSV leaf mask ---
        # Suppresses overlay pixels that land on background/pot/soil/sky,
        # which is the same intersection used in feature extraction.
        mask_np = (mask_np.astype(bool) & leaf_bool).astype(np.uint8)

        safe_name = cls_name.lower().strip()
        rgba      = OVERLAY_COLOR_RGBA.get(safe_name, (100, 200, 100, 160))
        canvas[mask_np == 1] = rgba

        # Draw label at union centroid (using the cleaned mask)
        M = cv2.moments(mask_np)
        if M["m00"] > 0:
            cx  = int(M["m10"] / M["m00"])
            cy  = int(M["m01"] / M["m00"])
            pct = round(mask_np.sum() / max(leaf_area, 1) * 100, 1)
            lbl = f"{cls_name} {pct}%"

            font       = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.52
            thickness  = 2
            bgr        = LABEL_COLOR_MAP_BGR.get(safe_name, (255, 255, 255))

            (tw, th), baseline = cv2.getTextSize(lbl, font, font_scale, thickness)
            x1 = max(cx - tw // 2, 0)
            y1 = max(cy - th - baseline - 4, 0)
            x2 = min(x1 + tw + 6, ow)
            y2 = min(y1 + th + baseline + 6, oh)

            canvas[y1:y2, x1:x2] = (0, 0, 0, 180)
            cv2.putText(
                canvas, lbl,
                (x1 + 3, y2 - baseline - 2),
                font, font_scale,
                (bgr[0], bgr[1], bgr[2], 255),
                thickness, cv2.LINE_AA,
            )

        safe_filename    = cls_name.replace(" ", "_").replace("-", "_")
        overlay_filename = f"overlay_{safe_filename}_{base_stem}.png"
        overlay_filepath = os.path.join(upload_dir, overlay_filename)
        cv2.imwrite(overlay_filepath, canvas)
        overlay_urls[cls_name] = f"../uploads/{overlay_filename}"

    return overlay_urls


def compute_symptom_stats(masks, classes, names, leaf_bool, leaf_area):
    """
    Compute per-symptom affected area percentages using the actual
    leaf area (from HSV) rather than the full image pixel count.
    """
    oh, ow = leaf_bool.shape

    class_mask_map = {}
    for i in range(len(classes)):
        cls_name = names[int(classes[i])]
        if cls_name not in class_mask_map:
            class_mask_map[cls_name] = []
        class_mask_map[cls_name].append(masks[i])

    symptoms = []
    for cls_name, mask_list in class_mask_map.items():
        union_mask = torch.any(torch.stack(mask_list), dim=0)

        # FIX: Use same bilinear+threshold resize as save_class_overlays
        mask_float = union_mask.float().cpu().numpy()
        if mask_float.shape != (oh, ow):
            mask_float = cv2.resize(mask_float, (ow, oh),
                                    interpolation=cv2.INTER_LINEAR)
        mask_np = (mask_float >= 0.5).astype(np.uint8)

        # Intersect with leaf region before counting pixels
        leaf_masked   = mask_np.astype(bool) & leaf_bool
        affected_px   = int(leaf_masked.sum())
        affected_pct  = affected_px / max(leaf_area, 1)

        safe_name = cls_name.lower().strip()
        symptoms.append({
            "label":   cls_name,
            "percent": round(affected_pct * 100, 2),
            "count":   len(mask_list),
            "color":   COLOR_MAP.get(safe_name, "#33B82F"),
        })

    symptoms.sort(key=lambda x: x["percent"], reverse=True)
    return symptoms


# ── Main prediction entry point ───────────────────────────────
def run_prediction(image_path):
    try:
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Image not found: {image_path}")

        if _model is None:
            raise RuntimeError(f"YOLO model failed to load: {_model_error}")

        upload_dir = os.path.dirname(image_path)
        base_name  = os.path.basename(image_path)
        base_stem  = os.path.splitext(base_name)[0]

        boxes_filename   = f"analyzed_boxes_{base_name}"
        noboxes_filename = f"analyzed_noboxes_{base_name}"
        boxes_filepath   = os.path.join(upload_dir, boxes_filename)
        noboxes_filepath = os.path.join(upload_dir, noboxes_filename)

        # ── Step 1: YOLO inference ────────────────────────────
        results = _model.predict(
            source=image_path, conf=CONF_THRESH,
            save=False, verbose=False, show_boxes=False,
            device='cpu',
        )
        result = results[0]

        # ── Step 2: Dynamic HSV leaf area estimation ──────────
        image_bgr            = cv2.imread(image_path)
        leaf_bool, leaf_area = estimate_leaflet_area_dynamic(image_bgr)
        oh, ow               = image_bgr.shape[:2]

        # ── Step 3: Save annotated images ────────────────────
        save_with_boxes(result, boxes_filepath)
        save_without_boxes(result, noboxes_filepath, leaf_area)

        # ── Step 4: Healthy — no masks detected ──────────────
        if result.masks is None or len(result.masks) == 0:
            output = {
                "status":              "Healthy",
                "affected_area":       0.0,
                "symptoms":            [],
                "recommendations":     RECOMMENDATIONS["Healthy"],
                "image_with_boxes":    f"../uploads/{boxes_filename}",
                "image_without_boxes": f"../uploads/{noboxes_filename}",
                "class_overlays":      {},
                "severity_source":     "rf" if _rf_model else "fallback",
            }
            print(json.dumps(output))
            return

        masks   = result.masks.data
        classes = result.boxes.cls.int()
        names   = result.names

        # ── Step 5: Overall affected area (leaf-relative) ─────
        union_mask_torch = torch.any(masks, dim=0)
        union_float      = union_mask_torch.float().cpu().numpy()
        if union_float.shape != (oh, ow):
            union_float = cv2.resize(union_float, (ow, oh),
                                     interpolation=cv2.INTER_LINEAR)
        union_np            = (union_float >= 0.5).astype(np.uint8)
        overall_leaf_masked = union_np.astype(bool) & leaf_bool
        overall_pct         = overall_leaf_masked.sum() / max(leaf_area, 1) * 100

        # ── Step 6: Per-symptom stats (leaf-relative) ─────────
        symptoms = compute_symptom_stats(masks, classes, names, leaf_bool, leaf_area)

        # ── Step 7: RF severity prediction ───────────────────
        feature_vector, dominant_symptom = extract_rf_features(
            result, image_bgr, leaf_bool, leaf_area
        )
        severity = predict_severity(feature_vector)
        severity_source = "rf"

        if severity is None:
            severity = get_severity_fallback(overall_pct)
            severity_source = "fallback"

        severity = severity.strip().capitalize()
        if severity not in RECOMMENDATIONS:
            severity = "Mild"

        # ── Step 8: Class overlay PNGs (fixed quality) ────────
        # Now passes leaf_bool + leaf_area for proper intersection
        overlay_urls = save_class_overlays(
            result, upload_dir, base_stem, leaf_bool, leaf_area
        )

        output = {
            "status":              severity,
            "affected_area":       round(overall_pct, 2),
            "symptoms":            symptoms,
            "recommendations":     RECOMMENDATIONS[severity],
            "image_with_boxes":    f"../uploads/{boxes_filename}",
            "image_without_boxes": f"../uploads/{noboxes_filename}",
            "class_overlays":      overlay_urls,
            "severity_source":     severity_source,
            "leaf_area_px":        leaf_area,
            "dominant_symptom":    dominant_symptom,
        }

        print(json.dumps(output))

    except Exception as e:
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    if len(sys.argv) > 1:
        run_prediction(sys.argv[1])
    else:
        print(json.dumps({"error": "No image path provided."}))