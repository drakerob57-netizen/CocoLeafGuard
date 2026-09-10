import sys
import json
import time
import uuid
import torch
import os
import cv2
import joblib
import numpy as np
from ultralytics import YOLO

# ── Enable CUDA GPU acceleration ─────────────────────────────────────
# torch.cuda.is_available() will return True if CUDA is properly installed
torch.set_num_threads(1)                  # reduce CPU thread contention when using GPU

# ── Constants ─────────────────────────────────────────────────
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH   = os.path.join(SCRIPT_DIR, 'best_seed456.pt')
RF_MODEL_PATH   = os.path.join(SCRIPT_DIR, 'rf_severity_model.pkl')
RF_ENCODER_PATH = os.path.join(SCRIPT_DIR, 'rf_label_encoder.pkl')
UPLOAD_DIR    = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'uploads'))
CONF_THRESH  = 0.20
MIN_AREA_RATIO = 0.15
EDGE_MARGIN = 10
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Affected-area thresholds used when the RF model is unavailable.
# Values are fractions of the leaf area: <= 10% healthy, <= 30% mild,
# <= 61% moderate, <= 85% severe, and anything higher is critical.
SEVERITY_THRESHOLDS = {
    "Healthy":  0.10,
    "Mild":     0.30,
    "Moderate": 0.61,
    "Severe":   0.85,
}

COLOR_MAP = {
    "yellowing": "#28A745",
    "gray-spot": "#DC3545",
    "gray spot": "#DC3545",
    "leaf rot":  "#A52A2A",
    "leaf-rot":  "#A52A2A", 
}

# BGR format for OpenCV text
LABEL_COLOR_MAP_BGR = {
    "yellowing": (69, 167, 40),
    "gray-spot": (69, 53, 220),
    "gray spot": (69, 53, 220),
    "leaf rot":  (42, 42, 165),
    "leaf-rot":  (42, 42, 165),
}

# RGBA overlay colors per class for transparent PNG overlays
OVERLAY_COLOR_RGBA = {
    "yellowing": (40, 167, 69, 160),
    "gray-spot": (220, 53, 69, 160),
    "gray spot": (220, 53, 69, 160),
    "leaf rot":  (165, 42,  42,  160),
    "leaf-rot":  (165, 42,  42,  160),
}

CLASS_NAME_ALIASES = {
    "gray spot": "gray-spot",
    "gray spots": "gray-spot",
    "gray-spot": "gray-spot",
    "gray_spot": "gray-spot",
    "gray_spots": "gray-spot",
    "yellowing": "yellowing",
    "leaf rot": "leaf-rot",
    "leaf rots": "leaf-rot",
    "leaf-rot": "leaf-rot",
    "leaf_rot": "leaf-rot",
    "leaf_rots": "leaf-rot",
}


def canonical_class_name(class_name):
    """Return the site label key for a model class name."""
    safe_name = str(class_name).lower().strip().replace("_", " ")
    return CLASS_NAME_ALIASES.get(safe_name, safe_name)

RECOMMENDATIONS = {
    "Critical": [
        "Isolate affected palms immediately to prevent spread.",
        "Apply treatment and seek expert consultation.",
        "Increase monitoring frequency to every 3 days.",
        "Document affected fronds for disease progression tracking.",
    ],
    "Severe": [
        "Isolate affected palms immediately to prevent spread.",
        "Apply treatment.",
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

SYMPTOM_RECOMMENDATIONS = {
    "gray-spot": [
        "Remove and dispose of heavily spotted leaves away from healthy palms.",
        "Improve airflow by avoiding overcrowding and keep foliage dry when watering.",
        "Inspect nearby palms regularly for new gray spot lesions.",
    ],
    "yellowing": [
        "Check soil drainage and moisture, since water stress can worsen yellowing.",
        "Review palm nutrition, especially nitrogen, magnesium, and potassium levels.",
        "Inspect roots and surrounding plants for signs of stress or disease.",
    ],
    "leaf-rot": [
        "Remove severely rotted tissue with sanitized tools and dispose of it safely.",
        "Reduce excess moisture and improve drainage around the palm.",
        "Seek expert advice about an appropriate treatment if rot continues to spread.",
    ],
}


def build_recommendations(symptoms, severity):
    """Combine tailored guidance for every detected symptom with urgency advice."""
    recommendations = []
    for symptom in symptoms:
        symptom_key = canonical_class_name(symptom["label"])
        for recommendation in SYMPTOM_RECOMMENDATIONS.get(symptom_key, []):
            if recommendation not in recommendations:
                recommendations.append(recommendation)

    urgency_guidance = RECOMMENDATIONS.get(severity, RECOMMENDATIONS["Healthy"])
    for recommendation in urgency_guidance:
        if recommendation not in recommendations:
            recommendations.append(recommendation)

    return recommendations

# Canonical symptom classes expected by the RF model
RF_SYMPTOM_CLASSES = ['gray-spot', 'yellowing']

# ── Model loading — once at module level ─────────────────────
try:
    _model = YOLO(MODEL_PATH)
    _model.to('cpu')   # use GPU for inference
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
        ((h >= 20) & (h <= 95) & (s >= 35) & (v >= 35)) |
        ((h >= 18) & (h <= 42) & (s >= 50) & (v >= 35))
    )

    if broad.sum() > 50:
        h_min = max(0,   int(np.percentile(h[broad],  5)) - 5)
        h_max = min(179, int(np.percentile(h[broad], 95)) + 5)
        s_min = max(0,   int(np.percentile(s[broad],  5)) - 10)
        s_max = min(255, int(np.percentile(s[broad], 95)) + 10)
        v_min = max(0,   int(np.percentile(v[broad],  5)) - 10)
        v_max = min(255, int(np.percentile(v[broad], 95)) + 10)
    else:
        h_min, h_max = 20, 95
        s_min, s_max = 35, 255
        v_min, v_max = 35, 255

    h_min = max(h_min, 18)
    h_max = min(h_max, 95)
    s_min = max(s_min, 35)
    v_min = max(v_min, 35)
    lower = np.array([h_min, s_min, v_min], dtype=np.uint8)
    upper = np.array([h_max, s_max, v_max], dtype=np.uint8)
    mask  = cv2.inRange(hsv, lower, upper)

    # Morphological cleanup
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    mask   = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask   = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  kernel)

    # Prefer the green component closest to the camera-centered main frond.
    # Area remains part of the score so tiny green background fragments lose.
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if n > 1:
        image_center = np.array([ow / 2, oh / 2], dtype=np.float32)
        max_distance = float(np.linalg.norm(image_center))
        center_window = np.zeros((oh, ow), dtype=bool)
        x_start, x_end = int(ow * 0.2), int(ow * 0.8)
        y_start, y_end = int(oh * 0.2), int(oh * 0.8)
        center_window[y_start:y_end, x_start:x_end] = True

        component_scores = []
        for component_id in range(1, n):
            component = labels == component_id
            area_ratio = stats[component_id, cv2.CC_STAT_AREA] / (oh * ow)
            y_coords, x_coords = np.nonzero(component)
            centroid = np.array([x_coords.mean(), y_coords.mean()])
            center_score = 1.0 - min(
                float(np.linalg.norm(centroid - image_center)) / max_distance,
                1.0,
            )
            central_coverage = float((component & center_window).sum()) / max(
                int(component.sum()), 1
            )
            score = (
                0.35 * center_score
                + 0.15 * min(area_ratio / 0.15, 1.0)
                + 0.50 * central_coverage
            )
            component_scores.append((score, component_id))

        selected_component = max(component_scores)[1]
        mask = (labels == selected_component).astype(np.uint8) * 255

        # Limit the selected component to the camera-centered focus ellipse so
        # connected background fronds at the frame edges cannot become part of
        # the primary leaf region.
        y_grid, x_grid = np.ogrid[:oh, :ow]
        normalized_distance = (
            ((x_grid - ow / 2) / (ow * 0.48)) ** 2
            + ((y_grid - oh / 2) / (oh * 0.48)) ** 2
        )
        mask[normalized_distance > 1.0] = 0

    leaf_bool = mask > 0
    leaf_area = int(leaf_bool.sum())

    # Fall back to full image if leaf area is implausibly small
    if leaf_area < oh * ow * 0.05:
        leaf_bool = np.ones((oh, ow), dtype=bool)
        leaf_area = oh * ow

    return leaf_bool, leaf_area


def compute_mask_area(mask):
    """Return the number of foreground pixels in a binary mask."""
    return int(np.asarray(mask, dtype=bool).sum())


def compute_centroid(mask):
    """Return the (x, y) centroid of foreground pixels in a binary mask."""
    y_coords, x_coords = np.nonzero(np.asarray(mask, dtype=bool))
    if len(x_coords) == 0:
        return 0.0, 0.0
    return float(x_coords.mean()), float(y_coords.mean())


def is_partially_clipped(box, width, height):
    """Return whether a bounding box touches the configured image margin."""
    x_min, y_min, x_max, y_max = [float(value) for value in box]
    return (
        x_min < EDGE_MARGIN
        or y_min < EDGE_MARGIN
        or x_max > width - EDGE_MARGIN
        or y_max > height - EDGE_MARGIN
    )


def select_primary_leaf(masks, boxes, width, height):
    """Filter masks and select the valid mask closest to the image center."""
    image_area = width * height
    image_center = (width / 2, height / 2)
    valid_leaves = []
    small_area_count = 0
    partially_clipped_count = 0

    for index, (mask, box) in enumerate(zip(masks, boxes)):
        area_pixels = compute_mask_area(mask)
        area_ratio = area_pixels / image_area
        if area_ratio < MIN_AREA_RATIO:
            small_area_count += 1
            continue

        clipped = is_partially_clipped(box, width, height)
        if clipped:
            partially_clipped_count += 1

        centroid = compute_centroid(mask)
        distance = float(np.linalg.norm(
            np.subtract(centroid, image_center)
        ))
        valid_leaves.append({
            "index": index,
            "centroid": centroid,
            "area_pixels": area_pixels,
            "area_ratio": area_ratio,
            "distance_from_center": distance,
            "partially_clipped": clipped,
        })

    selectable_leaves = [
        leaf for leaf in valid_leaves if not leaf["partially_clipped"]
    ]
    selected_leaf = min(
        selectable_leaves,
        key=lambda leaf: leaf["distance_from_center"],
        default=None,
    )
    return selected_leaf, valid_leaves, small_area_count, partially_clipped_count


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
    affected_fraction = affected_pct / 100
    if affected_fraction > SEVERITY_THRESHOLDS["Severe"]:
        return "Critical"
    if affected_fraction > SEVERITY_THRESHOLDS["Moderate"]:
        return "Severe"
    if affected_fraction > SEVERITY_THRESHOLDS["Mild"]:
        return "Moderate"
    if affected_fraction > SEVERITY_THRESHOLDS["Healthy"]:
        return "Mild"
    return "Healthy"


# ── Annotation helpers ────────────────────────────────────────
def draw_centroid_labels(annotated, masks, classes, names, leaflet_pixels):
    """Draw class + percentage labels at each mask centroid."""
    for i in range(len(classes)):
        cls_name     = names[int(classes[i])]
        mask_np      = masks[i].cpu().numpy().astype(np.float32)
        if mask_np.shape != annotated.shape[:2]:
            mask_np = cv2.resize(mask_np, (annotated.shape[1], annotated.shape[0]), interpolation=cv2.INTER_LINEAR)
        mask_np = (mask_np >= 0.5).astype(np.uint8)
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
        color_bgr  = LABEL_COLOR_MAP_BGR.get(canonical_class_name(cls_name), (255, 255, 255))

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
        masks=False, line_width=2,
    )
    if result.masks is not None and len(result.masks) > 0:
        mask_overlay = annotated.copy()
        for i in range(len(result.masks.data)):
            mask_np = result.masks.data[i].cpu().numpy().astype(np.float32)
            if mask_np.shape != annotated.shape[:2]:
                mask_np = cv2.resize(mask_np, (annotated.shape[1], annotated.shape[0]), interpolation=cv2.INTER_LINEAR)
            cls_name = result.names[int(result.boxes.cls[i])]
            color_bgr = LABEL_COLOR_MAP_BGR.get(canonical_class_name(cls_name), (100, 200, 100))
            mask_overlay[mask_np >= 0.5] = color_bgr
        annotated = cv2.addWeighted(mask_overlay, 0.45, annotated, 0.55, 0)

    # Draw labels after the mask overlay so confidence text cannot be hidden.
    for index, box in enumerate(result.boxes.xyxy.cpu().numpy()):
        x_min, y_min, x_max, y_max = [int(value) for value in box]
        cls_id = int(result.boxes.cls[index])
        cls_name = result.names[cls_id]
        confidence = float(result.boxes.conf[index])
        label = f"{cls_name} {confidence:.2f}"
        color_bgr = LABEL_COLOR_MAP_BGR.get(canonical_class_name(cls_name), (255, 255, 255))
        cv2.rectangle(annotated, (x_min, y_min), (x_max, y_max), color_bgr, 2)
        (text_width, text_height), baseline = cv2.getTextSize(
            label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2
        )
        text_y = max(y_min, text_height + baseline + 4)
        cv2.rectangle(
            annotated,
            (x_min, text_y - text_height - baseline - 4),
            (min(x_min + text_width + 8, annotated.shape[1]), text_y),
            (0, 0, 0),
            -1,
        )
        cv2.putText(
            annotated, label, (x_min + 4, text_y - baseline - 2),
            cv2.FONT_HERSHEY_SIMPLEX, 0.55, color_bgr, 2, cv2.LINE_AA,
        )
    cv2.imwrite(save_path, annotated)


def save_without_boxes(result, save_path, leaflet_pixels):
    """Masks only with centroid labels — no bounding boxes."""
    annotated = result.orig_img.copy()
    if result.masks is not None and len(result.masks) > 0:
        mask_overlay = annotated.copy()
        for i in range(len(result.masks.data)):
            mask_np = result.masks.data[i].cpu().numpy().astype(np.float32)
            if mask_np.shape != annotated.shape[:2]:
                mask_np = cv2.resize(mask_np, (annotated.shape[1], annotated.shape[0]), interpolation=cv2.INTER_LINEAR)
            mask_np = mask_np >= 0.5
            cls_name = result.names[int(result.boxes.cls[i])]
            color_bgr = LABEL_COLOR_MAP_BGR.get(canonical_class_name(cls_name), (100, 200, 100))
            mask_overlay[mask_np] = color_bgr
        mask_pixels = result.masks.data
        annotated = np.where(
            np.any(np.stack([
                cv2.resize(mask.cpu().numpy().astype(np.float32), (annotated.shape[1], annotated.shape[0]), interpolation=cv2.INTER_LINEAR) >= 0.5
                for mask in mask_pixels
            ]), axis=0)[..., None],
            (mask_overlay * 0.45 + annotated * 0.55).astype(np.uint8),
            annotated,
        )
        annotated = draw_centroid_labels(
            annotated,
            result.masks.data,
            result.boxes.cls.int(),
            result.names,
            leaflet_pixels,
        )
    cv2.imwrite(save_path, annotated)


def save_hsv_leaf_debug(image_bgr, leaf_bool, save_path):
    """Save the HSV-selected leaf region as a visible diagnostic image."""
    highlighted = image_bgr.copy()
    green_overlay = np.zeros_like(image_bgr)
    green_overlay[:] = (40, 180, 40)
    highlighted[leaf_bool] = cv2.addWeighted(
        image_bgr[leaf_bool], 0.45, green_overlay[leaf_bool], 0.55, 0
    )
    contours, _ = cv2.findContours(
        leaf_bool.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    cv2.drawContours(highlighted, contours, -1, (0, 255, 0), 3)
    cv2.putText(
        highlighted, "HSV selected leaf", (20, 35),
        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2, cv2.LINE_AA,
    )
    cv2.imwrite(save_path, highlighted)


def save_yolo_raw_debug(result, save_path):
    """Save raw YOLO masks and boxes before HSV overlap filtering."""
    if result.masks is None or len(result.masks) == 0:
        annotated = result.orig_img.copy()
        cv2.putText(
            annotated, "YOLO: no masks", (20, 35),
            cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2, cv2.LINE_AA,
        )
        cv2.imwrite(save_path, annotated)
        return

    annotated = result.plot(boxes=True, labels=True, conf=True, masks=False)
    mask_overlay = annotated.copy()
    oh, ow = annotated.shape[:2]
    for index, raw_mask in enumerate(result.masks.data):
        mask_float = raw_mask.float().cpu().numpy()
        if mask_float.shape != (oh, ow):
            mask_float = cv2.resize(mask_float, (ow, oh), interpolation=cv2.INTER_LINEAR)
        cls_name = result.names[int(result.boxes.cls[index])]
        color_bgr = LABEL_COLOR_MAP_BGR.get(canonical_class_name(cls_name), (255, 255, 0))
        mask_overlay[mask_float >= 0.5] = color_bgr
    annotated = cv2.addWeighted(mask_overlay, 0.45, annotated, 0.55, 0)
    cv2.putText(
        annotated, "YOLO raw detections", (20, 35),
        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 0), 2, cv2.LINE_AA,
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

        safe_name = canonical_class_name(cls_name)
        rgba      = OVERLAY_COLOR_RGBA.get(safe_name, (100, 200, 100, 160))
        canvas[mask_np == 1] = rgba

        safe_filename    = cls_name.replace(" ", "_").replace("-", "_")
        overlay_filename = f"overlay_{safe_filename}_{base_stem}.png"
        overlay_filepath = os.path.join(upload_dir, overlay_filename)
        cv2.imwrite(overlay_filepath, cv2.cvtColor(canvas, cv2.COLOR_RGBA2BGRA))
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

        safe_name = canonical_class_name(cls_name)
        symptoms.append({
            "label":   cls_name,
            "percent": round(affected_pct * 100, 2),
            "count":   len(mask_list),
            "color":   COLOR_MAP.get(safe_name, "#33B82F"),
        })

    symptoms.sort(key=lambda x: x["percent"], reverse=True)
    return symptoms


def _decode_image_bytes(image_bytes):
    image_array = np.frombuffer(image_bytes, dtype=np.uint8)
    image_bgr = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if image_bgr is None:
        raise ValueError("Could not decode image bytes")
    return image_bgr


def _run_prediction(image_bgr, upload_dir, base_stem):
    if _model is None:
        raise RuntimeError(f"YOLO model failed to load: {_model_error}")

    os.makedirs(upload_dir, exist_ok=True)
    boxes_filename   = f"analyzed_boxes_{base_stem}.png"
    noboxes_filename = f"analyzed_noboxes_{base_stem}.png"
    hsv_filename     = f"debug_hsv_leaf_{base_stem}.png"
    yolo_raw_filename = f"debug_yolo_raw_{base_stem}.png"
    boxes_filepath   = os.path.join(upload_dir, boxes_filename)
    noboxes_filepath = os.path.join(upload_dir, noboxes_filename)
    oh, ow = image_bgr.shape[:2]

    results = _model.predict(
        source=image_bgr, conf=CONF_THRESH,
        save=False, verbose=False, show_boxes=False,
        retina_masks=True,
        device='cpu',
    )
    result = results[0]

    leaf_bool, leaf_area = estimate_leaflet_area_dynamic(image_bgr)
    save_with_boxes(result, boxes_filepath)
    save_without_boxes(result, noboxes_filepath, leaf_area)
    save_hsv_leaf_debug(image_bgr, leaf_bool, os.path.join(upload_dir, hsv_filename))
    save_yolo_raw_debug(result, os.path.join(upload_dir, yolo_raw_filename))
    debug_images = {
        "hsv_leaf_mask": f"../uploads/{hsv_filename}",
        "yolo_raw_detections": f"../uploads/{yolo_raw_filename}",
    }

    empty_filter_metadata = {
        "selected_leaf": None,
        "discarded_masks": {
            "small_area": 0,
            "partially_clipped": 0,
        },
    }

    if result.masks is None or len(result.masks) == 0:
        return {
            "status":              "Healthy",
            "affected_area":       0.0,
            "leaf_area_px":        leaf_area,
            "symptoms":            [],
            "recommendations":     [],
            "image_with_boxes":    f"../uploads/{boxes_filename}",
            "image_without_boxes": f"../uploads/{noboxes_filename}",
            "class_overlays":      {},
            "severity_source":     "rf" if _rf_model else "fallback",
            "detections":          [],
            "class_avg_confidence": {},
            "debug_images":        debug_images,
            **empty_filter_metadata,
        }

    # Select the camera-centered HSV leaf region. YOLO masks represent disease
    # areas, so their size must not be used as a whole-leaf validity filter.
    leaf_y, leaf_x = np.nonzero(leaf_bool)
    if len(leaf_x) == 0:
        return {
            "status":              "no_valid_leaf_detected",
            "affected_area":       0.0,
            "leaf_area_px":        0,
            "symptoms":            [],
            "recommendations":     [],
            "image_with_boxes":    f"../uploads/{boxes_filename}",
            "image_without_boxes": f"../uploads/{noboxes_filename}",
            "class_overlays":      {},
            "severity_source":     None,
            "detections":          [],
            "class_avg_confidence": {},
            "debug_images":        debug_images,
            **empty_filter_metadata,
        }

    leaf_centroid = compute_centroid(leaf_bool)
    leaf_distance = float(np.linalg.norm(
        np.subtract(leaf_centroid, (ow / 2, oh / 2))
    ))
    filter_metadata = {
        "selected_leaf": {
            "centroid": [leaf_centroid[0], leaf_centroid[1]],
            "area_pixels": leaf_area,
            "area_ratio": leaf_area / (ow * oh),
            "distance_from_center": leaf_distance,
        },
        "discarded_masks": {
            "small_area": 0,
            "partially_clipped": 0,
        },
    }

    # Keep every disease mask, including small affected areas, but discard
    # masks belonging to background fronds outside the selected leaf. The
    # association region is dilated so red/brown lesions excluded by HSV can
    # still be attributed to the nearby green leaf pixels.
    raw_masks = result.masks.data
    image_masks = []
    for raw_mask in raw_masks:
        mask_float = raw_mask.float().cpu().numpy()
        if mask_float.shape != (oh, ow):
            mask_float = cv2.resize(
                mask_float, (ow, oh), interpolation=cv2.INTER_LINEAR
            )
        image_masks.append(mask_float >= 0.5)

    raw_boxes = result.boxes.xyxy.cpu().numpy()
    association_region = cv2.dilate(
        leaf_bool.astype(np.uint8),
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)),
    ).astype(bool)
    analysis_region = association_region
    selected_indices = []
    partially_clipped_count = 0
    for index, mask in enumerate(image_masks):
        clipped = is_partially_clipped(raw_boxes[index], ow, oh)
        if clipped:
            partially_clipped_count += 1
        x_min, y_min, x_max, y_max = raw_boxes[index]
        box_center_x = int(np.clip((x_min + x_max) / 2, 0, ow - 1))
        box_center_y = int(np.clip((y_min + y_max) / 2, 0, oh - 1))
        near_selected_leaf = (
            association_region[box_center_y, box_center_x]
            or np.any(mask & association_region)
        )
        if near_selected_leaf and not clipped:
            selected_indices.append(index)
    filter_metadata["discarded_masks"]["partially_clipped"] = partially_clipped_count
    if not selected_indices:
        return {
            "status":              "Healthy",
            "affected_area":       0.0,
            "leaf_area_px":        leaf_area,
            "symptoms":            [],
            "recommendations":     RECOMMENDATIONS["Healthy"],
            "image_with_boxes":    f"../uploads/{boxes_filename}",
            "image_without_boxes": f"../uploads/{noboxes_filename}",
            "class_overlays":      {},
            "severity_source":     "fallback",
            "detections":          [],
            "class_avg_confidence": {},
            "debug_images":        debug_images,
            **filter_metadata,
        }

    # Only disease masks belonging to the selected leaf reach analysis.
    result = result[selected_indices]
    masks   = result.masks.data
    classes = result.boxes.cls.int()
    names   = result.names

    union_mask_torch = torch.any(masks, dim=0)
    union_float      = union_mask_torch.float().cpu().numpy()
    if union_float.shape != (oh, ow):
        union_float = cv2.resize(union_float, (ow, oh), interpolation=cv2.INTER_LINEAR)
    union_np            = (union_float >= 0.5).astype(np.uint8)
    overall_leaf_masked = union_np.astype(bool) & analysis_region
    overall_pct         = overall_leaf_masked.sum() / max(leaf_area, 1) * 100

    symptoms = compute_symptom_stats(masks, classes, names, analysis_region, leaf_area)

    feature_vector, dominant_symptom = extract_rf_features(
        result, image_bgr, analysis_region, int(analysis_region.sum())
    )
    severity = predict_severity(feature_vector)
    severity_source = "rf"

    if severity is None:
        severity = get_severity_fallback(overall_pct)
        severity_source = "fallback"

    severity = severity.strip().capitalize()
    if severity not in RECOMMENDATIONS:
        severity = "Mild"

    recommendations = build_recommendations(symptoms, severity)

    raw_confs   = result.boxes.conf.cpu().numpy().tolist()
    raw_cls_ids = result.boxes.cls.int().cpu().numpy().tolist()
    detections_data = [
        {"class": names[int(c)], "confidence": round(float(cf), 4)}
        for c, cf in zip(raw_cls_ids, raw_confs)
    ]

    _class_conf_map = {}
    for d in detections_data:
        _class_conf_map.setdefault(d["class"], []).append(d["confidence"])

    class_avg_confidence = {
        cls: round(sum(v) / len(v), 4)
        for cls, v in _class_conf_map.items()
    }

    overlay_urls = save_class_overlays(
        result, upload_dir, base_stem, analysis_region, int(analysis_region.sum())
    )

    return {
        "status":              severity,
        "affected_area":       round(overall_pct, 2),
        "symptoms":            symptoms,
        "recommendations":     recommendations,
        "image_with_boxes":    f"../uploads/{boxes_filename}",
        "image_without_boxes": f"../uploads/{noboxes_filename}",
        "class_overlays":      overlay_urls,
        "severity_source":     severity_source,
        "leaf_area_px":        leaf_area,
        "dominant_symptom":    dominant_symptom,
        "detections":          detections_data,
        "class_avg_confidence": class_avg_confidence,
        "debug_images":        debug_images,
        **filter_metadata,
    }


def run_prediction(image_path):
    try:
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Image not found: {image_path}")

        image_bgr = cv2.imread(image_path)
        if image_bgr is None:
            raise FileNotFoundError(f"Unable to read image: {image_path}")

        upload_dir = os.path.dirname(image_path)
        base_stem  = os.path.splitext(os.path.basename(image_path))[0]
        return _run_prediction(image_bgr, upload_dir, base_stem)

    except Exception as e:
        return {"error": str(e)}


def run_prediction_from_bytes(image_bytes, upload_dir=None, base_stem=None):
    try:
        image_bgr = _decode_image_bytes(image_bytes)
        if upload_dir is None:
            upload_dir = UPLOAD_DIR
        if base_stem is None:
            base_stem = f"frame_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        return _run_prediction(image_bgr, upload_dir, base_stem)

    except Exception as e:
        return {"error": str(e)}


if __name__ == "__main__":
    if len(sys.argv) > 1:
        result = run_prediction(sys.argv[1])
        print(json.dumps(result))
    else:
        print(json.dumps({"error": "No image path provided."}))