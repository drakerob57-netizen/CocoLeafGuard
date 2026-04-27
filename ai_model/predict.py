import sys
import json
import torch
import os
import logging
from ultralytics import YOLO

# Set up logging to track progress in real-time
# This file will be created in your project root
log_path = os.path.join(os.path.dirname(__file__), '..', 'ai_log.txt')
logging.basicConfig(filename=log_path, level=logging.INFO, 
                    format='%(asctime)s - %(message)s')

def run_prediction(image_path):
    logging.info(f"--- Analysis started for: {image_path} ---")
    
    try:
        # Get absolute path to the model file
        script_dir = os.path.dirname(os.path.abspath(__file__))
        
        # Using yolov8m-seg.pt as specified
        model_name = 'yolov8m-seg.pt' 
        model_path = os.path.join(script_dir, model_name)
        
        if not os.path.exists(model_path):
            logging.info(f"Model file not found at {model_path}. YOLO will attempt to download it.")
        
        logging.info("Loading model into memory...")
        model = YOLO(model_path)
        
        logging.info("Running inference...")
        results = model.predict(source=image_path, conf=0.25, save=False)
        result = results[0]

        # 1. Handle healthy/no-detection case
        if result.masks is None:
            logging.info("No detections found.")
            output = {
                "status": "Healthy",
                "affected_area": 0.0,
                "symptoms": [],
                "recommendations": ["Continue standard care and monitoring."]
            }
            print(json.dumps(output))
            return

        # --- RE-INDENTED CONTENT STARTS HERE ---
        
        # Extract tensors and classification data
        masks = result.masks.data # Tensor of shape (N, H, W)
        classes = result.boxes.cls.int() # Class IDs for each detection
        names = result.names # Dict mapping ID to class name

        # --- PART 1: SEVERITY LOGIC ---
        
        # Proxy for leaflet area (H * W)
        _, H, W = masks.shape
        leaflet_area_pixels = H * W  

        # Apply Boolean OR logic across all masks (union) to prevent double-counting overlaps
        overall_union_mask = torch.any(masks, dim=0)
        total_affected_pixels = overall_union_mask.sum().item()
        
        # Calculate total severity percentage
        overall_affected_pct = total_affected_pixels / leaflet_area_pixels

        # --- PART 2: SYMPTOM DISTRIBUTION & COUNTS ---
        
        symptom_stats = {}
        
        # Group masks and count occurrences by class
        for i in range(len(classes)):
            class_name = names[int(classes[i])]
            
            if class_name not in symptom_stats:
                symptom_stats[class_name] = {
                    "count": 0,
                    "mask_list": []
                }
            
            symptom_stats[class_name]["count"] += 1
            symptom_stats[class_name]["mask_list"].append(masks[i])

        symptoms_output = []
        
        color_map = {
            "Yellowing": "#FFC107",
            "Gray Spots": "#6C757D",
            "Leaf Rots": "#A52A2A"
        }

        for class_name, data in symptom_stats.items():
            # Apply Boolean OR logic for overlaps WITHIN the same class
            class_masks_tensor = torch.stack(data["mask_list"])
            class_union_mask = torch.any(class_masks_tensor, dim=0)
            class_affected_pixels = class_union_mask.sum().item()
            
            class_pct = class_affected_pixels / leaflet_area_pixels
            
            symptoms_output.append({
                "label": class_name,
                "percent": round(class_pct * 100, 1),
                "count": data["count"],
                "color": color_map.get(class_name, "#33B82F")
            })

        # --- PART 3: STATUS THRESHOLDS ---
        if overall_affected_pct > 0.50:
            status_label = "Severe"
            recs = ["Isolate affected plants immediately", "Remove severely infected leaves", "Consult specialist"]
        elif overall_affected_pct > 0.15:
            status_label = "Moderate"
            recs = ["Apply targeted fungicide", "Monitor spread daily"]
        else:
            status_label = "Mild"
            recs = ["Ensure proper watering and drainage", "Apply preventative treatments"]

        output = {
            "status": status_label,
            "affected_area": round(overall_affected_pct * 100, 1),
            "symptoms": symptoms_output,
            "recommendations": recs
        }

        logging.info("Analysis successful. Returning results.")
        print(json.dumps(output))

    except Exception as e:
        logging.error(f"Error during analysis: {str(e)}")
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        run_prediction(sys.argv[1])