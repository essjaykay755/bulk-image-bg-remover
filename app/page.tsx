"use client";

import { useState, useRef, useEffect } from "react";
import { removeWhiteBackground, compositeImage } from "@/lib/imageProcessing";
import { Upload, Image as ImageIcon, Download, Trash2, SlidersHorizontal, Settings2, FileImage, Layers } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import JSZip from "jszip";
import { saveAs } from "file-saver";

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
        const compositedUrl = await compositeImage(img.transparentUrl!, bgImageUrl, scale, x, y);
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

    // Process each image
    for (const img of newImages) {
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
    }
    setIsProcessingAll(false);
  };

  // Handle Background Image Upload
  const handleBackgroundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const file = e.target.files[0];
    const url = URL.createObjectURL(file);

    setBgImageFile(file);
    setBgImageUrl(url);

    // Re-composite all finished transparent images
    setImages(prev => prev.map(img => ({ ...img, status: img.status === "done" ? "processing" : img.status })));

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (img.transparentUrl) {
        try {
          const actScale = img.customScale !== undefined ? img.customScale : subjectScale;
          const actX = img.customX !== undefined ? img.customX : subjectX;
          const actY = img.customY !== undefined ? img.customY : subjectY;
          const compositedUrl = await compositeImage(img.transparentUrl, url, actScale, actX, actY);
          setImages(prev => prev.map(p =>
            p.id === img.id ? { ...p, compositedUrl, status: "done" } : p
          ));
        } catch (error) {
          setImages(prev => prev.map(p =>
            p.id === img.id ? { ...p, status: "done" } : p
          ));
        }
      }
    }
  };

  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
  };

  const clearBackground = () => {
    setBgImageFile(null);
    setBgImageUrl(null);
    setImages(prev => prev.map(img => ({ ...img, compositedUrl: null })));
  };

  const downloadAll = async () => {
    const zip = new JSZip();
    const transparentFolder = zip.folder("Transparent_PNGs");
    const compositedFolder = zip.folder("Composited_JPEGs");

    for (const img of images) {
      if (img.transparentUrl && transparentFolder) {
        // Data URl to Blob
        const response = await fetch(img.transparentUrl);
        const blob = await response.blob();
        transparentFolder.file(`${img.name.split('.')[0]}_transparent.png`, blob);
      }
      if (img.compositedUrl && compositedFolder) {
        const response = await fetch(img.compositedUrl);
        const blob = await response.blob();
        compositedFolder.file(`${img.name.split('.')[0]}_composited.jpg`, blob);
      }
    }

    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, "processed_images.zip");
  };

  // Trigger re-composite when subject placement changes
  useEffect(() => {
    if (images.length === 0 || !bgImageUrl) return;
    const recomposite = async () => {
      setImages(prev => prev.map(img => ({ ...img, status: "processing" })));
      for (const img of images) {
        if (img.transparentUrl) {
          try {
            const actScale = img.customScale !== undefined ? img.customScale : subjectScale;
            const actX = img.customX !== undefined ? img.customX : subjectX;
            const actY = img.customY !== undefined ? img.customY : subjectY;
            const compositedUrl = await compositeImage(img.transparentUrl, bgImageUrl, actScale, actX, actY);
            setImages(prev => prev.map(p =>
              p.id === img.id ? { ...p, compositedUrl, status: "done" } : p
            ));
          } catch (e) {
            setImages(prev => prev.map(p =>
              p.id === img.id ? { ...p, status: "error" } : p
            ));
          }
        }
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
      setImages(prev => prev.map(img => ({ ...img, status: "processing" })));
      for (const img of images) {
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
      }
      setIsProcessingAll(false);
    };

    // Debounce this simply by a short timeout
    const timeout = setTimeout(reprocess, 800);
    return () => clearTimeout(timeout);
  }, [tolerance]);

  return (
    <div className="min-h-screen p-6 lg:p-12 font-sans selection:bg-primary/30">
      {/* Header */}
      <header className="mb-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-purple-500 bg-clip-text text-transparent pb-2">
            ChromaClear
          </h1>
          <p className="text-muted-foreground text-slate-500 text-lg font-medium">
            Bulk white-background remover and compositor.
          </p>
        </div>

        {images.length > 0 && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={downloadAll}
            className="group flex items-center gap-2 px-6 py-3 bg-foreground text-background rounded-full font-semibold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
          >
            <Download className="w-5 h-5 group-hover:animate-bounce" />
            Download All (ZIP)
          </motion.button>
        )}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">

        {/* Left Sidebar - Controls */}
        <aside className="lg:col-span-1 space-y-6">

          {/* Foreground Upload */}
          <div className="glass p-6 rounded-3xl shadow-sm border border-slate-200/60 dark:border-slate-800/60 transition-all hover:shadow-md">
            <h3 className="text-xl font-bold flex items-center gap-2 mb-4">
              <FileImage className="w-5 h-5 text-primary" />
              Source Images
            </h3>
            <div
              onClick={() => foregroundInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-8 text-center cursor-pointer hover:border-primary transition-colors hover:bg-primary/5 group"
            >
              <input
                ref={foregroundInputRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={handleForegroundUpload}
              />
              <Upload className="w-8 h-8 mx-auto mb-3 text-slate-400 group-hover:text-primary transition-colors" />
              <p className="font-medium text-slate-700 dark:text-slate-300">Click or Drop Images</p>
              <p className="text-xs text-slate-500 mt-1">Supports PNG, JPG (White BG)</p>
            </div>
          </div>

          {/* Background Upload */}
          <div className="glass p-6 rounded-3xl shadow-sm border border-slate-200/60 dark:border-slate-800/60 transition-all hover:shadow-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold flex items-center gap-2">
                <Layers className="w-5 h-5 text-purple-500" />
                Background Context
              </h3>
              {bgImageUrl && (
                <button onClick={clearBackground} className="text-xs text-red-500 hover:underline font-medium">Remove</button>
              )}
            </div>

            {bgImageUrl ? (
              <div className="relative rounded-2xl overflow-hidden aspect-video border border-slate-200 shadow-inner group">
                <img src={bgImageUrl} alt="Background" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <button
                    onClick={() => backgroundInputRef.current?.click()}
                    className="px-4 py-2 bg-white/20 backdrop-blur-md rounded-full text-white font-medium text-sm hover:bg-white/30 transition-colors"
                  >
                    Change BG
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => backgroundInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-8 text-center cursor-pointer hover:border-purple-500 transition-colors hover:bg-purple-500/5 group"
              >
                <ImageIcon className="w-8 h-8 mx-auto mb-3 text-slate-400 group-hover:text-purple-500 transition-colors" />
                <p className="font-medium text-slate-700 dark:text-slate-300">Set Background</p>
                <p className="text-xs text-slate-500 mt-1">Optional composition layer</p>
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

          {/* Settings */}
          <div className="glass p-6 rounded-3xl shadow-sm border border-slate-200/60 dark:border-slate-800/60">
            <h3 className="text-xl font-bold flex items-center gap-2 mb-6">
              <Settings2 className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              Settings
            </h3>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4" />
                    White Tolerance
                  </label>
                  <span className="text-xs font-mono bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md">{tolerance}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={tolerance}
                  onChange={(e) => setTolerance(parseInt(e.target.value))}
                  className="w-full accent-primary"
                />
                <p className="text-xs text-slate-500 mt-2">
                  Higher tolerance removes more shadows and light grays. Lower tolerance targets only pure white.
                </p>
              </div>

              {bgImageUrl && (
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4">
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2 pb-2">
                    Subject Placement
                  </label>

                  {/* Scale */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-slate-500">Scale</span>
                      <span className="text-xs font-mono">{subjectScale.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="3.0"
                      step="0.05"
                      value={subjectScale}
                      onChange={(e) => setSubjectScale(parseFloat(e.target.value))}
                      className="w-full accent-purple-500"
                    />
                  </div>

                  {/* Position X */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-slate-500">Position X</span>
                      <span className="text-xs font-mono">{subjectX}%</span>
                    </div>
                    <input
                      type="range"
                      min="-100"
                      max="100"
                      value={subjectX}
                      onChange={(e) => setSubjectX(parseInt(e.target.value))}
                      className="w-full accent-purple-500"
                    />
                  </div>

                  {/* Position Y */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-slate-500">Position Y</span>
                      <span className="text-xs font-mono">{subjectY}%</span>
                    </div>
                    <input
                      type="range"
                      min="-100"
                      max="100"
                      value={subjectY}
                      onChange={(e) => setSubjectY(parseInt(e.target.value))}
                      className="w-full accent-purple-500"
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
                    exit={{ opacity: 0, scale: 0.9 }}
                    key={img.id}
                    className="glass rounded-3xl overflow-hidden border border-slate-200/60 shadow-sm hover:shadow-lg transition-all group flex flex-col"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 z-20 relative">
                      <p className="font-semibold text-sm truncate max-w-[70%]">{img.name}</p>
                      <div className="flex gap-1">
                        {bgImageUrl && (
                          <button
                            onClick={() => setEditingImageId(editingImageId === img.id ? null : img.id)}
                            className={`p-1.5 rounded-full transition-colors ${editingImageId === img.id ? 'bg-purple-500 text-white shadow-sm' : 'text-slate-400 hover:text-purple-600 hover:bg-purple-50'}`}
                            title="Custom Placement"
                          >
                            <SlidersHorizontal className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => removeImage(img.id)}
                          className="text-slate-400 hover:text-red-500 transition-colors p-1.5 rounded-full hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Image Previews */}
                    <div className="relative p-4 flex-1 flex items-center justify-center bg-transparent checkerboard">

                      {img.status === "processing" ? (
                        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center">
                          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                        </div>
                      ) : null}

                      {/* Show Composited or Transparent Image */}
                      {(img.compositedUrl || img.transparentUrl) ? (
                        <div className="relative w-full aspect-square flex items-center justify-center overflow-hidden rounded-xl border border-black/5 shadow-inner bg-white/50">
                          {img.compositedUrl ? (
                            <img src={img.compositedUrl} alt="Composited" className="w-full h-full object-cover" />
                          ) : (
                            <img src={img.transparentUrl!} alt="Transparent" className="max-w-full max-h-full object-contain drop-shadow-md" />
                          )}
                        </div>
                      ) : (
                        <div className="w-full aspect-square flex items-center justify-center">
                          <img src={img.originalUrl} alt="Original" className="max-w-full max-h-full object-contain" />
                        </div>
                      )}

                      {/* Individual Settings Overlay */}
                      <AnimatePresence>
                        {editingImageId === img.id && (
                          <motion.div
                            initial={{ y: "100%", opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: "100%", opacity: 0 }}
                            className="absolute inset-x-0 bottom-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl p-4 pt-5 border-t border-slate-200/50 dark:border-slate-800/50 shadow-[0_-10px_40px_-5px_rgba(0,0,0,0.1)] z-30"
                          >
                            <div className="flex justify-between items-center mb-4">
                              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Custom Placement</span>
                              {(img.customScale !== undefined || img.customX !== undefined || img.customY !== undefined) && (
                                <button
                                  onClick={() => handleCustomPlacement(img.id, subjectScale, subjectX, subjectY, true)}
                                  className="text-[10px] bg-red-50 hover:bg-red-100 text-red-600 px-2 py-1 rounded-md font-medium transition-colors"
                                >
                                  Reset to Global
                                </button>
                              )}
                            </div>

                            <div className="space-y-3">
                              {/* Scale */}
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] font-medium text-slate-500 w-8">Scale</span>
                                <input
                                  type="range" min="0.1" max="3.0" step="0.05"
                                  value={img.customScale !== undefined ? img.customScale : subjectScale}
                                  onChange={(e) => handleCustomPlacement(img.id, parseFloat(e.target.value), img.customX ?? subjectX, img.customY ?? subjectY)}
                                  className="flex-1 accent-purple-500 h-1"
                                />
                              </div>
                              {/* Position X */}
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] font-medium text-slate-500 w-8">Pos X</span>
                                <input
                                  type="range" min="-100" max="100"
                                  value={img.customX !== undefined ? img.customX : subjectX}
                                  onChange={(e) => handleCustomPlacement(img.id, img.customScale ?? subjectScale, parseInt(e.target.value), img.customY ?? subjectY)}
                                  className="flex-1 accent-purple-500 h-1"
                                />
                              </div>
                              {/* Position Y */}
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] font-medium text-slate-500 w-8">Pos Y</span>
                                <input
                                  type="range" min="-100" max="100"
                                  value={img.customY !== undefined ? img.customY : subjectY}
                                  onChange={(e) => handleCustomPlacement(img.id, img.customScale ?? subjectScale, img.customX ?? subjectX, parseInt(e.target.value))}
                                  className="flex-1 accent-purple-500 h-1"
                                />
                              </div>
                            </div>

                            <button
                              onClick={() => setEditingImageId(null)}
                              className="w-full mt-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-xs font-semibold transition-colors"
                            >
                              Close
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>

                    </div>

                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
