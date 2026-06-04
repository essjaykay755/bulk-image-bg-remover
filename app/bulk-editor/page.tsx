"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  FileImage,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import JSZip from "jszip";
import { saveAs } from "file-saver";

const BATCH_SIZE = 5;
const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type OutputFormat = "image/png" | "image/jpeg" | "image/webp";

interface WritableFileTarget {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

interface WritableDirectoryTarget {
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<WritableDirectoryTarget>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<WritableFileTarget>;
}

interface WindowWithDirectoryPicker extends Window {
  showDirectoryPicker?: () => Promise<WritableDirectoryTarget>;
}

interface ImageAdjustments {
  brightness: number;
  contrast: number;
  exposure: number;
  highlights: number;
  shadows: number;
  temperature: number;
  tint: number;
  saturation: number;
  vibrance: number;
  hue: number;
  gamma: number;
  sharpness: number;
  grayscale: number;
  sepia: number;
}

interface EditableImage {
  id: string;
  originalFile: File;
  originalUrl: string;
  editedUrl: string | null;
  name: string;
  status: "idle" | "processing" | "done" | "error";
  relativePath?: string;
}

const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  brightness: 0,
  contrast: 0,
  exposure: 0,
  highlights: 0,
  shadows: 0,
  temperature: 0,
  tint: 0,
  saturation: 0,
  vibrance: 0,
  hue: 0,
  gamma: 1,
  sharpness: 0,
  grayscale: 0,
  sepia: 0,
};

const PRESETS: Array<{ label: string; values: Partial<ImageAdjustments> }> = [
  { label: "Clean Product", values: { brightness: 8, contrast: 10, highlights: -12, shadows: 8, saturation: 6, sharpness: 18 } },
  { label: "Warm Studio", values: { exposure: 0.15, temperature: 14, tint: 3, contrast: 8, vibrance: 12 } },
  { label: "Crisp Catalog", values: { contrast: 16, shadows: -6, highlights: -8, saturation: 4, sharpness: 28 } },
  { label: "Soft Natural", values: { contrast: -6, highlights: -18, shadows: 14, saturation: -4, temperature: 5 } },
];

const ADJUSTMENT_SECTIONS: Array<{
  title: string;
  controls: Array<{
    key: keyof ImageAdjustments;
    label: string;
    min: number;
    max: number;
    step: number;
    unit?: string;
  }>;
}> = [
  {
    title: "Light",
    controls: [
      { key: "brightness", label: "Brightness", min: -100, max: 100, step: 1 },
      { key: "contrast", label: "Contrast", min: -100, max: 100, step: 1 },
      { key: "exposure", label: "Exposure", min: -2, max: 2, step: 0.05, unit: "EV" },
      { key: "highlights", label: "Highlights", min: -100, max: 100, step: 1 },
      { key: "shadows", label: "Shadows", min: -100, max: 100, step: 1 },
      { key: "gamma", label: "Gamma", min: 0.5, max: 2, step: 0.01 },
    ],
  },
  {
    title: "Color",
    controls: [
      { key: "temperature", label: "White Balance", min: -100, max: 100, step: 1 },
      { key: "tint", label: "Tint", min: -100, max: 100, step: 1 },
      { key: "saturation", label: "Saturation", min: -100, max: 100, step: 1 },
      { key: "vibrance", label: "Vibrance", min: -100, max: 100, step: 1 },
      { key: "hue", label: "Hue", min: -180, max: 180, step: 1, unit: "deg" },
      { key: "sepia", label: "Sepia", min: 0, max: 100, step: 1 },
    ],
  },
  {
    title: "Detail",
    controls: [
      { key: "sharpness", label: "Sharpness", min: 0, max: 100, step: 1 },
      { key: "grayscale", label: "Black & White", min: 0, max: 100, step: 1 },
    ],
  },
];

const directoryInputProps = {
  webkitdirectory: "",
  directory: "",
} as React.InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory: string;
  directory: string;
};

const clamp = (value: number, min = 0, max = 255) => Math.max(min, Math.min(max, value));

const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("Failed to load image"));
  img.src = src;
});

const rgbToHsl = (r: number, g: number, b: number) => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }

  return { h, s, l };
};

const hueToRgb = (p: number, q: number, t: number) => {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
};

const hslToRgb = (h: number, s: number, l: number) => {
  let r = l;
  let g = l;
  let b = l;

  if (s !== 0) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }

  return { r: r * 255, g: g * 255, b: b * 255 };
};

const hasAdjustments = (adjustments: ImageAdjustments) => (
  Object.entries(DEFAULT_ADJUSTMENTS).some(([key, value]) => (
    adjustments[key as keyof ImageAdjustments] !== value
  ))
);

const applySharpness = (data: Uint8ClampedArray, width: number, height: number, amount: number) => {
  if (amount <= 0) return data;

  const source = new Uint8ClampedArray(data);
  const strength = amount / 100;
  const center = 1 + 4 * strength;
  const side = -strength;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const left = idx - 4;
      const right = idx + 4;
      const up = idx - width * 4;
      const down = idx + width * 4;

      for (let c = 0; c < 3; c++) {
        data[idx + c] = clamp(
          source[idx + c] * center +
          source[left + c] * side +
          source[right + c] * side +
          source[up + c] * side +
          source[down + c] * side
        );
      }
    }
  }

  return data;
};

const applyImageAdjustments = async (
  src: string,
  adjustments: ImageAdjustments,
  outputFormat: OutputFormat,
  quality: number
) => {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) throw new Error("Failed to get canvas context");

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const exposureFactor = Math.pow(2, adjustments.exposure);
  const contrastFactor = (259 * (adjustments.contrast + 255)) / (255 * (259 - adjustments.contrast));
  const saturationFactor = 1 + adjustments.saturation / 100;
  const vibranceAmount = adjustments.vibrance / 100;
  const gamma = Math.max(0.1, adjustments.gamma);
  const hueShift = adjustments.hue / 360;
  const grayscaleMix = adjustments.grayscale / 100;
  const sepiaMix = adjustments.sepia / 100;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] * exposureFactor;
    let g = data[i + 1] * exposureFactor;
    let b = data[i + 2] * exposureFactor;

    const lumaBeforeTone = r * 0.299 + g * 0.587 + b * 0.114;
    const highlightWeight = Math.pow(lumaBeforeTone / 255, 2);
    const shadowWeight = Math.pow(1 - lumaBeforeTone / 255, 2);
    r += adjustments.highlights * highlightWeight + adjustments.shadows * shadowWeight;
    g += adjustments.highlights * highlightWeight + adjustments.shadows * shadowWeight;
    b += adjustments.highlights * highlightWeight + adjustments.shadows * shadowWeight;

    r += adjustments.brightness;
    g += adjustments.brightness;
    b += adjustments.brightness;

    r = contrastFactor * (r - 128) + 128;
    g = contrastFactor * (g - 128) + 128;
    b = contrastFactor * (b - 128) + 128;

    r = 255 * Math.pow(clamp(r) / 255, 1 / gamma);
    g = 255 * Math.pow(clamp(g) / 255, 1 / gamma);
    b = 255 * Math.pow(clamp(b) / 255, 1 / gamma);

    r += adjustments.temperature * 0.65;
    b -= adjustments.temperature * 0.65;
    r += adjustments.tint * 0.35;
    b += adjustments.tint * 0.35;
    g -= adjustments.tint * 0.45;

    const luma = r * 0.299 + g * 0.587 + b * 0.114;
    r = luma + (r - luma) * saturationFactor;
    g = luma + (g - luma) * saturationFactor;
    b = luma + (b - luma) * saturationFactor;

    const maxChannel = Math.max(r, g, b);
    const vibranceWeight = (255 - Math.abs(maxChannel - luma)) / 255;
    r = luma + (r - luma) * (1 + vibranceAmount * vibranceWeight);
    g = luma + (g - luma) * (1 + vibranceAmount * vibranceWeight);
    b = luma + (b - luma) * (1 + vibranceAmount * vibranceWeight);

    if (adjustments.hue !== 0) {
      const hsl = rgbToHsl(clamp(r), clamp(g), clamp(b));
      const shifted = hslToRgb((hsl.h + hueShift + 1) % 1, hsl.s, hsl.l);
      r = shifted.r;
      g = shifted.g;
      b = shifted.b;
    }

    if (sepiaMix > 0) {
      const sr = r * 0.393 + g * 0.769 + b * 0.189;
      const sg = r * 0.349 + g * 0.686 + b * 0.168;
      const sb = r * 0.272 + g * 0.534 + b * 0.131;
      r = r * (1 - sepiaMix) + sr * sepiaMix;
      g = g * (1 - sepiaMix) + sg * sepiaMix;
      b = b * (1 - sepiaMix) + sb * sepiaMix;
    }

    if (grayscaleMix > 0) {
      const gray = r * 0.299 + g * 0.587 + b * 0.114;
      r = r * (1 - grayscaleMix) + gray * grayscaleMix;
      g = g * (1 - grayscaleMix) + gray * grayscaleMix;
      b = b * (1 - grayscaleMix) + gray * grayscaleMix;
    }

    data[i] = clamp(r);
    data[i + 1] = clamp(g);
    data[i + 2] = clamp(b);
  }

  applySharpness(data, canvas.width, canvas.height, adjustments.sharpness);
  ctx.putImageData(imageData, 0, 0);

  return new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to create edited image"));
        return;
      }
      resolve(URL.createObjectURL(blob));
    }, outputFormat, quality);
  });
};

const extensionForFormat = (format: OutputFormat) => {
  if (format === "image/jpeg") return "jpg";
  if (format === "image/webp") return "webp";
  return "png";
};

const supportedOutputFormatForFile = (file: File): OutputFormat => {
  if (file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp") {
    return file.type;
  }
  return "image/png";
};

const replaceExtension = (path: string, extension: string) => {
  const slashIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dotIndex = path.lastIndexOf(".");
  if (dotIndex > slashIndex) {
    return `${path.slice(0, dotIndex)}.${extension}`;
  }
  return `${path}.${extension}`;
};

export default function BulkEditorPage() {
  const [images, setImages] = useState<EditableImage[]>([]);
  const [adjustments, setAdjustments] = useState<ImageAdjustments>(DEFAULT_ADJUSTMENTS);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [zipFileName, setZipFileName] = useState("edited_images");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("image/png");
  const [quality, setQuality] = useState(0.92);
  const [batchProgress, setBatchProgress] = useState<{
    label: string;
    current: number;
    total: number;
    currentFile: string;
  } | null>(null);
  const [zipProgress, setZipProgress] = useState<{
    label: string;
    current: number;
    total: number;
    currentFolder: string;
    currentFile: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<EditableImage[]>([]);
  useEffect(() => { imagesRef.current = images; }, [images]);

  const selectedImage = useMemo(
    () => images.find((img) => img.id === selectedImageId) ?? images[0] ?? null,
    [images, selectedImageId]
  );

  useEffect(() => {
    if (!selectedImage) {
      return;
    }

    let didCancel = false;
    const timeout = window.setTimeout(async () => {
      try {
        const result = await applyImageAdjustments(
          selectedImage.originalUrl,
          adjustments,
          outputFormat,
          quality
        );
        if (didCancel) {
          URL.revokeObjectURL(result);
          return;
        }
        setPreviewUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return result;
        });
      } catch (error) {
        console.error("Preview render failed", error);
      }
    }, 180);

    return () => {
      didCancel = true;
      window.clearTimeout(timeout);
    };
  }, [selectedImage, adjustments, outputFormat, quality]);

  const updateAdjustment = (key: keyof ImageAdjustments, value: number) => {
    setAdjustments((prev) => ({ ...prev, [key]: value }));
  };

  const addFiles = (fileList: FileList, preservePaths: boolean) => {
    const files = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;

    const newImages: EditableImage[] = files.map((file) => {
      const relativePath = preservePaths && file.webkitRelativePath
        ? file.webkitRelativePath.split("/").slice(1).join("/") || file.name
        : undefined;

      return {
        id: Math.random().toString(36).slice(2),
        originalFile: file,
        originalUrl: URL.createObjectURL(file),
        editedUrl: null,
        name: file.name,
        status: "idle",
        relativePath,
      };
    });

    setImages((prev) => [...prev, ...newImages]);
    setSelectedImageId((current) => current ?? newImages[0].id);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files, false);
    event.target.value = "";
  };

  const handleFolderUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files, true);
    event.target.value = "";
  };

  const processOne = async (img: EditableImage, format = outputFormat) => {
    const editedUrl = await applyImageAdjustments(
      img.originalUrl,
      adjustments,
      format,
      quality
    );
    return editedUrl;
  };

  const applyToAll = async () => {
    const currentImages = imagesRef.current;
    if (!currentImages.length) return;

    setIsProcessingAll(true);
    setBatchProgress({ label: "Applying Adjustments", current: 0, total: currentImages.length, currentFile: "" });
    setImages((prev) => prev.map((img) => ({ ...img, status: "processing" })));

    for (let i = 0; i < currentImages.length; i += BATCH_SIZE) {
      const batch = currentImages.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(batch.map(async (img, index) => {
        setBatchProgress({
          label: "Applying Adjustments",
          current: i + index,
          total: currentImages.length,
          currentFile: img.relativePath || img.name,
        });
        await yieldToMain();
        const editedUrl = await processOne(img);
        return { id: img.id, editedUrl };
      }));

      setImages((prev) => prev.map((img) => {
        const result = results.find((item) => item.status === "fulfilled" && item.value.id === img.id);
        const failed = results.find((item, index) => item.status === "rejected" && batch[index].id === img.id);
        if (result && result.status === "fulfilled") {
          if (img.editedUrl) URL.revokeObjectURL(img.editedUrl);
          return { ...img, editedUrl: result.value.editedUrl, status: "done" };
        }
        if (failed) return { ...img, status: "error" };
        return img;
      }));

      setBatchProgress({
        label: "Applying Adjustments",
        current: Math.min(i + batch.length, currentImages.length),
        total: currentImages.length,
        currentFile: batch[batch.length - 1]?.relativePath || batch[batch.length - 1]?.name || "",
      });
    }

    setBatchProgress(null);
    setIsProcessingAll(false);
  };

  const resetAdjustments = () => setAdjustments(DEFAULT_ADJUSTMENTS);

  const applyPreset = (values: Partial<ImageAdjustments>) => {
    setAdjustments({ ...DEFAULT_ADJUSTMENTS, ...values });
  };

  const removeImage = (id: string) => {
    setImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) {
        URL.revokeObjectURL(target.originalUrl);
        if (target.editedUrl) URL.revokeObjectURL(target.editedUrl);
      }
      const next = prev.filter((img) => img.id !== id);
      if (selectedImageId === id) setSelectedImageId(next[0]?.id ?? null);
      return next;
    });
  };

  const clearAll = () => {
    images.forEach((img) => {
      URL.revokeObjectURL(img.originalUrl);
      if (img.editedUrl) URL.revokeObjectURL(img.editedUrl);
    });
    setImages([]);
    setSelectedImageId(null);
  };

  const downloadAll = async () => {
    const currentImages = imagesRef.current;
    if (!currentImages.length) return;

    setZipProgress({ label: "Creating ZIP", current: 0, total: currentImages.length, currentFolder: "", currentFile: "" });
    const zip = new JSZip();
    const extension = extensionForFormat(outputFormat);

    for (let i = 0; i < currentImages.length; i++) {
      const img = currentImages[i];
      const sourceUrl = await processOne(img);
      const outputPath = replaceExtension(img.relativePath || img.name, extension);
      const folderName = outputPath.includes("/") ? outputPath.split("/").slice(0, -1).join("/") : "Edited_Images";
      const fileName = outputPath.split("/").pop() || replaceExtension(img.name, extension);

      setZipProgress({
        label: "Creating ZIP",
        current: i,
        total: currentImages.length,
        currentFolder: folderName,
        currentFile: fileName,
      });

      const blob = await fetch(sourceUrl).then((response) => response.blob());
      if (img.relativePath) {
        zip.file(outputPath, blob);
      } else {
        zip.folder("Edited_Images")!.file(fileName, blob);
      }

      URL.revokeObjectURL(sourceUrl);
      await yieldToMain();
      setZipProgress({
        label: "Creating ZIP",
        current: i + 1,
        total: currentImages.length,
        currentFolder: folderName,
        currentFile: fileName,
      });
    }

    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `${zipFileName || "edited_images"}.zip`);
    setZipProgress(null);
  };

  const getWritableFileHandle = async (root: WritableDirectoryTarget, path: string) => {
    const segments = path.split("/").filter(Boolean);
    const fileName = segments.pop();
    if (!fileName) throw new Error("Missing file name");

    let directory = root;
    for (const segment of segments) {
      directory = await directory.getDirectoryHandle(segment, { create: true });
    }

    return directory.getFileHandle(fileName, { create: true });
  };

  const replaceOriginals = async () => {
    const currentImages = imagesRef.current;
    if (!currentImages.length) return;

    const pickerWindow = window as WindowWithDirectoryPicker;
    if (!pickerWindow.showDirectoryPicker) {
      alert("Your browser does not support direct folder writing. Use Export ZIP instead.");
      return;
    }

    const confirmed = window.confirm(
      "This will overwrite matching files in the folder you choose. Pick the same source folder if you want to replace the originals."
    );
    if (!confirmed) return;

    try {
      const root = await pickerWindow.showDirectoryPicker();
      setZipProgress({ label: "Replacing Originals", current: 0, total: currentImages.length, currentFolder: "", currentFile: "" });

      for (let i = 0; i < currentImages.length; i++) {
        const img = currentImages[i];
        const outputPath = img.relativePath || img.name;
        const folderName = outputPath.includes("/") ? outputPath.split("/").slice(0, -1).join("/") : "Selected folder";
        const fileName = outputPath.split("/").pop() || img.name;
        const format = supportedOutputFormatForFile(img.originalFile);

        setZipProgress({
          label: "Replacing Originals",
          current: i,
          total: currentImages.length,
          currentFolder: folderName,
          currentFile: fileName,
        });

        const sourceUrl = await processOne(img, format);
        const blob = await fetch(sourceUrl).then((response) => response.blob());
        const fileHandle = await getWritableFileHandle(root, outputPath);
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        URL.revokeObjectURL(sourceUrl);
        await yieldToMain();

        setZipProgress({
          label: "Replacing Originals",
          current: i + 1,
          total: currentImages.length,
          currentFolder: folderName,
          currentFile: fileName,
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      console.error("Replacing originals failed", error);
      alert("Could not replace the original files. Check folder permission and try again.");
    } finally {
      setZipProgress(null);
    }
  };

  const hasAnyEditedImage = images.some((img) => img.editedUrl);
  const previewSrc = selectedImage ? previewUrl || selectedImage.editedUrl || selectedImage.originalUrl : null;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground font-sans selection:bg-accent/30 selection:text-accent-foreground p-6 sm:p-8 md:p-12 transition-colors duration-500">
      <div className="max-w-[1500px] mx-auto">
        <header className="mb-12 space-y-8">
          <Link href="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-all group font-semibold text-sm">
            <div className="p-2 rounded-xl bg-muted/50 border border-border group-hover:bg-accent group-hover:text-accent-foreground group-hover:border-accent transition-all">
              <ArrowLeft className="w-4 h-4" />
            </div>
            Back to Dashboard
          </Link>

          <div className="flex flex-col lg:flex-row items-start lg:items-end justify-between gap-6">
            <div>
              <h1 className="text-4xl md:text-6xl font-extrabold tracking-tighter leading-none text-foreground mb-3">
                Bulk Image<span className="text-muted-foreground/50 font-light"> Editor</span>
              </h1>
              <p className="text-muted-foreground text-base md:text-lg max-w-[70ch] leading-relaxed">
                Browser-only batch adjustments for light, white balance, tint, color, detail, and export-ready image sets.
              </p>
            </div>

            {images.length > 0 && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
                <input
                  type="text"
                  value={zipFileName}
                  onChange={(event) => setZipFileName(event.target.value)}
                  placeholder="Custom ZIP Name"
                  className="px-6 py-3.5 bg-background border border-border rounded-full text-sm font-medium focus:outline-accent focus:ring-2 focus:ring-accent/20 min-w-[200px]"
                />
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={downloadAll}
                  disabled={isProcessingAll}
                  className="group flex items-center justify-center gap-3 px-8 py-3.5 bg-foreground text-background rounded-full font-semibold shadow-xl hover:shadow-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download className="w-5 h-5 group-hover:translate-y-0.5 transition-transform" />
                  Export ZIP
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={replaceOriginals}
                  disabled={isProcessingAll}
                  className="group flex items-center justify-center gap-3 px-8 py-3.5 bg-emerald-500 text-white rounded-full font-semibold shadow-xl shadow-emerald-500/20 hover:bg-emerald-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save className="w-5 h-5" />
                  Replace Originals
                </motion.button>
              </div>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)_320px] gap-8 items-start">
          <aside className="space-y-6">
            <div className="liquid-glass p-8 rounded-[2.5rem] transition-all">
              <h3 className="text-lg font-bold flex items-center gap-3 mb-6 text-foreground">
                <FileImage className="w-5 h-5 text-emerald-500" />
                Source Intake
              </h3>
              <div className="grid grid-cols-1 gap-3">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="group border border-dashed border-muted-foreground/30 bg-muted/5 rounded-[1.5rem] p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:border-emerald-500 hover:bg-emerald-500/5 transition-all duration-300"
                >
                  <input ref={fileInputRef} type="file" multiple accept="image/*" className="hidden" onChange={handleFileUpload} />
                  <Upload className="w-7 h-7 mb-3 text-muted-foreground group-hover:text-emerald-500 transition-colors" />
                  <p className="font-semibold text-foreground text-sm">Upload Files</p>
                  <p className="text-xs text-muted-foreground mt-1.5 font-medium">Select individual images</p>
                </div>

                <div
                  onClick={() => folderInputRef.current?.click()}
                  className="group border border-dashed border-muted-foreground/30 bg-muted/5 rounded-[1.5rem] p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:border-emerald-500 hover:bg-emerald-500/5 transition-all duration-300"
                >
                  <input
                    ref={folderInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFolderUpload}
                    {...directoryInputProps}
                  />
                  <FolderOpen className="w-7 h-7 mb-3 text-muted-foreground group-hover:text-emerald-500 transition-colors" />
                  <p className="font-semibold text-foreground text-sm">Upload Folder</p>
                  <p className="text-xs text-muted-foreground mt-1.5 font-medium">Preserves paths in ZIP</p>
                </div>
              </div>

              {images.length > 0 && (
                <div className="mt-5 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{images.length} images loaded</span>
                  <button onClick={clearAll} className="font-semibold text-red-500 hover:text-red-400 transition-colors">
                    Clear All
                  </button>
                </div>
              )}
            </div>

            <div className="liquid-glass p-8 rounded-[2.5rem] transition-all">
              <h3 className="text-lg font-bold flex items-center gap-3 mb-6 text-foreground">
                <Wand2 className="w-5 h-5 text-emerald-500" />
                Presets
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => applyPreset(preset.values)}
                    className="px-4 py-3 rounded-2xl bg-muted/40 border border-border text-sm font-semibold text-foreground hover:border-emerald-500 hover:bg-emerald-500/10 transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="liquid-glass p-8 rounded-[2.5rem] transition-all space-y-5">
              <h3 className="text-lg font-bold flex items-center gap-3 text-foreground">
                <Download className="w-5 h-5 text-emerald-500" />
                Output
              </h3>
              <div className="space-y-3">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Format</label>
                <select
                  value={outputFormat}
                  onChange={(event) => setOutputFormat(event.target.value as OutputFormat)}
                  className="w-full px-4 py-3 bg-background border border-border rounded-2xl text-sm font-semibold focus:outline-accent"
                >
                  <option value="image/png">PNG</option>
                  <option value="image/jpeg">JPEG</option>
                  <option value="image/webp">WebP</option>
                </select>
              </div>
              {outputFormat !== "image/png" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quality</label>
                    <span className="text-xs font-mono text-muted-foreground">{Math.round(quality * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.4"
                    max="1"
                    step="0.01"
                    value={quality}
                    onChange={(event) => setQuality(parseFloat(event.target.value))}
                    className="w-full h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>
              )}
            </div>
          </aside>

          <main className="space-y-6">
            <div className="liquid-glass rounded-[2.5rem] overflow-hidden border border-border">
              <div className="px-6 py-5 border-b border-border/50 flex items-center justify-between gap-4 bg-background/30">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Live Preview</p>
                  <h2 className="font-bold text-foreground truncate">{selectedImage?.relativePath || selectedImage?.name || "No image selected"}</h2>
                </div>
                <div className="flex items-center gap-2">
                  {hasAnyEditedImage && (
                    <span className="hidden sm:inline-flex text-xs font-semibold text-emerald-600 bg-emerald-500/10 px-3 py-1.5 rounded-full">
                      Edited
                    </span>
                  )}
                  <button
                    onClick={applyToAll}
                    disabled={!images.length || isProcessingAll}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-emerald-500 text-white font-semibold text-sm shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isProcessingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <SlidersHorizontal className="w-4 h-4" />}
                    Apply to All
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 min-h-[520px]">
                <div className="checkerboard p-6 sm:p-8 flex items-center justify-center border-b lg:border-b-0 lg:border-r border-border/50">
                  {selectedImage ? (
                    <div className="w-full max-w-xl aspect-square flex items-center justify-center">
                      <img src={selectedImage.originalUrl} alt="Original preview" className="max-w-full max-h-full object-contain drop-shadow-2xl" />
                    </div>
                  ) : (
                    <div className="text-center p-12">
                      <ImageIcon className="w-14 h-14 mx-auto mb-4 text-muted-foreground" />
                      <h2 className="text-2xl font-bold text-foreground mb-2">Your editor is empty</h2>
                      <p className="text-muted-foreground max-w-md">Upload files or a folder to start tuning a batch.</p>
                    </div>
                  )}
                </div>

                <div className="checkerboard p-6 sm:p-8 flex items-center justify-center relative">
                  {selectedImage && previewSrc ? (
                    <div className="w-full max-w-xl aspect-square flex items-center justify-center">
                      <img src={previewSrc} alt="Edited preview" className="max-w-full max-h-full object-contain drop-shadow-2xl" />
                    </div>
                  ) : (
                    <div className="text-center p-12">
                      <SlidersHorizontal className="w-14 h-14 mx-auto mb-4 text-muted-foreground" />
                      <h2 className="text-2xl font-bold text-foreground mb-2">Edited preview</h2>
                      <p className="text-muted-foreground max-w-md">Adjustments render here before you apply them to the whole batch.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {images.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                <AnimatePresence>
                  {images.map((img) => (
                    <motion.div
                      layout
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      key={img.id}
                      onClick={() => setSelectedImageId(img.id)}
                      className={`liquid-glass rounded-[1.75rem] overflow-hidden border transition-all cursor-pointer ${selectedImage?.id === img.id ? "border-emerald-500 shadow-xl shadow-emerald-500/10" : "border-border hover:border-emerald-500/50"}`}
                    >
                      <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-border/50 bg-background/30">
                        <p className="text-sm font-semibold truncate" title={img.relativePath || img.name}>{img.relativePath || img.name}</p>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            removeImage(img.id);
                          }}
                          className="p-2 rounded-full text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="checkerboard aspect-square flex items-center justify-center p-4 relative">
                        {img.status === "processing" && (
                          <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center z-10">
                            <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                          </div>
                        )}
                        <img src={img.editedUrl || img.originalUrl} alt={img.name} className="max-w-full max-h-full object-contain" />
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </main>

          <aside className="liquid-glass p-8 rounded-[2.5rem] transition-all xl:sticky xl:top-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold flex items-center gap-3 text-foreground">
                <SlidersHorizontal className="w-5 h-5 text-emerald-500" />
                Adjustments
              </h3>
              <button
                onClick={resetAdjustments}
                disabled={!hasAdjustments(adjustments)}
                className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Reset adjustments"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-7 max-h-[calc(100dvh-13rem)] overflow-y-auto pr-1">
              {ADJUSTMENT_SECTIONS.map((section) => (
                <div key={section.title} className="space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section.title}</p>
                  {section.controls.map((control) => {
                    const value = adjustments[control.key];
                    return (
                      <div key={control.key} className="space-y-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <label className="text-sm font-medium text-foreground">{control.label}</label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={control.min}
                              max={control.max}
                              step={control.step}
                              value={value}
                              onChange={(event) => updateAdjustment(control.key, parseFloat(event.target.value) || 0)}
                              className="w-20 bg-background border border-border rounded-lg text-xs px-2 py-1.5 font-mono text-right focus:outline-accent"
                            />
                            {control.unit && <span className="text-xs font-mono text-muted-foreground">{control.unit}</span>}
                          </div>
                        </div>
                        <input
                          type="range"
                          min={control.min}
                          max={control.max}
                          step={control.step}
                          value={value}
                          onChange={(event) => updateAdjustment(control.key, parseFloat(event.target.value))}
                          className="w-full h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-emerald-500"
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>

      <AnimatePresence>
        {batchProgress && (
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
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">{batchProgress.label}</h3>
                  <p className="text-sm text-muted-foreground">{batchProgress.current} / {batchProgress.total} images</p>
                </div>
              </div>
              <div className="w-full h-2 bg-border rounded-full overflow-hidden mb-5">
                <motion.div
                  className="h-full bg-emerald-500 rounded-full"
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
        )}
      </AnimatePresence>

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
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">{zipProgress.label}</h3>
                  <p className="text-sm text-muted-foreground">{zipProgress.current} / {zipProgress.total} files</p>
                </div>
              </div>
              <div className="w-full h-2 bg-border rounded-full overflow-hidden mb-5">
                <motion.div
                  className="h-full bg-emerald-500 rounded-full"
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
        )}
      </AnimatePresence>
    </div>
  );
}
