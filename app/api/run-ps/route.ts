import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ─── Server-side PS semaphore ─────────────────────────────────────────────────
// Only ONE Photoshop job can run at a time across all concurrent HTTP requests.
// Each new request appends itself to this chain and waits its turn.
let psQueue: Promise<void> = Promise.resolve();

function enqueuePS<T>(job: () => Promise<T>): Promise<T> {
    const result = psQueue.then(() => job());
    // Swallow errors so a failed job doesn't block the queue for subsequent jobs
    psQueue = result.then(() => {}, () => {});
    return result;
}
// ─────────────────────────────────────────────────────────────────────────────

function getStableFileState(filePath: string, previousSize: number | null, stableChecks: number) {
    if (!fs.existsSync(filePath)) {
        return {
            exists: false,
            size: null as number | null,
            stableChecks: 0,
        };
    }

    const size = fs.statSync(filePath).size;

    return {
        exists: true,
        size,
        stableChecks: size > 0 && size === previousSize ? stableChecks + 1 : 0,
    };
}

async function launchPhotoshopScript(psPath: string, jsxPath: string) {
    try {
        await execFileAsync(psPath, [jsxPath], { timeout: 15_000 });
    } catch {
        // Expected when Photoshop is already open and Windows hands off via DDE.
    }
}

async function isProcessRunning(processName: string) {
    try {
        const { stdout } = await execFileAsync("tasklist", ["/fi", `IMAGENAME eq ${processName}`]);
        return stdout.toLowerCase().includes(processName.toLowerCase());
    } catch {
        return false;
    }
}

async function runPSJob(imageBase64: string, mimeType: string): Promise<{ imageBase64: string; mimeType: string }> {
    const psPath =
        process.env.PHOTOSHOP_PATH ||
        "C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Photoshop.exe";
    const atnPath =
        process.env.PS_ACTION_FILE ||
        "C:\\Users\\Subhojit Karmakar\\AppData\\Roaming\\Adobe\\Adobe Photoshop 2026\\Presets\\Actions\\Surface blur with selection.atn";
    const actionName = process.env.PS_ACTION_NAME || "Surface blur with selection";
    const actionSet = process.env.PS_ACTION_SET || "Surface Blur";

    const tempDir = path.join(os.tmpdir(), `ps-blur-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const ext = mimeType === "image/png" ? "png" : "jpg";
    const inputPath = path.join(tempDir, `input.${ext}`);
    const outputPath = path.join(tempDir, "output.png");
    const markerPath = path.join(tempDir, "done.marker");
    const tempJsxPath = path.join(tempDir, "_temp.jsx");

    fs.writeFileSync(inputPath, Buffer.from(imageBase64, "base64"));

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

    // Launch Photoshop. If already running, Windows DDE passes the script to it.
    // We fire-and-forget — the actual completion signal comes from the marker file.
    await launchPhotoshopScript(psPath, tempJsxPath);

    // Give PS a brief head-start before we start polling.
    await new Promise((r) => setTimeout(r, 200));

    // Poll for the marker file with a 3-minute ceiling (watchdog)
    const TIMEOUT_MS = 180_000;
    const POLL_MS = 250;
    const STABLE_OUTPUT_POLLS = 3;
    const RELAUNCH_AFTER_MS = 10_000;
    const start = Date.now();
    let completedByStableOutput = false;
    let previousOutputSize: number | null = null;
    let stableOutputChecks = 0;
    let lastProgressAt = Date.now();
    let relaunched = false;

    while (Date.now() - start < TIMEOUT_MS) {
        if (fs.existsSync(markerPath)) break;

        const outputState = getStableFileState(outputPath, previousOutputSize, stableOutputChecks);
        if (outputState.exists && outputState.size !== previousOutputSize) {
            lastProgressAt = Date.now();
        }
        previousOutputSize = outputState.size;
        stableOutputChecks = outputState.stableChecks;

        // Some Photoshop actions finish exporting but close before the JSX writes the marker.
        if (outputState.exists && stableOutputChecks >= STABLE_OUTPUT_POLLS) {
            completedByStableOutput = true;
            break;
        }

        if (!relaunched && Date.now() - lastProgressAt >= RELAUNCH_AFTER_MS) {
            const photoshopRunning = await isProcessRunning("Photoshop.exe");
            if (!photoshopRunning) {
                await launchPhotoshopScript(psPath, tempJsxPath);
                relaunched = true;
                lastProgressAt = Date.now();
                continue;
            }
        }

        await new Promise((r) => setTimeout(r, POLL_MS));
    }

    if (!fs.existsSync(markerPath) && !completedByStableOutput) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        
        // WATCHDOG: Photoshop has permanently hung. Force kill it so the next image can restart fresh.
        try {
            await execFileAsync("taskkill", ["/f", "/im", "Photoshop.exe"]);
            console.log("Watchdog triggered: Killed frozen Photoshop process.");
        } catch {
            console.error("Failed to kill frozen Photoshop (might have already crashed)");
        }

        throw new Error("Photoshop timed out (3 min). Process was killed to recover the queue.");
    }

    if (fs.existsSync(markerPath)) {
        const markerContent = fs.readFileSync(markerPath, "utf8").trim();
        if (markerContent.startsWith("error:")) {
            const psError = markerContent.substring(6);
            fs.rmSync(tempDir, { recursive: true, force: true });
            throw new Error(`Photoshop action failed: ${psError}`);
        }
    }

    // Short flush wait so we don't add multi-second idle time between images.
    await new Promise((r) => setTimeout(r, 300));

    if (!fs.existsSync(outputPath)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        throw new Error("Output file not found after Photoshop processing.");
    }

    const outputBuffer = fs.readFileSync(outputPath);
    const outputBase64 = outputBuffer.toString("base64");
    fs.rmSync(tempDir, { recursive: true, force: true });

    return { imageBase64: outputBase64, mimeType: "image/png" };
}

export async function POST(req: NextRequest) {
    try {
        const { imageBase64, mimeType } = await req.json();

        if (!imageBase64) {
            return NextResponse.json({ error: "Missing imageBase64" }, { status: 400 });
        }

        // Strictly serialise: wait for any in-flight PS job to finish first
        const result = await enqueuePS(() => runPSJob(imageBase64, mimeType || "image/jpeg"));
        return NextResponse.json(result);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Internal server error";
        console.error("PS Surface Blur error:", message);
        return NextResponse.json(
            { error: message },
            { status: 500 }
        );
    }
}
