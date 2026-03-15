"use client";

import { useState, useRef, useEffect } from "react";
import { applyLogo } from "@/lib/imageProcessing";
import Link from "next/link";
import { Upload, Image as ImageIcon, Download, Trash2, FileImage, ArrowLeft, FolderOpen, Loader2, Sparkles, RefreshCw, X, SlidersHorizontal, Blend, Stamp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import JSZip from "jszip";
import { saveAs } from "file-saver";

const BATCH_SIZE = 2; // Lower batch size for API calls to avoid rate limits
const yieldToMain = () => new Promise<void>(resolve => setTimeout(resolve, 0));

interface ProcessedImage {
    id: string;
    originalFile: File;
    originalUrl: string;
    generatedUrl: string | null;
    generatedBase64: string | null;
    generatedMimeType: string | null;
    name: string;
    status: "idle" | "generating" | "done" | "error";
    errorMessage?: string;
    actionMessage?: string;
    relativePath?: string;
    fixWrinkles: boolean;
    // Surface Blur (Photoshop)
    surfaceBlurUrl: string | null;
    surfaceBlurBase64: string | null;
    surfaceBlurMimeType: string | null;
    surfaceBlurStatus: "idle" | "processing" | "done" | "error";
}

export default function AIRetouchPage() {
    const [images, setImages] = useState<ProcessedImage[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [aiProvider, setAiProvider] = useState<"vertex" | "gemini">("vertex");
    const [aiModel, setAiModel] = useState<"gemini-3.1-flash-image-preview" | "gemini-2.5-flash-image">("gemini-3.1-flash-image-preview");
    const [isBlurringAll, setIsBlurringAll] = useState(false);
    const [viewingImageId, setViewingImageId] = useState<string | null>(null);
    const viewingImage = images.find(img => img.id === viewingImageId);

    // Refs
    const foregroundInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const logoInputRef = useRef<HTMLInputElement>(null);
    const imagesRef = useRef<ProcessedImage[]>([]);
    useEffect(() => { imagesRef.current = images; }, [images]);

    // Logo state
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoUrl, setLogoUrl] = useState<string | null>(null);
    const [logoScale, setLogoScale] = useState<number>(0.15);
    const [logoX, setLogoX] = useState<number>(9);
    const [logoY, setLogoY] = useState<number>(9);

    // Progress state
    const [batchProgress, setBatchProgress] = useState<{
        label: string;
        current: number;
        total: number;
        currentFile: string;
    } | null>(null);

    const [zipProgress, setZipProgress] = useState<{
        active: boolean;
        currentFolder: string;
        currentFile: string;
        current: number;
        total: number;
    } | null>(null);

    const [zipFileName, setZipFileName] = useState("ai_retouched_images");

    // Handle Foreground Images Upload (NO auto-processing)
    const handleForegroundUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) return;
        const files = Array.from(e.target.files);

        const newImages: ProcessedImage[] = files.map(file => ({
            id: Math.random().toString(36).substring(7),
            originalFile: file,
            originalUrl: URL.createObjectURL(file),
            generatedUrl: null,
            generatedBase64: null,
            generatedMimeType: null,
            name: file.name,
            status: "idle",
            fixWrinkles: false,
            surfaceBlurUrl: null,
            surfaceBlurBase64: null,
            surfaceBlurMimeType: null,
            surfaceBlurStatus: "idle",
        }));

        setImages(prev => [...prev, ...newImages]);
    };

    // Handle Folder Upload (NO auto-processing)
    const handleFolderUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) return;
        const files = Array.from(e.target.files).filter(f => f.type.startsWith("image/"));

        const newImages: ProcessedImage[] = files.map(file => {
            const parts = file.webkitRelativePath.split("/");
            const relativePath = parts.length > 1 ? parts.slice(1).join("/") : file.name;
            return {
                id: Math.random().toString(36).substring(7),
                originalFile: file,
                originalUrl: URL.createObjectURL(file),
                generatedUrl: null,
                generatedBase64: null,
                generatedMimeType: null,
                name: file.name,
                status: "idle" as const,
                relativePath,
                fixWrinkles: false,
                surfaceBlurUrl: null,
                surfaceBlurBase64: null,
                surfaceBlurMimeType: null,
                surfaceBlurStatus: "idle" as const,
            };
        });

        setImages(prev => [...prev, ...newImages]);
        e.target.value = "";
    };

    // Convert file to base64
    const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                // Strip the data:image/xxx;base64, prefix
                const base64 = result.split(",")[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    // Call the AI API for a single image with retry logic for rate limits
    const generateSingleImage = async (img: ProcessedImage, retryCount = 0): Promise<{ base64: string; mimeType: string }> => {
        const imageBase64 = await fileToBase64(img.originalFile);
        const response = await fetch("/api/ai-retouch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                imageBase64,
                mimeType: img.originalFile.type || "image/jpeg",
                fixWrinkles: img.fixWrinkles,
                provider: aiProvider,
                modelName: aiModel,
            }),
        });

        if (response.status === 429 && retryCount < 5) {
            const err = await response.json();
            const errMessage = typeof err.error === 'string' ? err.error : JSON.stringify(err.error || {});

            // Try to parse "retry in 21s" or similar
            let delayMs = 15000; // default 15s wait
            const match = errMessage.match(/retry in ([\d.]+)s/i);
            if (match && match[1]) {
                delayMs = Math.ceil(parseFloat(match[1])) * 1000 + 2000; // Add 2s buffer
            }
            
            const seconds = Math.round(delayMs / 1000);
            
            // Set image specific status
            setImages(prev => prev.map(p => p.id === img.id ? { ...p, actionMessage: `Rate limit paused (${seconds}s)...` } : p));
            // Inform user via batch UI if present
            setBatchProgress(prev => prev ? { ...prev, label: `Rate limit paused (${seconds}s)...` } : null);
            
            await new Promise(resolve => setTimeout(resolve, delayMs));
            
            // Restore label
            setImages(prev => prev.map(p => p.id === img.id ? { ...p, actionMessage: undefined } : p));
            setBatchProgress(prev => prev ? { ...prev, label: "Generating Realistic Images" } : null);
            
            return generateSingleImage(img, retryCount + 1);
        }

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        return { base64: data.imageBase64, mimeType: data.mimeType };
    };

    // Generate All — processes images that haven't been generated yet
    const handleGenerateAll = async () => {
        const currentImages = imagesRef.current;
        const toProcess = currentImages.filter(img => img.status === "idle" || img.status === "error");
        if (toProcess.length === 0) return;

        setIsGenerating(true);
        const total = toProcess.length;
        setBatchProgress({ label: "Generating Realistic Images", current: 0, total, currentFile: "" });
        let processed = 0;
        const currentBatchSize = aiProvider === "gemini" ? 1 : BATCH_SIZE;

        for (let i = 0; i < toProcess.length; i += currentBatchSize) {
            const batch = toProcess.slice(i, i + currentBatchSize);
            await Promise.all(batch.map(async (img) => {
                setImages(prev => prev.map(p =>
                    p.id === img.id ? { ...p, status: "generating" } : p
                ));
                try {
                    const result = await generateSingleImage(img);
                    const blob = await fetch(`data:${result.mimeType};base64,${result.base64}`).then(r => r.blob());
                    const generatedUrl = URL.createObjectURL(blob);
                    setImages(prev => prev.map(p =>
                        p.id === img.id ? {
                            ...p,
                            generatedUrl,
                            generatedBase64: result.base64,
                            generatedMimeType: result.mimeType,
                            status: "done",
                        } : p
                    ));
                } catch (err: any) {
                    console.error("Error generating " + img.name, err);
                    setImages(prev => prev.map(p =>
                        p.id === img.id ? { ...p, status: "error", errorMessage: err.message } : p
                    ));
                }
                processed++;
                setBatchProgress({ label: "Generating Realistic Images", current: processed, total, currentFile: img.name });
            }));
            await yieldToMain();
        }
        setBatchProgress(null);
        setIsGenerating(false);
    };

    // Generate or regenerate a single image
    const handleGenerateSingle = async (imgId: string) => {
        const img = imagesRef.current.find(i => i.id === imgId);
        if (!img) return;

        setImages(prev => prev.map(p =>
            p.id === imgId ? { ...p, status: "generating" } : p
        ));
        try {
            const result = await generateSingleImage(img);
            const blob = await fetch(`data:${result.mimeType};base64,${result.base64}`).then(r => r.blob());
            const generatedUrl = URL.createObjectURL(blob);
            setImages(prev => prev.map(p =>
                p.id === imgId ? {
                    ...p,
                    generatedUrl,
                    generatedBase64: result.base64,
                    generatedMimeType: result.mimeType,
                    status: "done",
                } : p
            ));
        } catch (err: any) {
            console.error("Error generating " + img.name, err);
            setImages(prev => prev.map(p =>
                p.id === imgId ? { ...p, status: "error", errorMessage: err.message } : p
            ));
        }
    };

    // Apply Photoshop Surface Blur to a single generated image
    const handleSurfaceBlur = async (imgId: string) => {
        const img = imagesRef.current.find(i => i.id === imgId);
        if (!img || !img.generatedBase64) return;

        setImages(prev => prev.map(p =>
            p.id === imgId ? { ...p, surfaceBlurStatus: "processing" } : p
        ));

        try {
            const response = await fetch("/api/run-ps", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    imageBase64: img.generatedBase64,
                    mimeType: img.generatedMimeType || "image/png",
                }),
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || `HTTP ${response.status}`);
            }

            const data = await response.json();
            const blob = await fetch(`data:${data.mimeType};base64,${data.imageBase64}`).then(r => r.blob());
            const blurUrl = URL.createObjectURL(blob);

            setImages(prev => prev.map(p =>
                p.id === imgId ? {
                    ...p,
                    surfaceBlurUrl: blurUrl,
                    surfaceBlurBase64: data.imageBase64,
                    surfaceBlurMimeType: data.mimeType,
                    surfaceBlurStatus: "done",
                } : p
            ));
        } catch (err: any) {
            console.error("Surface Blur error for " + img.name, err);
            setImages(prev => prev.map(p =>
                p.id === imgId ? { ...p, surfaceBlurStatus: "error", errorMessage: err.message } : p
            ));
        }
    };

    // Batch apply Photoshop Surface Blur to all done images
    const handleSurfaceBlurAll = async () => {
        const blurrableImages = imagesRef.current.filter(
            img => img.status === "done" && img.generatedBase64 && img.surfaceBlurStatus !== "done" && img.surfaceBlurStatus !== "processing"
        );
        if (blurrableImages.length === 0) return;

        setIsBlurringAll(true);
        const total = blurrableImages.length;
        setBatchProgress({ label: "Applying Surface Blur", current: 0, total, currentFile: "" });

        for (let i = 0; i < blurrableImages.length; i++) {
            const img = blurrableImages[i];
            setBatchProgress({ label: "Applying Surface Blur", current: i, total, currentFile: img.name });
            await handleSurfaceBlur(img.id);
            // Give Photoshop time to fully close the document before next image
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        setBatchProgress(null);
        setIsBlurringAll(false);
    };

    // Handle Logo Upload
    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) return;
        const file = e.target.files[0];
        setLogoFile(file);
        setLogoUrl(URL.createObjectURL(file));
    };

    const clearLogo = () => {
        setLogoFile(null);
        setLogoUrl(null);
    };

    // Download all as ZIP with folder structure
    const downloadAll = async () => {
        const zip = new JSZip();
        const folder = zip.folder("AI_Retouched")!;

        const total = images.length;
        setZipProgress({ active: true, currentFolder: "", currentFile: "", current: 0, total });

        for (let i = 0; i < images.length; i++) {
            const img = images[i];
            const baseName = img.name.split('.')[0];
            const subDir = img.relativePath
                ? img.relativePath.substring(0, img.relativePath.lastIndexOf("/"))
                : "";
            const folderLabel = subDir || "Root";

            setZipProgress({ active: true, currentFolder: folderLabel, currentFile: img.name, current: i + 1, total });

            // Use surface-blurred if available, then generated, then original
            let targetUrl = img.surfaceBlurUrl || img.generatedUrl || img.originalUrl;

            // Apply logo watermark if one is set
            if (targetUrl && logoUrl) {
                try {
                    targetUrl = await applyLogo(targetUrl, logoUrl, logoScale, logoX, logoY);
                } catch (err) {
                    console.error("Logo apply error for " + img.name, err);
                }
            }

            if (targetUrl) {
                const response = await fetch(targetUrl);
                const blob = await response.blob();
                const ext = blob.type === "image/png" ? "png" : "jpg";
                const targetFolder = subDir ? folder.folder(subDir)! : folder;
                targetFolder.file(`${baseName}_retouched.${ext}`, blob);
            }

            if (i % 3 === 0) await yieldToMain();
        }

        setZipProgress(prev => prev ? { ...prev, currentFile: "Compressing ZIP...", currentFolder: "" } : null);
        await yieldToMain();

        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, `${zipFileName || "ai_retouched_images"}.zip`);
        setZipProgress(null);
    };

    // Remove individual image
    const removeImage = (id: string) => {
        setImages(prev => prev.filter(img => img.id !== id));
    };

    const doneCount = images.filter(img => img.status === "done").length;
    const idleOrErrorCount = images.filter(img => img.status === "idle" || img.status === "error").length;
    const blurrableCount = images.filter(img => img.status === "done" && img.generatedBase64 && img.surfaceBlurStatus !== "done" && img.surfaceBlurStatus !== "processing").length;

    return (
        <div className="min-h-[100dvh] bg-background text-foreground font-sans selection:bg-accent/30 selection:text-accent-foreground p-6 sm:p-8 md:p-12 transition-colors duration-500">
            <div className="max-w-[1400px] mx-auto">
                {/* Header */}
                <header className="mb-14 space-y-8">
                    <Link href="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-all group font-semibold text-sm">
                        <div className="p-2 rounded-xl bg-muted/50 border border-border group-hover:bg-accent group-hover:text-accent-foreground group-hover:border-accent transition-all">
                            <ArrowLeft className="w-4 h-4" />
                        </div>
                        Back to Dashboard
                    </Link>

                    <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-6">
                        <div>
                            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tighter leading-none text-foreground mb-3">
                                AI<span className="text-muted-foreground/50 font-light">Retouch</span>
                            </h1>
                            <p className="text-muted-foreground text-base md:text-lg max-w-[65ch] leading-relaxed">
                                Transform rough photoshops into realistic product photography with AI.
                            </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                            <select
                                value={aiProvider}
                                onChange={(e) => setAiProvider(e.target.value as "vertex" | "gemini")}
                                className="px-5 py-3.5 bg-background border border-border rounded-full text-sm font-medium focus:outline-accent focus:ring-2 focus:ring-accent/20 cursor-pointer shadow-sm hover:shadow-md transition-shadow"
                                title="Select AI Provider"
                            >
                                <option value="vertex">Google Vertex AI</option>
                                <option value="gemini">Google Gemini API</option>
                            </select>

                            {aiProvider === "gemini" && (
                                <select
                                    value={aiModel}
                                    onChange={(e) => setAiModel(e.target.value as any)}
                                    className="px-5 py-3.5 bg-background border border-border rounded-full text-sm font-medium focus:outline-accent focus:ring-2 focus:ring-accent/20 cursor-pointer shadow-sm hover:shadow-md transition-shadow"
                                    title="Select Gemini Model"
                                >
                                    <option value="gemini-3.1-flash-image-preview">gemini-3.1-flash-image-preview</option>
                                    <option value="gemini-2.5-flash-image">gemini-2.5-flash-image</option>
                                </select>
                            )}

                            {idleOrErrorCount > 0 && (
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    onClick={handleGenerateAll}
                                    disabled={isGenerating}
                                    className="group flex items-center gap-3 px-8 py-3.5 bg-accent text-accent-foreground rounded-full font-semibold shadow-xl hover:shadow-2xl transition-all disabled:opacity-50 disabled:pointer-events-none"
                                >
                                    {isGenerating ? (
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                    ) : (
                                        <Sparkles className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                                    )}
                                    {isGenerating ? "Generating..." : `Generate ${idleOrErrorCount > 0 ? `(${idleOrErrorCount})` : "All"}`}
                                </motion.button>
                            )}

                            {blurrableCount > 0 && (
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    onClick={handleSurfaceBlurAll}
                                    disabled={isBlurringAll}
                                    className="group flex items-center gap-3 px-8 py-3.5 bg-blue-600 text-white rounded-full font-semibold shadow-xl hover:shadow-2xl transition-all disabled:opacity-50 disabled:pointer-events-none"
                                >
                                    {isBlurringAll ? (
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                    ) : (
                                        <Blend className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                                    )}
                                    {isBlurringAll ? "Blurring..." : `Blur All (${blurrableCount})`}
                                </motion.button>
                            )}

                            {doneCount > 0 && (
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                                    <input
                                        type="text"
                                        value={zipFileName}
                                        onChange={(e) => setZipFileName(e.target.value)}
                                        placeholder="Custom ZIP Name"
                                        className="px-6 py-3.5 bg-background border border-border rounded-full text-sm font-medium focus:outline-accent focus:ring-2 focus:ring-accent/20 min-w-[200px]"
                                    />
                                    <motion.button
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        onClick={downloadAll}
                                        className="group flex items-center gap-3 px-8 py-3.5 bg-foreground text-background rounded-full font-semibold shadow-xl hover:shadow-2xl transition-all"
                                    >
                                        <Download className="w-5 h-5 group-hover:translate-y-0.5 transition-transform" />
                                        Export ZIP
                                    </motion.button>
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                <div className="grid grid-cols-1 xl:grid-cols-4 gap-8 md:gap-12 items-start">

                    {/* Left Sidebar - Upload */}
                    <aside className="xl:col-span-1 space-y-6">
                        <div className="liquid-glass p-8 rounded-[2.5rem] transition-all">
                            <h3 className="text-lg font-bold flex items-center gap-3 mb-6 text-foreground">
                                <FileImage className="w-5 h-5 text-accent" />
                                Source Intake
                            </h3>
                            <div className="grid grid-cols-1 gap-3">
                                <div
                                    onClick={() => foregroundInputRef.current?.click()}
                                    className="group border border-dashed border-muted-foreground/30 bg-muted/5 rounded-[1.5rem] p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:border-accent hover:bg-accent/5 transition-all duration-300"
                                >
                                    <input
                                        ref={foregroundInputRef}
                                        type="file" multiple accept="image/*" className="hidden"
                                        onChange={handleForegroundUpload}
                                    />
                                    <Upload className="w-7 h-7 mb-3 text-muted-foreground group-hover:text-accent transition-colors" />
                                    <p className="font-semibold text-foreground text-sm">Upload Files</p>
                                    <p className="text-xs text-muted-foreground mt-1.5 font-medium">Select individual images</p>
                                </div>
                                <div
                                    onClick={() => folderInputRef.current?.click()}
                                    className="group border border-dashed border-muted-foreground/30 bg-muted/5 rounded-[1.5rem] p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:border-accent hover:bg-accent/5 transition-all duration-300"
                                >
                                    <input
                                        ref={folderInputRef}
                                        type="file" accept="image/*" className="hidden"
                                        onChange={handleFolderUpload}
                                        {...{ webkitdirectory: "", directory: "" } as any}
                                    />
                                    <FolderOpen className="w-7 h-7 mb-3 text-muted-foreground group-hover:text-accent transition-colors" />
                                    <p className="font-semibold text-foreground text-sm">Upload Folder</p>
                                    <p className="text-xs text-muted-foreground mt-1.5 font-medium">Preserves subfolder structure</p>
                                </div>
                            </div>
                        </div>


                        {/* Info card */}
                        <div className="liquid-glass p-8 rounded-[2.5rem] transition-all">
                            <h3 className="text-lg font-bold flex items-center gap-3 mb-4 text-foreground">
                                <Sparkles className="w-5 h-5 text-accent" />
                                How it works
                            </h3>
                            <ol className="space-y-3 text-sm text-muted-foreground">
                                <li className="flex gap-3">
                                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/10 text-accent flex items-center justify-center text-xs font-bold">1</span>
                                    <span>Upload your rough photoshopped product images</span>
                                </li>
                                <li className="flex gap-3">
                                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/10 text-accent flex items-center justify-center text-xs font-bold">2</span>
                                    <span>Click <strong className="text-foreground">Generate</strong> to transform them with AI</span>
                                </li>
                                <li className="flex gap-3">
                                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/10 text-accent flex items-center justify-center text-xs font-bold">3</span>
                                    <span>Review the results and <strong className="text-foreground">Export ZIP</strong></span>
                                </li>
                            </ol>
                        </div>

                        {/* Logo Watermark */}
                        <div className="liquid-glass p-8 rounded-[2.5rem] transition-all">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-lg font-bold flex items-center gap-3 text-foreground">
                                    <Stamp className="w-5 h-5 text-accent" />
                                    Watermark
                                </h3>
                                {logoUrl && (
                                    <button onClick={clearLogo} className="text-xs text-red-500 hover:text-red-400 transition-colors font-semibold uppercase tracking-wider">Clear</button>
                                )}
                            </div>

                            {logoUrl ? (
                                <div className="relative rounded-[1.5rem] overflow-hidden aspect-[4/3] border border-border group shadow-sm bg-muted/20 checkerboard">
                                    <img src={logoUrl} alt="Logo" className="w-[85%] h-[85%] mx-auto my-auto object-contain drop-shadow-md" style={{ marginTop: '7.5%' }} />
                                    <div className="absolute inset-0 bg-background/50 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                                        <motion.button
                                            whileTap={{ scale: 0.95 }}
                                            onClick={() => logoInputRef.current?.click()}
                                            className="px-5 py-2.5 bg-foreground text-background rounded-full font-semibold text-sm shadow-xl"
                                        >
                                            Replace Logo
                                        </motion.button>
                                    </div>
                                </div>
                            ) : (
                                <div
                                    onClick={() => logoInputRef.current?.click()}
                                    className="group border border-dashed border-muted-foreground/30 bg-muted/5 rounded-[1.5rem] p-10 flex flex-col items-center justify-center text-center cursor-pointer hover:border-accent hover:bg-accent/5 transition-all duration-300"
                                >
                                    <ImageIcon className="w-8 h-8 mb-4 text-muted-foreground group-hover:text-accent transition-colors" />
                                    <p className="font-semibold text-foreground">Add Logo</p>
                                    <p className="text-sm text-muted-foreground mt-2 font-medium">PNG recommended</p>
                                </div>
                            )}

                            <input
                                ref={logoInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleLogoUpload}
                            />

                            {logoUrl && (
                                <div className="pt-6 mt-6 border-t border-border/50 space-y-5">
                                    <label className="text-sm font-bold tracking-tight text-foreground flex items-center gap-2 pb-2">
                                        Logo Placement
                                    </label>

                                    {/* Logo Scale */}
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-xs font-medium text-muted-foreground">Scale</span>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number" min="0.01" max="1.0" step="0.01"
                                                    value={logoScale}
                                                    onChange={(e) => setLogoScale(parseFloat(e.target.value) || 0.15)}
                                                    className="w-16 bg-background border border-border rounded text-xs px-2 py-1 font-mono text-right focus:outline-accent"
                                                />
                                                <span className="text-muted-foreground text-xs font-mono">x</span>
                                            </div>
                                        </div>
                                        <input
                                            type="range" min="0.01" max="1.0" step="0.01"
                                            value={logoScale}
                                            onChange={(e) => setLogoScale(parseFloat(e.target.value))}
                                            className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-foreground"
                                        />
                                    </div>

                                    {/* Logo Pos X */}
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-xs font-medium text-muted-foreground">Pos X</span>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number" min="0" max="100"
                                                    value={logoX}
                                                    onChange={(e) => setLogoX(parseInt(e.target.value) || 0)}
                                                    className="w-16 bg-background border border-border rounded text-xs px-2 py-1 font-mono text-right focus:outline-accent"
                                                />
                                                <span className="text-muted-foreground text-xs font-mono">%</span>
                                            </div>
                                        </div>
                                        <input
                                            type="range" min="0" max="100"
                                            value={logoX}
                                            onChange={(e) => setLogoX(parseInt(e.target.value))}
                                            className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-foreground"
                                        />
                                    </div>

                                    {/* Logo Pos Y */}
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-xs font-medium text-muted-foreground">Pos Y</span>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number" min="0" max="100"
                                                    value={logoY}
                                                    onChange={(e) => setLogoY(parseInt(e.target.value) || 0)}
                                                    className="w-16 bg-background border border-border rounded text-xs px-2 py-1 font-mono text-right focus:outline-accent"
                                                />
                                                <span className="text-muted-foreground text-xs font-mono">%</span>
                                            </div>
                                        </div>
                                        <input
                                            type="range" min="0" max="100"
                                            value={logoY}
                                            onChange={(e) => setLogoY(parseInt(e.target.value))}
                                            className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-foreground"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </aside>

                    {/* Right Content - Gallery */}
                    <main className="lg:col-span-3">
                        {images.length === 0 ? (
                            <div className="h-full min-h-[500px] flex flex-col items-center justify-center glass rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 p-12 text-center">
                                <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
                                    <Sparkles className="w-10 h-10 text-primary opacity-80" />
                                </div>
                                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200 mb-2">Your canvas is empty</h2>
                                <p className="text-slate-500 max-w-md">
                                    Upload your roughly photoshopped product images. They won&apos;t be processed until you click Generate.
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                <AnimatePresence>
                                    {images.map((img) => (
                                        <motion.div
                                            layout
                                            initial={{ opacity: 0, y: 20 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.95 }}
                                            key={img.id}
                                            className="liquid-glass rounded-[2rem] overflow-hidden group flex flex-col shadow-sm hover:shadow-xl transition-shadow duration-500"
                                        >
                                            {/* Header */}
                                            <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 bg-background/30 backdrop-blur-md z-20 relative">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    {img.status === "done" && (
                                                        <span className="flex-shrink-0 w-2 h-2 rounded-full bg-green-500" title="Generated" />
                                                    )}
                                                    {img.status === "error" && (
                                                        <span className="flex-shrink-0 w-2 h-2 rounded-full bg-red-500" title="Error" />
                                                    )}
                                                    {img.status === "idle" && (
                                                        <span className="flex-shrink-0 w-2 h-2 rounded-full bg-muted-foreground/30" title="Pending" />
                                                    )}
                                                    <p className="font-semibold text-sm truncate text-foreground">{img.name}</p>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setImages(prev => prev.map(p =>
                                                                p.id === img.id ? { ...p, fixWrinkles: !p.fixWrinkles } : p
                                                            ));
                                                        }}
                                                        className={`text-xs px-2.5 py-1 rounded-full font-semibold transition-all border ${img.fixWrinkles
                                                            ? 'bg-accent/15 text-accent border-accent/30'
                                                            : 'bg-transparent text-muted-foreground border-border hover:border-accent/30 hover:text-accent'
                                                            }`}
                                                        title="Toggle wrinkle smoothing for this image"
                                                    >
                                                        {img.fixWrinkles ? '🧹 Wrinkles' : '🧹'}
                                                    </button>
                                                    {/* Surface Blur — only visible after AI generation */}
                                                    {img.status === "done" && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (img.surfaceBlurStatus !== "processing") {
                                                                    handleSurfaceBlur(img.id);
                                                                }
                                                            }}
                                                            disabled={img.surfaceBlurStatus === "processing"}
                                                            className={`text-xs px-2.5 py-1 rounded-full font-semibold transition-all border flex items-center gap-1 ${img.surfaceBlurStatus === "done"
                                                                ? 'bg-blue-500/15 text-blue-500 border-blue-500/30'
                                                                : img.surfaceBlurStatus === "processing"
                                                                    ? 'bg-blue-500/10 text-blue-400 border-blue-400/20 opacity-70'
                                                                    : 'bg-transparent text-muted-foreground border-border hover:border-blue-500/30 hover:text-blue-500'
                                                                }`}
                                                            title={img.surfaceBlurStatus === "done" ? "Surface blur applied" : img.surfaceBlurStatus === "processing" ? "Applying blur..." : "Apply Photoshop surface blur"}
                                                        >
                                                            {img.surfaceBlurStatus === "processing" ? (
                                                                <Loader2 className="w-3 h-3 animate-spin" />
                                                            ) : (
                                                                <Blend className="w-3 h-3" />
                                                            )}
                                                            {img.surfaceBlurStatus === "done" ? 'Blurred' : img.surfaceBlurStatus === "processing" ? 'Blurring...' : 'Blur'}
                                                    </button>
                                                    )}
                                                    {img.status !== "generating" && (
                                                        <button
                                                            onClick={() => handleGenerateSingle(img.id)}
                                                            className="text-muted-foreground hover:text-accent transition-colors p-2 rounded-full hover:bg-accent/10"
                                                            title={img.status === "done" ? "Regenerate" : "Generate"}
                                                        >
                                                            {img.status === "done" ? <RefreshCw className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                                                        </button>
                                                    )}
                                                    {img.status === "generating" && (
                                                        <div className="p-2">
                                                            <Loader2 className="w-4 h-4 text-accent animate-spin" />
                                                        </div>
                                                    )}
                                                    <button
                                                        onClick={() => removeImage(img.id)}
                                                        className="text-muted-foreground hover:text-red-500 transition-colors p-2 rounded-full hover:bg-red-50/50 dark:hover:bg-red-950/30"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Image Preview — clickable to open modal */}
                                            <div
                                                className="relative flex-1 flex items-center justify-center bg-transparent checkerboard cursor-pointer"
                                                onClick={() => img.status !== "generating" && setViewingImageId(img.id)}
                                            >
                                                {img.status === "generating" && (
                                                    <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex flex-col items-center justify-center z-10 gap-3 text-center px-4">
                                                        <Loader2 className="w-8 h-8 text-accent animate-spin" />
                                                        <span className="text-sm font-semibold text-foreground">
                                                            {img.actionMessage || "Generating..."}
                                                        </span>
                                                    </div>
                                                )}

                                                {img.surfaceBlurUrl ? (
                                                    <div className="relative w-full aspect-square flex items-center justify-center overflow-hidden">
                                                        <img src={img.surfaceBlurUrl} alt="Surface Blurred" className="w-full h-full object-cover" />
                                                    </div>
                                                ) : img.generatedUrl ? (
                                                    <div className="relative w-full aspect-square flex items-center justify-center overflow-hidden">
                                                        <img src={img.generatedUrl} alt="Generated" className="w-full h-full object-cover" />
                                                    </div>
                                                ) : (
                                                    <div className="w-full aspect-square flex items-center justify-center overflow-hidden">
                                                        <img src={img.originalUrl} alt="Original" className="w-full h-full object-cover" />
                                                    </div>
                                                )}

                                                {img.status === "error" && (
                                                    <div className="absolute bottom-0 left-0 right-0 px-4 py-2 bg-red-500/90 text-white text-xs text-center truncate z-10">
                                                        {img.errorMessage || "Generation failed"}
                                                    </div>
                                                )}
                                            </div>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            </div>
                        )}
                    </main>
                </div>
            </div >

            {/* Image Lightbox Modal */}
            <AnimatePresence>
                {
                    viewingImage && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-12 bg-background/80 backdrop-blur-xl"
                            onClick={() => setViewingImageId(null)}
                        >
                            <motion.div
                                initial={{ scale: 0.95, y: 20 }}
                                animate={{ scale: 1, y: 0 }}
                                exit={{ scale: 0.95, y: 20 }}
                                className="w-full max-w-6xl max-h-[90vh] liquid-glass rounded-[2rem] shadow-2xl overflow-hidden flex flex-col relative"
                                onClick={(e) => e.stopPropagation()}
                            >
                                {/* Modal header */}
                                <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
                                    <div className="flex items-center gap-3 min-w-0">
                                        {viewingImage.status === "done" && <span className="w-2 h-2 rounded-full bg-green-500" />}
                                        {viewingImage.status === "error" && <span className="w-2 h-2 rounded-full bg-red-500" />}
                                        {viewingImage.status === "idle" && <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />}
                                        <h3 className="font-bold text-foreground truncate">{viewingImage.name}</h3>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {viewingImage.status !== "generating" && (
                                            <button
                                                onClick={() => handleGenerateSingle(viewingImage.id)}
                                                className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-full font-semibold text-sm hover:opacity-90 transition-opacity"
                                            >
                                                {viewingImage.status === "done" ? <RefreshCw className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                                                {viewingImage.status === "done" ? "Regenerate" : "Generate"}
                                            </button>
                                        )}
                                        {viewingImage.status === "generating" && (
                                            <div className="flex items-center gap-2 px-4 py-2 text-accent text-sm font-semibold">
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Generating...
                                            </div>
                                        )}
                                        <button
                                            onClick={() => setViewingImageId(null)}
                                            className="p-2 hover:bg-muted/50 rounded-full transition-colors text-muted-foreground hover:text-foreground"
                                        >
                                            <X className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>

                                {/* Modal body — side-by-side images */}
                                <div className="flex-1 overflow-auto p-6">
                                    <div className={`grid gap-6 ${viewingImage.surfaceBlurUrl ? 'grid-cols-1 md:grid-cols-3' : viewingImage.generatedUrl ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
                                        {/* Original */}
                                        <div className="space-y-3">
                                            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Original</span>
                                            <div className="rounded-xl overflow-hidden border border-border/50 checkerboard">
                                                <img src={viewingImage.originalUrl} alt="Original" className="w-full h-auto object-contain max-h-[65vh]" />
                                            </div>
                                        </div>

                                        {/* Generated */}
                                        {viewingImage.generatedUrl && (
                                            <div className="space-y-3">
                                                <span className="text-xs font-bold uppercase tracking-wider text-accent">AI Generated</span>
                                                <div className="rounded-xl overflow-hidden border border-accent/30 shadow-lg shadow-accent/5">
                                                    <img src={viewingImage.generatedUrl} alt="Generated" className="w-full h-auto object-contain max-h-[65vh]" />
                                                </div>
                                            </div>
                                        )}

                                        {/* Surface Blurred */}
                                        {viewingImage.surfaceBlurUrl && (
                                            <div className="space-y-3">
                                                <span className="text-xs font-bold uppercase tracking-wider text-blue-500">Surface Blurred</span>
                                                <div className="rounded-xl overflow-hidden border border-blue-500/30 shadow-lg shadow-blue-500/5">
                                                    <img src={viewingImage.surfaceBlurUrl} alt="Surface Blurred" className="w-full h-auto object-contain max-h-[65vh]" />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        </motion.div>
                    )
                }
            </AnimatePresence >

            {/* Batch Processing Progress Modal */}
            <AnimatePresence>
                {
                    batchProgress && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/80 backdrop-blur-xl"
                        >
                            <motion.div
                                initial={{ scale: 0.95, y: 20 }}
                                animate={{ scale: 1, y: 0 }}
                                exit={{ scale: 0.95, y: 20 }}
                                className="w-full max-w-md liquid-glass rounded-[2rem] p-8 shadow-2xl"
                            >
                                <div className="flex items-center gap-4 mb-6">
                                    <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
                                        <Sparkles className="w-6 h-6 text-accent animate-pulse" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-foreground">{batchProgress.label}</h3>
                                        <p className="text-sm text-muted-foreground">
                                            {batchProgress.current} / {batchProgress.total} images
                                        </p>
                                    </div>
                                </div>
                                <div className="w-full h-2 bg-border rounded-full overflow-hidden mb-5">
                                    <motion.div
                                        className="h-full bg-accent rounded-full"
                                        initial={{ width: 0 }}
                                        animate={{ width: `${batchProgress.total > 0 ? (batchProgress.current / batchProgress.total) * 100 : 0}%` }}
                                        transition={{ ease: "easeOut", duration: 0.3 }}
                                    />
                                </div>
                                <div className="flex items-center gap-2 bg-muted/30 rounded-xl p-4 border border-border/50">
                                    <FileImage className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                    <span className="text-sm text-muted-foreground truncate">{batchProgress.currentFile}</span>
                                </div>
                            </motion.div>
                        </motion.div>
                    )
                }
            </AnimatePresence >

            {/* ZIP Progress Modal */}
            <AnimatePresence>
                {
                    zipProgress && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/80 backdrop-blur-xl"
                        >
                            <motion.div
                                initial={{ scale: 0.95, y: 20 }}
                                animate={{ scale: 1, y: 0 }}
                                exit={{ scale: 0.95, y: 20 }}
                                className="w-full max-w-md liquid-glass rounded-[2rem] p-8 shadow-2xl"
                            >
                                <div className="flex items-center gap-4 mb-6">
                                    <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
                                        <Loader2 className="w-6 h-6 text-accent animate-spin" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-foreground">Creating ZIP</h3>
                                        <p className="text-sm text-muted-foreground">
                                            {zipProgress.current} / {zipProgress.total} files
                                        </p>
                                    </div>
                                </div>
                                <div className="w-full h-2 bg-border rounded-full overflow-hidden mb-5">
                                    <motion.div
                                        className="h-full bg-accent rounded-full"
                                        initial={{ width: 0 }}
                                        animate={{ width: `${zipProgress.total > 0 ? (zipProgress.current / zipProgress.total) * 100 : 0}%` }}
                                        transition={{ ease: "easeOut", duration: 0.3 }}
                                    />
                                </div>
                                <div className="space-y-2 bg-muted/30 rounded-xl p-4 border border-border/50">
                                    {zipProgress.currentFolder && (
                                        <div className="flex items-center gap-2">
                                            <FolderOpen className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                            <span className="text-sm font-medium text-foreground truncate">{zipProgress.currentFolder}</span>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <FileImage className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                        <span className="text-sm text-muted-foreground truncate">{zipProgress.currentFile}</span>
                                    </div>
                                </div>
                            </motion.div>
                        </motion.div>
                    )
                }
            </AnimatePresence >
        </div >
    );
}
