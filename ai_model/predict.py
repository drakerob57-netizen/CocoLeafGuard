import sys
import json
import torch
import os
import cv2
import numpy as np
from ultralytics import YOLO

# ── Constants ────────────────────────────────────────────────
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH  = os.path.join(SCRIPT_DIR, 'best_seed789.pt')
CONF_THRESH = 0.25

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

# ── Model loading — once at module level ─────────────────────
try:
    _model = YOLO(MODEL_PATH)
except Exception as e:
    _model = None
    _model_error = str(e)


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


def save_class_overlays(result, upload_dir, base_stem, leaflet_pixels):
    """
    Save one transparent RGBA PNG overlay per detected class.
    Client-side JS composites these onto the original for filtering.
    Returns: { class_name: url_path }
    """
    if result.masks is None or len(result.masks) == 0:
        return {}

    masks   = result.masks.data
    classes = result.boxes.cls.int()
    names   = result.names
    _, H, W = masks.shape

    oh, ow = result.orig_img.shape[:2]

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

        union_mask = torch.any(torch.stack(mask_list), dim=0)
        mask_np    = union_mask.cpu().numpy().astype(np.uint8)

        if mask_np.shape != (oh, ow):
            mask_np = cv2.resize(mask_np, (ow, oh), interpolation=cv2.INTER_NEAREST)

        safe_name = cls_name.lower().strip()
        rgba      = OVERLAY_COLOR_RGBA.get(safe_name, (100, 200, 100, 160))
        canvas[mask_np == 1] = rgba

        # Draw label at union centroid
        M = cv2.moments(mask_np)
        if M["m00"] > 0:
            cx  = int(M["m10"] / M["m00"])
            cy  = int(M["m01"] / M["m00"])
            pct = round(mask_np.sum() / (oh * ow) * 100, 1)
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


def compute_symptom_stats(masks, classes, names, leaflet_pixels):
    class_mask_map = {}
    for i in range(len(classes)):
        cls_name = names[int(classes[i])]
        if cls_name not in class_mask_map:
            class_mask_map[cls_name] = []
        class_mask_map[cls_name].append(masks[i])

    symptoms = []
    for cls_name, mask_list in class_mask_map.items():
        union_mask   = torch.any(torch.stack(mask_list), dim=0)
        affected_px  = union_mask.sum().item()
        affected_pct = affected_px / leaflet_pixels
        safe_name    = cls_name.lower().strip()

        symptoms.append({
            "label":   cls_name,
            "percent": round(affected_pct * 100, 2),
            "count":   len(mask_list),
            "color":   COLOR_MAP.get(safe_name, "#33B82F"),
        })

    symptoms.sort(key=lambda x: x["percent"], reverse=True)
    return symptoms


def get_severity(affected_pct):
    if affected_pct > SEVERITY_THRESHOLDS["Severe"]:
        return "Severe"
    elif affected_pct > SEVERITY_THRESHOLDS["Moderate"]:
        return "Moderate"
    return "Mild"


def run_prediction(image_path):
    try:
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Image not found: {image_path}")

        if _model is None:
            raise RuntimeError(f"Model failed to load: {_model_error}")

        upload_dir = os.path.dirname(image_path)
        base_name  = os.path.basename(image_path)
        base_stem  = os.path.splitext(base_name)[0]

        boxes_filename   = f"analyzed_boxes_{base_name}"
        noboxes_filename = f"analyzed_noboxes_{base_name}"
        boxes_filepath   = os.path.join(upload_dir, boxes_filename)
        noboxes_filepath = os.path.join(upload_dir, noboxes_filename)

        results = _model.predict(
            source=image_path, conf=CONF_THRESH,
            save=False, verbose=False, show_boxes=False,
        )
        result = results[0]

        oh, ow         = result.orig_img.shape[:2]
        leaflet_pixels = oh * ow

        save_with_boxes(result, boxes_filepath)
        save_without_boxes(result, noboxes_filepath, leaflet_pixels)

        if result.masks is None or len(result.masks) == 0:
            output = {
                "status":              "Healthy",
                "affected_area":       0.0,
                "symptoms":            [],
                "recommendations":     RECOMMENDATIONS["Healthy"],
                "image_with_boxes":    f"../uploads/{boxes_filename}",
                "image_without_boxes": f"../uploads/{noboxes_filename}",
                "class_overlays":      {},
            }
            print(json.dumps(output))
            return

        masks   = result.masks.data
        classes = result.boxes.cls.int()
        names   = result.names
        _, H, W = masks.shape

        mask_pixels   = H * W
        overall_union = torch.any(masks, dim=0)
        overall_pct   = overall_union.sum().item() / mask_pixels

        symptoms     = compute_symptom_stats(masks, classes, names, mask_pixels)
        severity     = get_severity(overall_pct)
        overlay_urls = save_class_overlays(result, upload_dir, base_stem, mask_pixels)

        output = {
            "status":              severity,
            "affected_area":       round(overall_pct * 100, 2),
            "symptoms":            symptoms,
            "recommendations":     RECOMMENDATIONS[severity],
            "image_with_boxes":    f"../uploads/{boxes_filename}",
            "image_without_boxes": f"../uploads/{noboxes_filename}",
            "class_overlays":      overlay_urls,
        }

        print(json.dumps(output))

    except Exception as e:
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    if len(sys.argv) > 1:
        run_prediction(sys.argv[1])
    else:
        print(json.dumps({"error": "No image path provided."}))