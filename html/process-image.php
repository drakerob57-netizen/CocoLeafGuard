<?php
header('Content-Type: application/json');

// Increase time limit for the model to load
set_time_limit(120);

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['image'])) {
    $uploadDir = '../uploads/'; 
    if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);

    $file = $_FILES['image'];
    $targetFile = $uploadDir . time() . '_' . basename($file['name']);

    if (move_uploaded_file($file['tmp_name'], $targetFile)) {
        
        $pythonPath = 'python'; // Change back to 'python' if you are on Windows and it fails
        $scriptPath = '../ai_model/predict.py';
        
        $escapedImage = escapeshellarg($targetFile);
        $command = "$pythonPath $scriptPath $escapedImage 2>&1";
        
        // Execute Python
        $output = shell_exec($command);

        // EXTRACTION FIX: Find ONLY the JSON block inside the output
        if (preg_match('/\{.*\}/s', $output, $matches)) {
            $jsonContent = $matches[0];
            $aiResults = json_decode($jsonContent, true);
        } else {
            $aiResults = null;
        }

        if ($aiResults) {
            echo json_encode($aiResults);
        } else {
            echo json_encode([
                "error" => "AI processing failed.",
                "debug" => $output 
            ]);
        }
    } else {
        echo json_encode(["error" => "Failed to move uploaded file. Check folder permissions."]);
    }
} else {
    echo json_encode(["error" => "Invalid request. No image found."]);
}
?>