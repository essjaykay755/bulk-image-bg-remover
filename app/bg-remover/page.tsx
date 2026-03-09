"use client";

import { useState, useRef, useEffect } from "react";
import { removeWhiteBackground, compositeImage } from "@/lib/imageProcessing";
import Link from "next/link";
import { Upload, Image as ImageIcon, Download, Trash2, SlidersHorizontal, Settings2, FileImage, Layers, ArrowLeft, FolderOpen, Loader2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import JSZip from "jszip";
import { saveAs } from "file-saver";

const BATCH_SIZE = 5;
const yieldToMain = () => new Promise<void>(resolve => setTimeout(resolve, 0));

interface ProcessedImage {
  id: string;
  originalFile: File;
  originalUrl: string;
  transparentUrl: string | null;
  compositedUrl: string | null;
  name: string;
  status: "processing" | "done" | "error";
  customScale?: number;
  customX?: number;
  customY?: number;
  relativePath?: string;
}

export default function Home() {
  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [bgImageFile, setBgImageFile] = useState<File | null>(null);
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const [tolerance, setTolerance] = useState<number>(20);
  const [subjectScale, setSubjectScale] = useState<number>(1.0);
  const [subjectX, setSubjectX] = useState<number>(0);
  const [subjectY, setSubjectY] = useState<number>(0);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const [zipFileName, setZipFileName] = useState("processed_images");

  // ZIP progress state
  const [zipProgress, setZipProgress] = useState<{
    active: boolean;
    currentFolder: string;
    currentFile: string;
    current: number;
    total: number;
  } | null>(null);

  // Keep a ref to images for use in async closures that outlive renders
  const imagesRef = useRef<ProcessedImage[]>([]);
  useEffect(() => { imagesRef.current = images; }, [images]);

  // Apply custom placement to a specific image
  const handleCustomPlacement = (id: string, scale: number, x: number, y: number, reset: boolean = false) => {
    setImages(prev => prev.map(img => {
      if (img.id !== id) return img;
      return {
        ...img,
        customScale: reset ? undefined : scale,
        customX: reset ? undefined : x,
        customY: reset ? undefined : y
      };
    }));
  };

  const activeEditingImage = images.find(img => img.id === editingImageId);

  // Debounced effect for individual recompositions
  useEffect(() => {
    if (!editingImageId || !bgImageUrl) return;
    const img = images.find(p => p.id === editingImageId);
    if (!img || !img.transparentUrl) return;

    const scale = img.customScale !== undefined ? img.customScale : subjectScale;
    const x = img.customX !== undefined ? img.customX : subjectX;
    const y = img.customY !== undefined ? img.customY : subjectY;

    const timeout = setTimeout(async () => {
      setImages(prev => prev.map(p => p.id === img.id ? { ...p, status: "processing" } : p));
      try {
        let compositedUrl = null;
        if (bgImageUrl) {
          compositedUrl = await compositeImage(img.transparentUrl!, bgImageUrl, scale, x, y);
        }
        setImages(prev => prev.map(p => p.id === img.id ? { ...p, compositedUrl, status: "done" } : p));
      } catch (e) {
        setImages(prev => prev.map(p => p.id === img.id ? { ...p, status: "error" } : p));
      }
    }, 200);
    return () => clearTimeout(timeout);
  }, [
    editingImageId,
    bgImageUrl,
    images.find(p => p.id === editingImageId)?.customScale,
    images.find(p => p.id === editingImageId)?.customX,
    images.find(p => p.id === editingImageId)?.customY
  ]);

  // File Input Refs
  const foregroundInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);

  // Handle Foreground Images Upload
  const handleForegroundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;

    setIsProcessingAll(true);
    const files = Array.from(e.target.files);

    // Add to state immediately as processing
    const newImages: ProcessedImage[] = files.map(file => ({
      id: Math.random().toString(36).substring(7),
      originalFile: file,
      originalUrl: URL.createObjectURL(file),
      transparentUrl: null,
      compositedUrl: null,
      name: file.name,
      status: "processing"
    }));

    setImages(prev => [...prev, ...newImages]);

    // Process in batches to avoid memory exhaustion
    for (let i = 0; i < newImages.length; i += BATCH_SIZE) {
      const batch = newImages.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (img) => {
        try {
          const transparentUrl = await removeWhiteBackground(img.originalFile, tolerance);
          let compositedUrl = null;
          if (bgImageUrl) {
            compositedUrl = await compositeImage(transparentUrl, bgImageUrl, subjectScale, subjectX, subjectY);
          }
          setImages(prev => prev.map(p =>
            p.id === img.id ? { ...p, transparentUrl, compositedUrl, status: "done" } : p
          ));
        } catch (err) {
          console.error("Error processing " + img.name, err);
          setImages(prev => prev.map(p =>
            p.id === img.id ? { ...p, status: "error" } : p
          ));
        }
      }));
      // Yield to main thread between batches so GC can run and UI stays responsive
      await yieldToMain();
    }
    setIsProcessingAll(false);
  };

  // Handle Folder Upload (preserves subfolder structure via webkitdirectory)
  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;

    setIsProcessingAll(true);
    const files = Array.from(e.target.files).filter(f => f.type.startsWith("image/"));

    // webkitRelativePath looks like "RootFolder/Subfolder/image.jpg"
    // We strip the root folder name so relativePath = "Subfolder/image.jpg"
    const newImages: ProcessedImage[] = files.map(file => {
      const parts = file.webkitRelativePath.split("/");
      const relativePath = parts.length > 1 ? parts.slice(1).join("/") : file.name;
      return {
        id: Math.random().toString(36).substring(7),
        originalFile: file,
        originalUrl: URL.createObjectURL(file),
        transparentUrl: null,
        compositedUrl: null,
        name: file.name,
        status: "processing" as const,
        relativePath,
      };
    });

    setImages(prev => [...prev, ...newImages]);

    // Process in batches
    for (let i = 0; i < newImages.length; i += BATCH_SIZE) {
      const batch = newImages.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (img) => {
        try {
          const transparentUrl = await removeWhiteBackground(img.originalFile, tolerance);
          let compositedUrl = null;
          if (bgImageUrl) {
            compositedUrl = await compositeImage(transparentUrl, bgImageUrl, subjectScale, subjectX, subjectY);
          }
          setImages(prev => prev.map(p =>
            p.id === img.id ? { ...p, transparentUrl, compositedUrl, status: "done" } : p
          ));
        } catch (err) {
          console.error("Error processing " + img.name, err);
          setImages(prev => prev.map(p =>
            p.id === img.id ? { ...p, status: "error" } : p
          ));
        }
      }));
      await yieldToMain();
    }
    setIsProcessingAll(false);
    // Reset input so re-selecting the same folder triggers onChange
    e.target.value = "";
  };

  // Handle Background Image Upload
  const handleBackgroundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const file = e.target.files[0];
    const url = URL.createObjectURL(file);

    setBgImageFile(file);
    setBgImageUrl(url);

    // Use ref to get latest images (avoids stale closure)
    const currentImages = imagesRef.current;
    setImages(prev => prev.map(img => ({ ...img, status: img.transparentUrl ? "processing" : img.status })));

    // Process in batches
    const toProcess = currentImages.filter(img => img.transparentUrl);
    for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
      const batch = toProcess.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (img) => {
        try {
          const actScale = img.customScale !== undefined ? img.customScale : subjectScale;
          const actX = img.customX !== undefined ? img.customX : subjectX;
          const actY = img.customY !== undefined ? img.customY : subjectY;
          const compositedUrl = await compositeImage(img.transparentUrl!, url, actScale, actX, actY);
          setImages(prev => prev.map(p =>
            p.id === img.id ? { ...p, compositedUrl, status: "done" } : p
          ));
        } catch (error) {
          setImages(prev => prev.map(p =>
            p.id === img.id ? { ...p, status: "done" } : p
          ));
        }
      }));
      await yieldToMain();
    }
  };

  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
  };

  const clearAllImages = () => {
    if (window.confirm("Are you sure you want to remove all images?")) {
      setImages([]);
    }
  };

  const clearBackground = async () => {
    setBgImageFile(null);
    setBgImageUrl(null);
    setImages(prev => prev.map(img => ({ ...img, compositedUrl: null })));
  };

  const downloadAll = async () => {
    const zip = new JSZip();
    const transparentFolder = zip.folder("Transparent_PNGs")!;
    const compositedFolder = zip.folder("Final_Images")!;

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

      if (img.transparentUrl) {
        const response = await fetch(img.transparentUrl);
        const blob = await response.blob();
        const targetFolder = subDir ? transparentFolder.folder(subDir)! : transparentFolder;
        targetFolder.file(`${baseName}_transparent.png`, blob);
      }
      if (img.compositedUrl) {
        const response = await fetch(img.compositedUrl);
        const blob = await response.blob();
        const ext = blob.type === "image/png" ? "png" : "jpg";
        const targetFolder = subDir ? compositedFolder.folder(subDir)! : compositedFolder;
        targetFolder.file(`${baseName}_final.${ext}`, blob);
      }

      // Yield every few files so the progress bar updates
      if (i % 3 === 0) await yieldToMain();
    }

    setZipProgress(prev => prev ? { ...prev, currentFile: "Compressing ZIP...", currentFolder: "" } : null);
    await yieldToMain();

    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `${zipFileName || "processed_images"}.zip`);
    setZipProgress(null);
  };

  // Trigger re-composite when subject placement changes
  useEffect(() => {
    if (images.length === 0 || !bgImageUrl) return;
    const recomposite = async () => {
      const currentImages = imagesRef.current;
      setImages(prev => prev.map(img => ({ ...img, status: "processing" })));
      const toProcess = currentImages.filter(img => img.transparentUrl);
      for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
        const batch = toProcess.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (img) => {
          try {
            let compositedUrl = null;
            if (bgImageUrl) {
              const actScale = img.customScale !== undefined ? img.customScale : subjectScale;
              const actX = img.customX !== undefined ? img.customX : subjectX;
              const actY = img.customY !== undefined ? img.customY : subjectY;
              compositedUrl = await compositeImage(img.transparentUrl!, bgImageUrl, actScale, actX, actY);
            }
            setImages(prev => prev.map(p =>
              p.id === img.id ? { ...p, compositedUrl, status: "done" } : p
            ));
          } catch (e) {
            setImages(prev => prev.map(p =>
              p.id === img.id ? { ...p, status: "error" } : p
            ));
          }
        }));
        await yieldToMain();
      }
    };
    const timeout = setTimeout(recomposite, 200);
    return () => clearTimeout(timeout);
  }, [subjectScale, subjectX, subjectY]);

  // Trigger re-process when tolerance changes
  useEffect(() => {
    if (images.length === 0) return;
    const reprocess = async () => {
      setIsProcessingAll(true);
      const currentImages = imagesRef.current;
      setImages(prev => prev.map(img => ({ ...img, status: "processing" })));
      for (let i = 0; i < currentImages.length; i += BATCH_SIZE) {
        const batch = currentImages.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (img) => {
          try {
            const transparentUrl = await removeWhiteBackground(img.originalFile, tolerance);
            let compositedUrl = null;
            if (bgImageUrl) {
              const actScale = img.customScale !== undefined ? img.customScale : subjectScale;
              const actX = img.customX !== undefined ? img.customX : subjectX;
              const actY = img.customY !== undefined ? img.customY : subjectY;
              compositedUrl = await compositeImage(transparentUrl, bgImageUrl, actScale, actX, actY);
            }
            setImages(prev => prev.map(p =>
              p.id === img.id ? { ...p, transparentUrl, compositedUrl, status: "done" } : p
            ));
          } catch (e) {
            setImages(prev => prev.map(p =>
              p.id === img.id ? { ...p, status: "error" } : p
            ));
          }
        }));
        await yieldToMain();
      }
      setIsProcessingAll(false);
    };

    const timeout = setTimeout(reprocess, 800);
    return () => clearTimeout(timeout);
  }, [tolerance]);

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
                Chroma<span className="text-muted-foreground/50 font-light">Clear</span>
              </h1>
              <p className="text-muted-foreground text-base md:text-lg max-w-[65ch] leading-relaxed">
                Bulk background removal and high-performance compositing.
              </p>
            </div>

            {images.length > 0 && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <button
                  onClick={clearAllImages}
                  className="px-6 py-3.5 text-sm font-semibold text-red-500 hover:text-red-600 bg-red-50/50 hover:bg-red-50 dark:bg-red-950/20 dark:hover:bg-red-950/40 rounded-full transition-colors order-last sm:order-first"
                >
                  Clear All
                </button>
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
                  className="group flex items-center justify-center gap-3 px-8 py-3.5 bg-foreground text-background rounded-full font-semibold shadow-xl hover:shadow-2xl transition-all whitespace-nowrap"
                >
                  <Download className="w-5 h-5 group-hover:translate-y-0.5 transition-transform" />
                  Export ZIP
                </motion.button>
              </div>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-8 md:gap-12 items-start">

          {/* Left Sidebar - Controls */}
          <aside className="xl:col-span-1 space-y-6">

            {/* Foreground Upload */}
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
                  <p className="text-xs text-muted-foreground mt-1.5 font-medium">Preserves subfolder structure in ZIP</p>
                </div>
              </div>
            </div>

            {/* Background Context */}
            <div className="liquid-glass p-8 rounded-[2.5rem] transition-all">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold flex items-center gap-3 text-foreground">
                  <Layers className="w-5 h-5 text-accent" />
                  Environment
                </h3>
                {bgImageUrl && (
                  <button onClick={clearBackground} className="text-xs text-red-500 hover:text-red-400 transition-colors font-semibold uppercase tracking-wider">Clear</button>
                )}
              </div>

              {bgImageUrl ? (
                <div className="relative rounded-[1.5rem] overflow-hidden aspect-[4/3] border border-border group shadow-sm">
                  <img src={bgImageUrl} alt="Background" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-background/50 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={() => backgroundInputRef.current?.click()}
                      className="px-5 py-2.5 bg-foreground text-background rounded-full font-semibold text-sm shadow-xl"
                    >
                      Replace Image
                    </motion.button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => backgroundInputRef.current?.click()}
                  className="group border border-dashed border-muted-foreground/30 bg-muted/5 rounded-[1.5rem] p-10 flex flex-col items-center justify-center text-center cursor-pointer hover:border-accent hover:bg-accent/5 transition-all duration-300"
                >
                  <ImageIcon className="w-8 h-8 mb-4 text-muted-foreground group-hover:text-accent transition-colors" />
                  <p className="font-semibold text-foreground">Set Background</p>
                  <p className="text-sm text-muted-foreground mt-2 font-medium">Any format</p>
                </div>
              )}

              <input
                ref={backgroundInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleBackgroundUpload}
              />
            </div>



            {/* Settings Node */}
            <div className="liquid-glass p-8 rounded-[2.5rem]">
              <h3 className="text-lg font-bold flex items-center gap-3 mb-8 text-foreground">
                <Settings2 className="w-5 h-5 text-muted-foreground" />
                Engine Config
              </h3>

              <div className="space-y-8">
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <label className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
                      White Threshold
                    </label>
                    <span className="text-xs font-mono bg-muted/50 text-muted-foreground px-2 py-1 rounded border border-border">{tolerance}</span>
                  </div>
                  <input
                    type="range" min="0" max="100" value={tolerance}
                    onChange={(e) => setTolerance(parseInt(e.target.value))}
                    className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
                  />
                  <p className="text-xs text-muted-foreground mt-3 font-medium leading-relaxed">
                    Controls the Euclidean distance cutoff for the alpha mask.
                  </p>
                </div>

                {bgImageUrl && (
                  <div className="pt-6 mt-6 border-t border-border/50 space-y-5">
                    <div className="flex items-center justify-between pb-2">
                      <label className="text-sm font-bold tracking-tight text-foreground flex items-center gap-2">
                        Placement
                      </label>
                      <div className="flex gap-1.5">
                        {[
                          { label: "Preset 1", scale: 0.55, x: 0, y: 14 },
                          { label: "Preset 2", scale: 0.65, x: 0, y: 14 }
                        ].map(preset => (
                          <button
                            key={preset.label}
                            onClick={() => {
                              setSubjectScale(preset.scale);
                              setSubjectX(preset.x);
                              setSubjectY(preset.y);
                            }}
                            className="text-[10px] font-semibold uppercase tracking-wider bg-background hover:bg-muted text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border transition-colors shadow-sm"
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Scale */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-medium text-muted-foreground">Scale</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number" min="0.1" max="3.0" step="0.05"
                            value={subjectScale}
                            onChange={(e) => setSubjectScale(parseFloat(e.target.value) || 1)}
                            className="w-16 bg-background border border-border rounded text-xs px-2 py-1 font-mono text-right focus:outline-accent"
                          />
                          <span className="text-muted-foreground text-xs font-mono">x</span>
                        </div>
                      </div>
                      <input
                        type="range" min="0.1" max="3.0" step="0.05"
                        value={subjectScale}
                        onChange={(e) => setSubjectScale(parseFloat(e.target.value))}
                        className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-foreground"
                      />
                    </div>

                    {/* Position X */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-medium text-muted-foreground">Pos X</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number" min="-100" max="100"
                            value={subjectX}
                            onChange={(e) => setSubjectX(parseInt(e.target.value) || 0)}
                            className="w-16 bg-background border border-border rounded text-xs px-2 py-1 font-mono text-right focus:outline-accent"
                          />
                          <span className="text-muted-foreground text-xs font-mono">%</span>
                        </div>
                      </div>
                      <input
                        type="range" min="-100" max="100"
                        value={subjectX}
                        onChange={(e) => setSubjectX(parseInt(e.target.value))}
                        className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-foreground"
                      />
                    </div>

                    {/* Position Y */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-medium text-muted-foreground">Pos Y</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number" min="-100" max="100"
                            value={subjectY}
                            onChange={(e) => setSubjectY(parseInt(e.target.value) || 0)}
                            className="w-16 bg-background border border-border rounded text-xs px-2 py-1 font-mono text-right focus:outline-accent"
                          />
                          <span className="text-muted-foreground text-xs font-mono">%</span>
                        </div>
                      </div>
                      <input
                        type="range" min="-100" max="100"
                        value={subjectY}
                        onChange={(e) => setSubjectY(parseInt(e.target.value))}
                        className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-foreground"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

          </aside>

          {/* Right Content - Gallery */}
          <main className="lg:col-span-3">
            {images.length === 0 ? (
              <div className="h-full min-h-[500px] flex flex-col items-center justify-center glass rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 p-12 text-center">
                <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
                  <ImageIcon className="w-10 h-10 text-primary opacity-80" />
                </div>
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200 mb-2">Your canvas is empty</h2>
                <p className="text-slate-500 max-w-md">
                  Upload your product images with white backgrounds to instantly remove them and preview against a new environment.
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
                        <p className="font-semibold text-sm truncate max-w-[70%] text-foreground">{img.name}</p>
                        <div className="flex gap-1.5">
                          {bgImageUrl && (
                            <button
                              onClick={() => setEditingImageId(editingImageId === img.id ? null : img.id)}
                              className={`p-2 rounded-full transition-colors ${editingImageId === img.id ? 'bg-foreground text-background shadow-md' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
                              title="Custom Placement"
                            >
                              <SlidersHorizontal className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => removeImage(img.id)}
                            className="text-muted-foreground hover:text-red-500 transition-colors p-2 rounded-full hover:bg-red-50/50 dark:hover:bg-red-950/30"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Image Previews */}
                      <div className="relative flex-1 flex items-center justify-center bg-transparent checkerboard">

                        {img.status === "processing" ? (
                          <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center z-10">
                            <div className="w-8 h-8 border-2 border-muted border-t-foreground rounded-full animate-spin"></div>
                          </div>
                        ) : null}

                        {/* Show Composited or Transparent Image */}
                        {(img.compositedUrl || img.transparentUrl) ? (
                          <div className="relative w-full aspect-square flex items-center justify-center overflow-hidden">
                            {img.compositedUrl ? (
                              <img src={img.compositedUrl} alt="Composited" className="w-full h-full object-cover" />
                            ) : (
                              <img src={img.transparentUrl!} alt="Transparent" className="w-[85%] h-[85%] object-contain drop-shadow-xl" />
                            )}
                          </div>
                        ) : (
                          <div className="w-[85%] aspect-square flex items-center justify-center">
                            <img src={img.originalUrl} alt="Original" className="w-full h-full object-contain" />
                          </div>
                        )}

                        {/* The overlay is now moved to the bottom root level modal. */}
                      </div>

                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Editor Modal */}
      <AnimatePresence>
        {activeEditingImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-12 bg-background/80 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="w-full max-w-6xl max-h-[90vh] liquid-glass rounded-[2rem] shadow-2xl overflow-hidden flex flex-col lg:flex-row relative"
            >
              <button
                onClick={() => setEditingImageId(null)}
                className="absolute top-6 right-6 z-20 w-10 h-10 flex items-center justify-center bg-background/50 hover:bg-background text-foreground rounded-full transition-colors backdrop-blur-md"
              >
                ✕
              </button>

              {/* Left Side: Large Preview */}
              <div className="flex-1 lg:flex-[2] bg-muted/20 checkerboard relative min-h-[40vh] lg:min-h-full flex items-center justify-center p-8 border-b lg:border-b-0 lg:border-r border-border/50">
                {activeEditingImage.status === "processing" ? (
                  <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center z-10">
                    <div className="w-10 h-10 border-4 border-muted border-t-foreground rounded-full animate-spin"></div>
                  </div>
                ) : null}

                {(activeEditingImage.compositedUrl || activeEditingImage.transparentUrl) ? (
                  <div className="relative w-full max-w-2xl aspect-square flex items-center justify-center">
                    {activeEditingImage.compositedUrl ? (
                      <img src={activeEditingImage.compositedUrl} alt="Composited" className="w-full h-full object-contain drop-shadow-2xl" />
                    ) : (
                      <img src={activeEditingImage.transparentUrl!} alt="Transparent" className="w-[85%] h-[85%] object-contain drop-shadow-2xl" />
                    )}
                  </div>
                ) : (
                  <div className="w-full max-w-2xl aspect-square flex items-center justify-center">
                    <img src={activeEditingImage.originalUrl} alt="Original" className="w-[85%] h-[85%] object-contain drop-shadow-2xl" />
                  </div>
                )}
              </div>

              {/* Right Side: Settings */}
              <div className="flex-1 p-8 lg:p-10 flex flex-col bg-background/50">
                <div className="mb-8">
                  <h2 className="text-2xl font-bold tracking-tight text-foreground mb-2">Adjust Subject</h2>
                  <p className="text-sm text-muted-foreground truncate">{activeEditingImage.name}</p>
                </div>

                <div className="space-y-8 flex-1">
                  <div className="flex flex-col gap-4 pb-4 border-b border-border/50">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Overrides</span>
                      {(activeEditingImage.customScale !== undefined || activeEditingImage.customX !== undefined || activeEditingImage.customY !== undefined) && (
                        <button
                          onClick={() => handleCustomPlacement(activeEditingImage.id, subjectScale, subjectX, subjectY, true)}
                          className="text-xs text-red-500 hover:text-red-400 font-medium px-3 py-1.5 bg-red-50 dark:bg-red-500/10 rounded-full transition-colors"
                        >
                          Reset to Global
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground mr-1">Presets:</span>
                      {[
                        { label: "Preset 1", scale: 0.55, x: 0, y: 14 },
                        { label: "Preset 2", scale: 0.65, x: 0, y: 14 }
                      ].map(preset => (
                        <button
                          key={preset.label}
                          onClick={() => handleCustomPlacement(activeEditingImage.id, preset.scale, preset.x, preset.y)}
                          className="text-[10px] font-semibold uppercase tracking-wider bg-background hover:bg-muted text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded border border-border transition-colors shadow-sm"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Scale */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="text-sm font-medium text-foreground">Scale Range</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number" min="0.1" max="3.0" step="0.05"
                          value={activeEditingImage.customScale !== undefined ? activeEditingImage.customScale : subjectScale}
                          onChange={(e) => handleCustomPlacement(activeEditingImage.id, parseFloat(e.target.value) || 1, activeEditingImage.customX ?? subjectX, activeEditingImage.customY ?? subjectY)}
                          className="w-20 bg-background border border-border rounded-lg text-sm px-3 py-1.5 font-mono text-right focus:outline-accent"
                        />
                        <span className="text-muted-foreground text-sm font-mono">x</span>
                      </div>
                    </div>
                    <input
                      type="range" min="0.1" max="3.0" step="0.05"
                      value={activeEditingImage.customScale !== undefined ? activeEditingImage.customScale : subjectScale}
                      onChange={(e) => handleCustomPlacement(activeEditingImage.id, parseFloat(e.target.value), activeEditingImage.customX ?? subjectX, activeEditingImage.customY ?? subjectY)}
                      className="w-full h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-foreground"
                    />
                  </div>

                  {/* Position X */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="text-sm font-medium text-foreground">Horizontal Axis</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number" min="-100" max="100"
                          value={activeEditingImage.customX !== undefined ? activeEditingImage.customX : subjectX}
                          onChange={(e) => handleCustomPlacement(activeEditingImage.id, activeEditingImage.customScale ?? subjectScale, parseInt(e.target.value) || 0, activeEditingImage.customY ?? subjectY)}
                          className="w-20 bg-background border border-border rounded-lg text-sm px-3 py-1.5 font-mono text-right focus:outline-accent"
                        />
                        <span className="text-muted-foreground text-sm font-mono">%</span>
                      </div>
                    </div>
                    <input
                      type="range" min="-100" max="100"
                      value={activeEditingImage.customX !== undefined ? activeEditingImage.customX : subjectX}
                      onChange={(e) => handleCustomPlacement(activeEditingImage.id, activeEditingImage.customScale ?? subjectScale, parseInt(e.target.value), activeEditingImage.customY ?? subjectY)}
                      className="w-full h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-foreground"
                    />
                  </div>

                  {/* Position Y */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="text-sm font-medium text-foreground">Vertical Axis</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number" min="-100" max="100"
                          value={activeEditingImage.customY !== undefined ? activeEditingImage.customY : subjectY}
                          onChange={(e) => handleCustomPlacement(activeEditingImage.id, activeEditingImage.customScale ?? subjectScale, activeEditingImage.customX ?? subjectX, parseInt(e.target.value) || 0)}
                          className="w-20 bg-background border border-border rounded-lg text-sm px-3 py-1.5 font-mono text-right focus:outline-accent"
                        />
                        <span className="text-muted-foreground text-sm font-mono">%</span>
                      </div>
                    </div>
                    <input
                      type="range" min="-100" max="100"
                      value={activeEditingImage.customY !== undefined ? activeEditingImage.customY : subjectY}
                      onChange={(e) => handleCustomPlacement(activeEditingImage.id, activeEditingImage.customScale ?? subjectScale, activeEditingImage.customX ?? subjectX, parseInt(e.target.value))}
                      className="w-full h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-foreground"
                    />
                  </div>
                </div>

                <div className="mt-8 pt-8 border-t border-border/50">
                  <button
                    onClick={() => setEditingImageId(null)}
                    className="w-full py-4 bg-foreground text-background rounded-xl font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                  >
                    Save & Close
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ZIP Progress Modal */}
      <AnimatePresence>
        {zipProgress && (
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

              {/* Progress bar */}
              <div className="w-full h-2 bg-border rounded-full overflow-hidden mb-5">
                <motion.div
                  className="h-full bg-accent rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${zipProgress.total > 0 ? (zipProgress.current / zipProgress.total) * 100 : 0}%` }}
                  transition={{ ease: "easeOut", duration: 0.3 }}
                />
              </div>

              {/* Current file info */}
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
        )}
      </AnimatePresence>
    </div>
  );
}
