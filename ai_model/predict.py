import sys
import json
import torch
import os
from ultralytics import YOLO

def run_prediction(image_path):
    try:
        # Use absolute paths so PHP never gets confused
        script_dir = os.path.dirname(os.path.abspath(__file__))
        
        # 1. POINT TO YOUR RENAMED FILE
        model_path = os.path.join(script_dir, 'best.pt')
        
        # 2. Load the model
        model = YOLO(model_path)
        
        # 3. Run inference - verbose=False stops the download bar from breaking PHP
        results = model.predict(source=image_path, conf=0.25, save=False, verbose=False)
        result = results[0]

        if result.masks is None:
            print(json.dumps({"status": "Healthy", "affected_area": 0.0, "symptoms": [], "recommendations": ["Continue standard care."]}))
            return

        # --- SEVERITY & SYMPTOM LOGIC ---
        masks = result.masks.data
        classes = result.boxes.cls.int()
        names = result.names
        _, H, W = masks.shape
        leaflet_area_pixels = H * W

        # Area calculation using Boolean OR (union)
        overall_union_mask = torch.any(masks, dim=0)
        total_affected_pixels = overall_union_mask.sum().item()
        overall_affected_pct = total_affected_pixels / leaflet_area_pixels

        symptom_stats = {}
        for i in range(len(classes)):
            class_name = names[int(classes[i])]
            if class_name not in symptom_stats:
                symptom_stats[class_name] = {"count": 0, "mask_list": []}
            symptom_stats[class_name]["count"] += 1
            symptom_stats[class_name]["mask_list"].append(masks[i])

        symptoms_output = []
        
        # 4. ROBOFLOW CLASS NAMES (Must be exact match)
        color_map = {
            "yellowing": "#FFC107", 
            "gray spot": "#6C757D", 
            "leaf rot": "#A52A2A" # Adjust if your 3rd class is named differently
        }

        for class_name, data in symptom_stats.items():
            class_masks_tensor = torch.stack(data["mask_list"])
            class_union_mask = torch.any(class_masks_tensor, dim=0)
            class_pct = class_union_mask.sum().item() / leaflet_area_pixels
            
            symptoms_output.append({
                "label": class_name,
                "percent": round(class_pct * 100, 1),
                "count": data["count"],
                "color": color_map.get(class_name, "#33B82F")
            })

        output = {
            "status": "Severe" if overall_affected_pct > 0.50 else "Moderate",
            "affected_area": round(overall_affected_pct * 100, 1),
            "symptoms": symptoms_output,
            "recommendations": ["Check plantation health."]
        }

        print(json.dumps(output))

    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        run_prediction(sys.argv[1])