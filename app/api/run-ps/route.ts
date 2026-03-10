import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

export async function POST(req: NextRequest) {
    try {
        const { imageBase64, mimeType } = await req.json();

        if (!imageBase64) {
            return NextResponse.json(
                { error: "Missing imageBase64" },
                { status: 400 }
            );
        }

        // Paths from environment (with sensible defaults)
        const psPath =
            process.env.PHOTOSHOP_PATH ||
            "C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Photoshop.exe";
        const atnPath =
            process.env.PS_ACTION_FILE ||
            "C:\\Users\\Subhojit Karmakar\\AppData\\Roaming\\Adobe\\Adobe Photoshop 2026\\Presets\\Actions\\Surface blur with selection.atn";
        const actionName = process.env.PS_ACTION_NAME || "Surface blur with selection";
        const actionSet = process.env.PS_ACTION_SET || "Surface Blur";

        // Create temp directory for this operation
        const tempDir = path.join(os.tmpdir(), `ps-blur-${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });

        // Determine file extension from mime type
        const ext = mimeType === "image/png" ? "png" : "jpg";

        // Define temp file paths
        const inputPath = path.join(tempDir, `input.${ext}`);
        const outputPath = path.join(tempDir, "output.png");
        const markerPath = path.join(tempDir, "done.marker");
        const tempJsxPath = path.join(tempDir, "_temp.jsx");

        // Write the input image to disk
        fs.writeFileSync(inputPath, Buffer.from(imageBase64, "base64"));

        // Read and populate the JSX template
        const jsxTemplate = fs.readFileSync(
            path.join(process.cwd(), "scripts", "run-action.jsx"),
            "utf8"
        );

        const jsxScript = jsxTemplate
            .replace("ATN_PATH_PLACEHOLDER", atnPath.replace(/\\/g, "/"))
            .replace("INPUT_PATH_PLACEHOLDER", inputPath.replace(/\\/g, "/"))
            .replace("OUTPUT_PATH_PLACEHOLDER", outputPath.replace(/\\/g, "/"))
            .replace("MARKER_PATH_PLACEHOLDER", markerPath.replace(/\\/g, "/"))
            .replace("ACTION_NAME_PLACEHOLDER", actionName)
            .replace("ACTION_SET_PLACEHOLDER", actionSet);

        fs.writeFileSync(tempJsxPath, jsxScript);

        // Execute Photoshop with the JSX script
        const cmd = `"${psPath}" "${tempJsxPath}"`;
        exec(cmd, (error) => {
            if (error) {
                console.error("Photoshop exec error:", error.message);
            }
        });

        // Poll for the marker file (Photoshop writes it when done)
        const TIMEOUT_MS = 120_000; // 2 minutes
        const POLL_INTERVAL_MS = 1_000;
        const startTime = Date.now();

        while (Date.now() - startTime < TIMEOUT_MS) {
            if (fs.existsSync(markerPath)) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }

        if (!fs.existsSync(markerPath)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            return NextResponse.json(
                { error: "Photoshop timed out (2 min). Make sure Photoshop is running." },
                { status: 500 }
            );
        }

        // Small delay to ensure file write is fully flushed
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Read the output file
        if (!fs.existsSync(outputPath)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            return NextResponse.json(
                { error: "Output file not found after Photoshop processing." },
                { status: 500 }
            );
        }

        const outputBuffer = fs.readFileSync(outputPath);
        const outputBase64 = outputBuffer.toString("base64");

        // Cleanup temp files
        fs.rmSync(tempDir, { recursive: true, force: true });

        return NextResponse.json({
            imageBase64: outputBase64,
            mimeType: "image/png",
        });
    } catch (error: any) {
        console.error("PS Surface Blur error:", error);
        return NextResponse.json(
            { error: error.message || "Internal server error" },
            { status: 500 }
        );
    }
}
