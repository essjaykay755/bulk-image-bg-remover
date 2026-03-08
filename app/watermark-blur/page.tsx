"use client";

import { useState, useRef, useEffect } from "react";
import { compositeImage, applyLogo, applySelectiveBlur, getPixelColor, applyAiWatermarkMask, runMaskerSolvers } from "@/lib/imageProcessing";
import Link from "next/link";
import { Upload, Image as ImageIcon, Download, Trash2, SlidersHorizontal, Settings2, FileImage, Layers, Pipette, Zap, ArrowLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import JSZip from "jszip";
import { saveAs } from "file-saver";

interface ProcessedImage {
  id: string;
  originalFile: File;
  originalUrl: string;
  compositedUrl: string | null;
  name: string;
  status: "processing" | "done" | "error";
  customScale?: number;
  customX?: number;
  customY?: number;
}

export default function Home() {
  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoScale, setLogoScale] = useState<number>(0.15);
  const [logoX, setLogoX] = useState<number>(9);
  const [logoY, setLogoY] = useState<number>(9);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [editingImageId, setEditingImageId] = useState<string | null>(null);

  // Surface Blur State
  const [blurEnabled, setBlurEnabled] = useState(false);
  const [isEyeDropperActive, setIsEyeDropperActive] = useState(false);
  const [blurTargetColor, setBlurTargetColor] = useState<{ r: number, g: number, b: number } | null>(null);
  const [blurTolerance, setBlurTolerance] = useState(20);
  const [blurAmount, setBlurAmount] = useState(5);

  // AI Watermark Masker State
  const [maskerEnabled, setMaskerEnabled] = useState(false);
  const [maskerAlpha, setMaskerAlpha] = useState(0.50);
  const [maskerScale, setMaskerScale] = useState(1.0);
  const [maskerX, setMaskerX] = useState(0);
  const [maskerY, setMaskerY] = useState(0);
  const [maskerSeam, setMaskerSeam] = useState(1);
  const [maskerBold, setMaskerBold] = useState(0);
  const [maskerBlur, setMaskerBlur] = useState(0);
  const [maskerDecay, setMaskerDecay] = useState(1.0);
  const [maskerLinear, setMaskerLinear] = useState(false);
  const [isMaskerSolving, setIsMaskerSolving] = useState(false);

  const activeEditingImage = images.find(img => img.id === editingImageId);

  // Unified image processing function
  const processImage = async (
    imgUrl: string,
    currentLogoUrl: string | null = logoUrl,
    currentLogoScale: number = logoScale,
    currentLogoX: number = logoX,
    currentLogoY: number = logoY,
    currentBlurOn: boolean = blurEnabled,
    currentBlurTarget: { r: number, g: number, b: number } | null = blurTargetColor,
    currentBlurTol: number = blurTolerance,
    currentBlurAmt: number = blurAmount,
    currentMaskerOn: boolean = maskerEnabled,
    currentMaskerOpts = {
      alpha: maskerAlpha, scale: maskerScale, x: maskerX, y: maskerY,
      boldness: maskerBold, blur: maskerBlur, seam: maskerSeam,
      decay: maskerDecay, linearMath: maskerLinear
    }
  ): Promise<string> => {
    let resultUrl = imgUrl;

    if (currentMaskerOn) {
      resultUrl = await applyAiWatermarkMask(resultUrl, currentMaskerOpts);
    }
    if (currentBlurOn && currentBlurTarget) {
      resultUrl = await applySelectiveBlur(resultUrl, currentBlurTarget, currentBlurTol, currentBlurAmt);
    }
    if (currentLogoUrl) {
      resultUrl = await applyLogo(resultUrl, currentLogoUrl, currentLogoScale, currentLogoX, currentLogoY);
    }

    return resultUrl;
  };

  // File Input Refs
  const foregroundInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Handle Foreground Images Upload
  const handleForegroundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;

    setIsProcessingAll(true);
    const files = Array.from(e.target.files);

    const newImages: ProcessedImage[] = files.map(file => ({
      id: Math.random().toString(36).substring(7),
      originalFile: file,
      originalUrl: URL.createObjectURL(file),
      compositedUrl: null,
      name: file.name,
      status: "processing"
    }));

    setImages(prev => [...prev, ...newImages]);

    for (const img of newImages) {
      try {
        const compositedUrl = await processImage(img.originalUrl);
        setImages(prev => prev.map(p =>
          p.id === img.id ? { ...p, compositedUrl: compositedUrl === img.originalUrl ? null : compositedUrl, status: "done" } : p
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

  const clearLogo = async () => {
    setLogoFile(null);
    setLogoUrl(null);
    setImages(prev => prev.map(img => ({ ...img, status: "processing" })));
    for (const img of images) {
      try {
        const compositedUrl = await processImage(img.originalUrl, null);
        setImages(prev => prev.map(p => p.id === img.id ? { ...p, compositedUrl: compositedUrl === img.originalUrl ? null : compositedUrl, status: "done" } : p));
      } catch (e) {
        setImages(prev => prev.map(p => p.id === img.id ? { ...p, status: "error" } : p));
      }
    }
  };

  // Handle Logo Upload
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const file = e.target.files[0];
    const url = URL.createObjectURL(file);
    setLogoFile(file);
    setLogoUrl(url);

    setImages(prev => prev.map(img => ({ ...img, status: "processing" })));
    for (const img of images) {
      try {
        const compositedUrl = await processImage(img.originalUrl, url);
        setImages(prev => prev.map(p => p.id === img.id ? { ...p, compositedUrl: compositedUrl === img.originalUrl ? null : compositedUrl, status: "done" } : p));
      } catch (error) {
        setImages(prev => prev.map(p => p.id === img.id ? { ...p, status: "error" } : p));
      }
    }
  };

  const downloadAll = async () => {
    const zip = new JSZip();
    const compositedFolder = zip.folder("Final_Images");

    for (const img of images) {
      const targetUrl = img.compositedUrl || img.originalUrl;
      if (targetUrl && compositedFolder) {
        const response = await fetch(targetUrl);
        const blob = await response.blob();
        const ext = blob.type === "image/png" ? "png" : "jpg";
        compositedFolder.file(`${img.name.split('.')[0]}_final.${ext}`, blob);
      }
    }

    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, "processed_images.zip");
  };

  // Trigger re-composite when settings change
  useEffect(() => {
    if (images.length === 0) return;
    const recomposite = async () => {
      setImages(prev => prev.map(img => ({ ...img, status: "processing" })));
      for (const img of images) {
        try {
          const compositedUrl = await processImage(img.originalUrl);
          setImages(prev => prev.map(p =>
            p.id === img.id ? { ...p, compositedUrl: compositedUrl === img.originalUrl ? null : compositedUrl, status: "done" } : p
          ));
        } catch (e) {
          setImages(prev => prev.map(p =>
            p.id === img.id ? { ...p, status: "error" } : p
          ));
        }
      }
    };
    const timeout = setTimeout(recomposite, 200);
    return () => clearTimeout(timeout);
  }, [
    images.length > 0, logoUrl, logoScale, logoX, logoY,
    blurEnabled, blurTargetColor, blurTolerance, blurAmount,
    maskerEnabled, maskerAlpha, maskerScale, maskerX, maskerY,
    maskerSeam, maskerBold, maskerBlur, maskerDecay, maskerLinear
  ]);

  // Remove individual image
  const removeImage = (id: string) => {
    setImages(prev => {
      const filtered = prev.filter(img => img.id !== id);
      if (filtered.length === 0) setEditingImageId(null);
      return filtered;
    });
  };

  const handleCanvasClick = async (e: React.MouseEvent<HTMLImageElement>, targetImg?: ProcessedImage) => {
    if (!isEyeDropperActive) return;
    e.stopPropagation();

    const imgObj = targetImg || activeEditingImage;
    if (!imgObj) return;

    const imgElement = e.currentTarget;
    const rect = imgElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const scaleX = imgElement.naturalWidth / rect.width;
    const scaleY = imgElement.naturalHeight / rect.height;

    const imageX = Math.round(x * scaleX);
    const imageY = Math.round(y * scaleY);

    try {
      const color = await getPixelColor(imgObj.originalUrl, imageX, imageY, imgElement.naturalWidth, imgElement.naturalHeight);
      setBlurTargetColor(color);
      setIsEyeDropperActive(false); // turn off after picking
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className={`min-h-[100dvh] bg-background text-foreground font-sans selection:bg-accent/30 selection:text-accent-foreground p-6 sm:p-8 md:p-12 transition-colors duration-500 ${isEyeDropperActive ? '[&_*]:cursor-crosshair' : ''}`}>
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
                Persistent watermarking and selective surface blurs.
              </p>
            </div>

            {images.length > 0 && (
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
              <div
                onClick={() => foregroundInputRef.current?.click()}
                className="group border border-dashed border-muted-foreground/30 bg-muted/5 rounded-[1.5rem] p-10 flex flex-col items-center justify-center text-center cursor-pointer hover:border-accent hover:bg-accent/5 transition-all duration-300"
              >
                <input
                  ref={foregroundInputRef}
                  type="file" multiple accept="image/*" className="hidden"
                  onChange={handleForegroundUpload}
                />
                <Upload className="w-8 h-8 mb-4 text-muted-foreground group-hover:text-accent transition-colors" />
                <p className="font-semibold text-foreground">Drop product images</p>
                <p className="text-sm text-muted-foreground mt-2 font-medium">PNG, JPG</p>
              </div>
            </div>


            <div className="liquid-glass p-8 rounded-[2.5rem] transition-all">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold flex items-center gap-3 text-foreground">
                  <ImageIcon className="w-5 h-5 text-accent" />
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

            {/* Selective Surface Blur */}
            <div className="liquid-glass p-8 rounded-[2.5rem] transition-all">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold flex items-center gap-3 text-foreground">
                  <Layers className="w-5 h-5 text-accent" />
                  Surface Blur
                </h3>
                <button
                  onClick={() => setBlurEnabled(!blurEnabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${blurEnabled ? 'bg-accent' : 'bg-muted-foreground/30'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${blurEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              {blurEnabled && (
                <div className="space-y-6 pt-4 border-t border-border/50">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => setIsEyeDropperActive(!isEyeDropperActive)}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-sm transition-all ${isEyeDropperActive ? 'bg-accent text-accent-foreground shadow-lg shadow-accent/25' : 'bg-muted/30 text-foreground hover:bg-muted/50 border border-border'}`}
                    >
                      <Pipette className="w-4 h-4" />
                      {isEyeDropperActive ? 'Click Image to Pick' : 'Pick Target Color'}
                    </button>
                    {blurTargetColor && (
                      <div
                        className="w-12 h-12 rounded-xl shadow-inner border border-border flex-shrink-0"
                        style={{ backgroundColor: `rgb(${blurTargetColor.r},${blurTargetColor.g},${blurTargetColor.b})` }}
                      ></div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs font-medium text-foreground">
                      <span>Color Tolerance</span>
                      <span>{blurTolerance}</span>
                    </div>
                    <input
                      type="range" min="1" max="100"
                      value={blurTolerance}
                      onChange={(e) => setBlurTolerance(Number(e.target.value))}
                      className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-foreground"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs font-medium text-foreground">
                      <span>Blur Amount</span>
                      <span>{blurAmount}px</span>
                    </div>
                    <input
                      type="range" min="1" max="20"
                      value={blurAmount}
                      onChange={(e) => setBlurAmount(Number(e.target.value))}
                      className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-foreground"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* AI Watermark Masker */}
            <div className="liquid-glass p-8 rounded-[2.5rem] transition-all">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold flex items-center gap-3 text-foreground">
                  <Zap className="w-5 h-5 text-accent" />
                  AI Masker
                </h3>
                <button
                  onClick={() => setMaskerEnabled(!maskerEnabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${maskerEnabled ? 'bg-accent' : 'bg-muted-foreground/30'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${maskerEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              {maskerEnabled && (
                <div className="space-y-6 pt-4 border-t border-border/50">
                  <button
                    onClick={async () => {
                      const imgToProcess = activeEditingImage || images[0];
                      if (!imgToProcess) return;
                      setIsMaskerSolving(true);
                      try {
                        const result = await runMaskerSolvers(imgToProcess.originalUrl);
                        setMaskerAlpha(result.alpha);
                        setMaskerLinear(result.linear);
                        setMaskerX(result.x);
                        setMaskerY(result.y);
                      } catch (e) {
                        console.error(e);
                      } finally {
                        setIsMaskerSolving(false);
                      }
                    }}
                    disabled={isMaskerSolving || images.length === 0}
                    className="w-full flex justify-center items-center gap-2 py-3 bg-foreground text-background rounded-xl font-bold shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {isMaskerSolving ? (
                      <span className="w-5 h-5 border-2 border-background border-t-transparent rounded-full animate-spin"></span>
                    ) : (
                      <Zap className="w-4 h-4" />
                    )}
                    {isMaskerSolving ? 'Solving...' : 'Auto Detect (Magic Solver)'}
                  </button>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs font-medium text-foreground">
                      <span>Opacity Adjust</span>
                      <span className="font-mono">{maskerAlpha.toFixed(2)}</span>
                    </div>
                    <input
                      type="range" min="0" max="1" step="0.01"
                      value={maskerAlpha}
                      onChange={(e) => setMaskerAlpha(Number(e.target.value))}
                      className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-foreground"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs font-medium text-foreground">
                      <span>Seam Healing</span>
                      <span className="font-mono">{maskerSeam}px</span>
                    </div>
                    <input
                      type="range" min="0" max="10" step="1"
                      value={maskerSeam}
                      onChange={(e) => setMaskerSeam(Number(e.target.value))}
                      className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-foreground"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs font-medium text-foreground">
                      <span>Scale</span>
                      <span className="font-mono">{maskerScale.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range" min="0.5" max="2" step="0.01"
                      value={maskerScale}
                      onChange={(e) => setMaskerScale(Number(e.target.value))}
                      className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-foreground"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs font-medium text-foreground">
                      <span>Offset X</span>
                      <span className="font-mono">{maskerX}px</span>
                    </div>
                    <input
                      type="range" min="-100" max="100" step="1"
                      value={maskerX}
                      onChange={(e) => setMaskerX(Number(e.target.value))}
                      className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-foreground"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs font-medium text-foreground">
                      <span>Offset Y</span>
                      <span className="font-mono">{maskerY}px</span>
                    </div>
                    <input
                      type="range" min="-100" max="100" step="1"
                      value={maskerY}
                      onChange={(e) => setMaskerY(Number(e.target.value))}
                      className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-foreground"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs font-medium text-foreground">Linear Color Math</span>
                    <button
                      onClick={() => setMaskerLinear(!maskerLinear)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${maskerLinear ? 'bg-accent' : 'bg-muted-foreground/30'}`}
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${maskerLinear ? 'translate-x-5' : 'translate-x-1'}`} />
                    </button>
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
                        <button
                          onClick={() => removeImage(img.id)}
                          className="text-muted-foreground hover:text-red-500 transition-colors p-2 rounded-full hover:bg-red-50/50 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      {/* Image Previews */}
                      <div
                        className={`relative flex-1 flex items-center justify-center bg-transparent checkerboard ${!isEyeDropperActive && 'cursor-pointer'}`}
                        onClick={() => !isEyeDropperActive && setEditingImageId(img.id)}
                      >
                        {img.status === "processing" ? (
                          <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center z-10 pointer-events-none">
                            <div className="w-8 h-8 border-2 border-muted border-t-foreground rounded-full animate-spin"></div>
                          </div>
                        ) : null}

                        {/* Show Composited or Original Image */}
                        {img.compositedUrl ? (
                          <div className="relative w-full aspect-square flex items-center justify-center overflow-hidden">
                            <img src={img.compositedUrl} alt="Composited" className={`w-full h-full object-cover transition-opacity ${isEyeDropperActive ? 'hover:opacity-80' : ''}`} onClick={(e) => { if (isEyeDropperActive) handleCanvasClick(e, img); }} />
                          </div>
                        ) : (
                          <div className="w-[85%] aspect-square flex items-center justify-center">
                            <img src={img.originalUrl} alt="Original" className={`w-full h-full object-contain transition-opacity ${isEyeDropperActive ? 'hover:opacity-80' : ''}`} onClick={(e) => { if (isEyeDropperActive) handleCanvasClick(e, img); }} />
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

      {/* Editor Modal */}
      <AnimatePresence>
        {
          activeEditingImage && (
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
                  {activeEditingImage && activeEditingImage.status === "processing" ? (
                    <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center z-10">
                      <div className="w-10 h-10 border-4 border-muted border-t-foreground rounded-full animate-spin"></div>
                    </div>
                  ) : null}

                  {activeEditingImage && activeEditingImage.compositedUrl ? (
                    <div className="relative w-full max-w-2xl aspect-square flex items-center justify-center">
                      <img src={activeEditingImage.compositedUrl} alt="Composited" className={`w-full h-full object-contain drop-shadow-2xl ${isEyeDropperActive ? 'cursor-crosshair' : ''}`} onClick={handleCanvasClick} />
                    </div>
                  ) : activeEditingImage ? (
                    <div className="w-full max-w-2xl aspect-square flex items-center justify-center">
                      <img src={activeEditingImage.originalUrl} alt="Original" className={`w-[85%] h-[85%] object-contain drop-shadow-2xl ${isEyeDropperActive ? 'cursor-crosshair' : ''}`} onClick={handleCanvasClick} />
                    </div>
                  ) : null}
                </div>

                {/* Right Side: Settings */}
                <div className="flex-1 p-8 lg:p-10 flex flex-col bg-background/50">
                  <div className="mb-8">
                    <h2 className="text-2xl font-bold tracking-tight text-foreground mb-2">Adjust Subject</h2>
                    <p className="text-sm text-muted-foreground truncate">{activeEditingImage?.name}</p>
                  </div>

                  <div className="space-y-8 flex-1">
                    <div className="flex justify-between items-center pb-4 border-b border-border/50">
                      <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Image Details</span>
                    </div>
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
