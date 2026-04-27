import sys
import json
import torch
import os
from ultralytics import YOLO

def run_prediction(image_path):
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        model_path = os.path.join(script_dir, 'yellowinggrayspot.pt')
        
        model = YOLO(model_path)
        
        # Run inference
        results = model.predict(source=image_path, conf=0.25, save=False, verbose=False)
        result = results[0]

        # --- NEW: SAVE THE ANALYZED IMAGE ---
        # Create a new filename for the analyzed image (e.g., "analyzed_1690000_leaf.jpg")
        base_name = os.path.basename(image_path)
        upload_dir = os.path.dirname(image_path)
        analyzed_filename = f"analyzed_{base_name}"
        analyzed_filepath = os.path.join(upload_dir, analyzed_filename)
        
        # Draw the masks and save it
        result.save(filename=analyzed_filepath)
        
        # The URL path that the frontend will use to display the image
        analyzed_image_url = f"../uploads/{analyzed_filename}"
        # ------------------------------------

        if result.masks is None:
            output = {
                "status": "Healthy",
                "affected_area": 0.0,
                "symptoms": [],
                "recommendations": ["Continue standard care and monitoring."],
                "analyzed_image_url": analyzed_image_url # Added here
            }
            print(json.dumps(output))
            return

        masks = result.masks.data 
        classes = result.boxes.cls.int() 
        names = result.names 

        _, H, W = masks.shape
        leaflet_area_pixels = H * W  

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
        
        color_map = {
            "yellowing": "#FFC107",
            "gray spot": "#6C757D",
            "leaf rot": "#A52A2A"
        }

        for class_name, data in symptom_stats.items():
            class_masks_tensor = torch.stack(data["mask_list"])
            class_union_mask = torch.any(class_masks_tensor, dim=0)
            class_affected_pixels = class_union_mask.sum().item()
            
            class_pct = class_affected_pixels / leaflet_area_pixels
            safe_class_name = str(class_name).lower().strip()
            
            symptoms_output.append({
                "label": class_name,
                "percent": round(class_pct * 100, 1),
                "count": data["count"],
                "color": color_map.get(safe_class_name, "#33B82F")
            })

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
            "recommendations": recs,
            "analyzed_image_url": analyzed_image_url # Added here
        }

        print(json.dumps(output))

    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        run_prediction(sys.argv[1])