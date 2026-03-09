import { removeBackground } from "@imgly/background-removal";

export type BgRemovalMode = "ai" | "threshold";

/** Uses @imgly AI model - great for complex/non-white backgrounds */
const removeBackgroundAI = async (imageFile: File): Promise<string> => {
  const resultBlob = await removeBackground(imageFile, {
    publicPath: "https://staticimgly.com/@imgly/background-removal/1.7.0/dist/",
    model: "isnet",
  });
  return URL.createObjectURL(resultBlob);
};

/** White-threshold background removal for studio shots on near-white backdrops.
 *  Removes only near-white pixels connected to the image border,
 *  helping preserve white details inside the subject. */
const removeBackgroundThreshold = (imageFile: File, tolerance: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(imageFile);

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Failed to get canvas context")); return; }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const width = canvas.width;
      const height = canvas.height;
      const pixelCount = width * height;
      const clampedTolerance = Math.max(0, Math.min(100, tolerance));
      const maxDist = clampedTolerance * 2;

      const nearWhite = new Uint8Array(pixelCount);
      const connectedToBorder = new Uint8Array(pixelCount);
      const whiteDistance = new Float32Array(pixelCount);
      const queue = new Uint32Array(pixelCount);

      for (let px = 0; px < pixelCount; px++) {
        const i = px * 4;
        const dR = 255 - data[i];
        const dG = 255 - data[i + 1];
        const dB = 255 - data[i + 2];
        const distance = Math.sqrt(dR * dR + dG * dG + dB * dB);
        whiteDistance[px] = distance;
        if (distance <= maxDist) {
          nearWhite[px] = 1;
        }
      }

      let head = 0;
      let tail = 0;
      const enqueue = (x: number, y: number) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return;
        const idx = y * width + x;
        if (!nearWhite[idx] || connectedToBorder[idx]) return;
        connectedToBorder[idx] = 1;
        queue[tail++] = idx;
      };

      for (let x = 0; x < width; x++) {
        enqueue(x, 0);
        enqueue(x, height - 1);
      }
      for (let y = 0; y < height; y++) {
        enqueue(0, y);
        enqueue(width - 1, y);
      }

      while (head < tail) {
        const idx = queue[head++];
        const x = idx % width;
        const y = Math.floor(idx / width);

        enqueue(x - 1, y);
        enqueue(x + 1, y);
        enqueue(x, y - 1);
        enqueue(x, y + 1);
        enqueue(x - 1, y - 1);
        enqueue(x + 1, y - 1);
        enqueue(x - 1, y + 1);
        enqueue(x + 1, y + 1);
      }

      for (let px = 0; px < pixelCount; px++) {
        if (!connectedToBorder[px]) continue;
        const i = px * 4;
        const distance = whiteDistance[px];
        data[i + 3] = maxDist === 0
          ? 0
          : Math.round(255 * Math.pow(distance / maxDist, 2));
      }

      ctx.putImageData(imageData, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) resolve(URL.createObjectURL(blob));
        else reject(new Error("Failed to create image blob"));
        URL.revokeObjectURL(url);
      }, "image/png");
    };

    img.onerror = () => { reject(new Error("Failed to load image")); URL.revokeObjectURL(url); };
    img.src = url;
  });
};
export const removeWhiteBackground = async (
  imageFile: File,
  tolerance: number = 20,
  mode: BgRemovalMode = "ai"
): Promise<string> => {
  if (mode === "threshold") {
    return removeBackgroundThreshold(imageFile, tolerance);
  }
  try {
    return await removeBackgroundAI(imageFile);
  } catch (error) {
    console.error("AI background removal failed, falling back to threshold:", error);
    return removeBackgroundThreshold(imageFile, tolerance);
  }
};



export const compositeImage = async (
  foregroundDataUrl: string,
  backgroundDataUrl: string,
  scale: number = 1.0,
  offsetX: number = 0,
  offsetY: number = 0
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const bgImg = new Image();
    const fgImg = new Image();

    bgImg.onload = () => {
      fgImg.onload = () => {
        const canvas = document.createElement("canvas");
        // Canvas is now the size of the background
        canvas.width = bgImg.width;
        canvas.height = bgImg.height;
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          reject(new Error("Failed to get canvas context"));
          return;
        }

        // Draw background
        ctx.drawImage(bgImg, 0, 0);

        // Draw foreground
        // base scale to fit inside bg
        const fgRatio = fgImg.width / fgImg.height;
        const bgRatio = bgImg.width / bgImg.height;
        let baseWidth, baseHeight;

        if (fgRatio > bgRatio) {
          // Fg is wider relative to its height than Bg
          baseWidth = bgImg.width;
          baseHeight = bgImg.width / fgRatio;
        } else {
          baseHeight = bgImg.height;
          baseWidth = bgImg.height * fgRatio;
        }

        const finalW = baseWidth * scale;
        const finalH = baseHeight * scale;

        // centering
        const centerX = bgImg.width / 2;
        const centerY = bgImg.height / 2;

        // offsetX and offsetY are percentages of bg dimensions (-100 to 100)
        const shiftX = (bgImg.width * offsetX) / 100;
        const shiftY = (bgImg.height * offsetY) / 100;

        const drawX = centerX - (finalW / 2) + shiftX;
        const drawY = centerY - (finalH / 2) + shiftY;

        ctx.drawImage(fgImg, drawX, drawY, finalW, finalH);

        // Use toBlob instead of toDataURL to avoid massive base64 strings in JS heap
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(URL.createObjectURL(blob));
          } else {
            reject(new Error("Failed to create image blob"));
          }
        }, "image/png");
      };

      fgImg.onerror = reject;
      fgImg.src = foregroundDataUrl;
    };

    bgImg.onerror = reject;
    bgImg.src = backgroundDataUrl;
  });
};

export const applyLogo = async (
  baseDataUrl: string,
  logoDataUrl: string,
  scale: number = 0.15,
  offsetX: number = 9,
  offsetY: number = 9
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const baseImg = new Image();
    const logoImg = new Image();

    baseImg.onload = () => {
      logoImg.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = baseImg.width;
        canvas.height = baseImg.height;
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          reject(new Error("Failed to get canvas context"));
          return;
        }

        ctx.drawImage(baseImg, 0, 0);

        const finalW = baseImg.width * scale;
        const finalH = (logoImg.height / logoImg.width) * finalW;

        const drawX = (baseImg.width * offsetX) / 100;
        const drawY = (baseImg.height * offsetY) / 100;

        ctx.drawImage(logoImg, drawX, drawY, finalW, finalH);

        // Use toBlob for memory efficiency â€” always output PNG for lossless quality
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(URL.createObjectURL(blob));
          } else {
            reject(new Error("Failed to create image blob"));
          }
        }, "image/png");
      };

      logoImg.onerror = reject;
      logoImg.src = logoDataUrl;
    };

    baseImg.onerror = reject;
    baseImg.src = baseDataUrl;
  });
};

export const getPixelColor = async (imageUrl: string, x: number, y: number, imageWidth: number, imageHeight: number): Promise<{ r: number; g: number; b: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = imageWidth;
      canvas.height = imageHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get context"));
        return;
      }
      ctx.drawImage(img, 0, 0, imageWidth, imageHeight);
      const pixelData = ctx.getImageData(x, y, 1, 1).data;
      resolve({ r: pixelData[0], g: pixelData[1], b: pixelData[2] });
    };
    img.onerror = reject;
    img.src = imageUrl;
  });
};

export const applySelectiveBlur = async (
  bgDataUrl: string,
  targetColor: { r: number; g: number; b: number },
  tolerance: number = 20,
  blurAmount: number = 5
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = img.width;
      const height = img.height;

      // Original unblurred canvas
      const origCanvas = document.createElement("canvas");
      origCanvas.width = width;
      origCanvas.height = height;
      const origCtx = origCanvas.getContext("2d");

      // Blurred canvas
      const blurCanvas = document.createElement("canvas");
      blurCanvas.width = width;
      blurCanvas.height = height;
      const blurCtx = blurCanvas.getContext("2d");

      if (!origCtx || !blurCtx) {
        reject(new Error("Failed to get context"));
        return;
      }

      origCtx.drawImage(img, 0, 0);
      blurCtx.filter = `blur(${blurAmount}px)`;
      blurCtx.drawImage(img, 0, 0);
      blurCtx.filter = "none"; // reset

      const origImageData = origCtx.getImageData(0, 0, width, height);
      const blurImageData = blurCtx.getImageData(0, 0, width, height);
      const origData = origImageData.data;
      const blurData = blurImageData.data;

      // Final canvas
      const finalCanvas = document.createElement("canvas");
      finalCanvas.width = width;
      finalCanvas.height = height;
      const finalCtx = finalCanvas.getContext("2d")!;

      const finalImageData = finalCtx.createImageData(width, height);
      const finalData = finalImageData.data;

      for (let i = 0; i < origData.length; i += 4) {
        const r = origData[i];
        const g = origData[i + 1];
        const b = origData[i + 2];
        const a = origData[i + 3];

        const diffR = targetColor.r - r;
        const diffG = targetColor.g - g;
        const diffB = targetColor.b - b;
        const distance = Math.sqrt(diffR * diffR + diffG * diffG + diffB * diffB);

        const maxDist = tolerance * 2;

        if (distance <= maxDist) {
          // Inside tolerance, blend between blurred and original based on distance
          let ratio = 1.0;
          if (maxDist > 0) {
            // Further away from target color = more original, less blur
            // Closer to target color (distance -> 0) = ratio -> 1.0 (more blur)
            const normalizedDist = distance / maxDist;
            ratio = 1.0 - (normalizedDist * normalizedDist); // Quadratic feathering
            ratio = Math.max(0, Math.min(1, ratio));
          }

          finalData[i] = Math.round(blurData[i] * ratio + r * (1 - ratio));
          finalData[i + 1] = Math.round(blurData[i + 1] * ratio + g * (1 - ratio));
          finalData[i + 2] = Math.round(blurData[i + 2] * ratio + b * (1 - ratio));
          finalData[i + 3] = a;
        } else {
          // Outside tolerance, keep original
          finalData[i] = r;
          finalData[i + 1] = g;
          finalData[i + 2] = b;
          finalData[i + 3] = a;
        }
      }

      finalCtx.putImageData(finalImageData, 0, 0);
      // Use toBlob for memory efficiency â€” output PNG for lossless quality
      finalCanvas.toBlob((blob) => {
        if (blob) {
          resolve(URL.createObjectURL(blob));
        } else {
          reject(new Error("Failed to create image blob"));
        }
      }, "image/png");
    };
    img.onerror = reject;
    img.src = bgDataUrl;
  });
};

export const GEMINI_WATERMARK_SVG_PATH = "M32.447 0c.68 0 1.273.465 1.439 1.125a38.904 38.904 0 001.999 5.905c2.152 5 5.105 9.376 8.854 13.125 3.751 3.75 8.126 6.703 13.125 8.855a38.98 38.98 0 005.906 1.999c.66.166 1.124.758 1.124 1.438 0 .68-.464 1.273-1.125 1.439a38.902 38.902 0 00-5.905 1.999c-5 2.152-9.375 5.105-13.125 8.854-3.749 3.751-6.702 8.126-8.854 13.125a38.973 38.973 0 00-2 5.906 1.485 1.485 0 01-1.438 1.124c-.68 0-1.272-.464-1.438-1.125a38.913 38.913 0 00-2-5.905c-2.151-5-5.103-9.375-8.854-13.125-3.75-3.749-8.125-6.702-13.125-8.854a38.973 38.973 0 00-5.905-2A1.485 1.485 0 010 32.448c0-.68.465-1.272 1.125-1.438a38.903 38.903 0 005.905-2c5-2.151 9.376-5.104 13.125-8.854 3.75-3.749 6.703-8.125 8.855-13.125a38.972 38.972 0 001.999-5.905A1.485 1.485 0 0132.447 0z";
export const SVG_SIZE = 65;

export interface AiMaskerOptions {
  alpha: number;
  scale: number;
  x: number;
  y: number;
  boldness: number;
  blur: number;
  seam: number;
  decay: number;
  linearMath: boolean;
}

const drawSVGMask = (ctx: CanvasRenderingContext2D, bold: number = 0) => {
  const path = new Path2D(GEMINI_WATERMARK_SVG_PATH);
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fill(path);

  if (bold !== 0) {
    ctx.lineWidth = Math.abs(bold);
    if (bold > 0) {
      ctx.stroke(path);
    } else {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.stroke(path);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
};

export const applyAiWatermarkMask = async (bgDataUrl: string, options: AiMaskerOptions): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const W = img.naturalWidth;
      const H = img.naturalHeight;

      let bSize, margin;
      if (W <= 1024 || H <= 1024) {
        bSize = 48;
        margin = 32;
      } else {
        bSize = 96;
        margin = 64;
      }

      const bx = (W - bSize - margin) + options.x;
      const by = (H - bSize - margin) + options.y;

      const maskSize = bSize * 4;
      const maskCv = document.createElement('canvas');
      maskCv.width = maskSize;
      maskCv.height = maskSize;
      const mCtx = maskCv.getContext('2d', { willReadFrequently: true });
      if (!mCtx) return resolve(bgDataUrl);

      if (options.blur > 0) mCtx.filter = `blur(${options.blur}px)`;

      mCtx.translate(maskSize / 2, maskSize / 2);
      const baseScale = bSize / SVG_SIZE;
      const finalScale = baseScale * options.scale;
      mCtx.scale(finalScale, finalScale);
      mCtx.translate(-SVG_SIZE / 2, -SVG_SIZE / 2);

      drawSVGMask(mCtx, options.boldness);

      const maskDataFull = mCtx.getImageData(0, 0, maskSize, maskSize).data;

      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = W;
      fullCanvas.height = H;
      const ctxFull = fullCanvas.getContext('2d', { willReadFrequently: true });
      if (!ctxFull) return resolve(bgDataUrl);

      ctxFull.drawImage(img, 0, 0);

      const drawOffset = Math.floor((maskSize - bSize) / 2);
      const startX = bx - drawOffset;
      const startY = by - drawOffset;

      const safeX = Math.max(0, Math.floor(startX));
      const safeY = Math.max(0, Math.floor(startY));
      const safeW = Math.floor(Math.min(W - safeX, maskSize + 2));
      const safeH = Math.floor(Math.min(H - safeY, maskSize + 2));

      if (safeW > 0 && safeH > 0) {
        const imgData = ctxFull.getImageData(safeX, safeY, safeW, safeH);
        const pixels = imgData.data;

        const edgeIndices: number[] = [];

        for (let y = 0; y < safeH; y++) {
          for (let x = 0; x < safeW; x++) {
            const maskX = (safeX - startX) + x;
            const maskY = (safeY - startY) + y;

            const iMX = Math.round(maskX);
            const iMY = Math.round(maskY);

            if (iMX >= 0 && iMX < maskSize && iMY >= 0 && iMY < maskSize) {
              const maskIdx = (iMY * maskSize + iMX) * 4;
              const maskAlpha = maskDataFull[maskIdx + 3];

              if (maskAlpha > 0) {
                const imgIdx = (y * safeW + x) * 4;

                let maskRatio = maskAlpha / 255.0;
                if (options.decay !== 1.0) maskRatio = Math.pow(maskRatio, options.decay);

                const effAlpha = options.alpha * maskRatio;

                if (options.seam > 0 && maskAlpha < 240) {
                  edgeIndices.push(imgIdx);
                }

                if (effAlpha < 0.99) {
                  const r = pixels[imgIdx];
                  const g = pixels[imgIdx + 1];
                  const b = pixels[imgIdx + 2];
                  const invAlpha = 1 - effAlpha;
                  let newR, newG, newB;

                  if (options.linearMath) {
                    const linR = Math.pow(r / 255, 2.2);
                    const linG = Math.pow(g / 255, 2.2);
                    const linB = Math.pow(b / 255, 2.2);
                    const resR = (linR - (1.0 * effAlpha)) / invAlpha;
                    const resG = (linG - (1.0 * effAlpha)) / invAlpha;
                    const resB = (linB - (1.0 * effAlpha)) / invAlpha;
                    newR = Math.pow(Math.max(0, resR), 1 / 2.2) * 255;
                    newG = Math.pow(Math.max(0, resG), 1 / 2.2) * 255;
                    newB = Math.pow(Math.max(0, resB), 1 / 2.2) * 255;
                  } else {
                    newR = (r - (255 * effAlpha)) / invAlpha;
                    newG = (g - (255 * effAlpha)) / invAlpha;
                    newB = (b - (255 * effAlpha)) / invAlpha;
                  }

                  pixels[imgIdx] = Math.max(0, Math.min(255, newR));
                  pixels[imgIdx + 1] = Math.max(0, Math.min(255, newG));
                  pixels[imgIdx + 2] = Math.max(0, Math.min(255, newB));
                }
              }
            }
          }
        }

        if (options.seam > 0 && edgeIndices.length > 0) {
          const copyPixels = new Uint8ClampedArray(pixels);
          const radius = Math.ceil(options.seam);
          const sigma = Math.max(1, radius / 2);
          const sigmaSq2 = 2 * sigma * sigma;
          const kernel: { x: number, y: number, w: number }[] = [];

          for (let ky = -radius; ky <= radius; ky++) {
            for (let kx = -radius; kx <= radius; kx++) {
              const distSq = kx * kx + ky * ky;
              if (distSq <= radius * radius) {
                const weight = Math.exp(-distSq / sigmaSq2);
                kernel.push({ x: kx, y: ky, w: weight });
              }
            }
          }

          for (let i = 0; i < edgeIndices.length; i++) {
            const idx = edgeIndices[i];
            const pIndex = idx / 4;
            const py = Math.floor(pIndex / safeW);
            const px = pIndex % safeW;

            let rSum = 0, gSum = 0, bSum = 0, wSum = 0;

            for (let k = 0; k < kernel.length; k++) {
              const kn = kernel[k];
              const ny = py + kn.y;
              const nx = px + kn.x;

              if (ny >= 0 && ny < safeH && nx >= 0 && nx < safeW) {
                const nIdx = (ny * safeW + nx) * 4;
                rSum += copyPixels[nIdx] * kn.w;
                gSum += copyPixels[nIdx + 1] * kn.w;
                bSum += copyPixels[nIdx + 2] * kn.w;
                wSum += kn.w;
              }
            }

            if (wSum > 0) {
              pixels[idx] = rSum / wSum;
              pixels[idx + 1] = gSum / wSum;
              pixels[idx + 2] = bSum / wSum;
            }
          }
        }

        ctxFull.putImageData(imgData, safeX, safeY);
      }

      // Use toBlob for memory efficiency
      fullCanvas.toBlob((blob) => {
        if (blob) {
          resolve(URL.createObjectURL(blob));
        } else {
          reject(new Error("Failed to create image blob"));
        }
      }, "image/png");
    };
    img.onerror = reject;
    img.src = bgDataUrl;
  });
};

/* --- TOURNAMENT / MAGIC SOLVERS --- */

export interface MaskerSolverResult {
  alpha: number;
  linear: boolean;
  score: number;
  x: number;
  y: number;
}

const getStandardDeviation = (arr: number[]) => {
  if (!arr.length) return 0;
  const mean = arr.reduce((acc, val) => acc + val, 0) / arr.length;
  return Math.sqrt(arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / arr.length);
};

const judgeResult = async (
  result: { alpha: number, linear: boolean },
  position: { x: number, y: number },
  size: number,
  tData: Uint8ClampedArray,
  originalImg: HTMLImageElement
): Promise<number> => {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = size; tempCanvas.height = size;
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
  if (!tempCtx) return Infinity;

  tempCtx.drawImage(originalImg, -position.x, -position.y);
  const imgData = tempCtx.getImageData(0, 0, size, size);
  const pixels = imgData.data;

  for (let i = 0; i < pixels.length; i += 4) {
    if (tData[i] > 250) {
      const inv = 1 - result.alpha;
      if (inv > 0.01) {
        if (!result.linear) {
          pixels[i] = (pixels[i] - 255 * result.alpha) / inv;
          pixels[i + 1] = (pixels[i + 1] - 255 * result.alpha) / inv;
          pixels[i + 2] = (pixels[i + 2] - 255 * result.alpha) / inv;
        } else {
          const lr = Math.pow(pixels[i] / 255, 2.2), lg = Math.pow(pixels[i + 1] / 255, 2.2), lb = Math.pow(pixels[i + 2] / 255, 2.2);
          const rr = (lr - result.alpha) / inv, gg = (lg - result.alpha) / inv, bb = (lb - result.alpha) / inv;
          pixels[i] = (rr > 0) ? Math.pow(rr, 1 / 2.2) * 255 : 0;
          pixels[i + 1] = (gg > 0) ? Math.pow(gg, 1 / 2.2) * 255 : 0;
          pixels[i + 2] = (bb > 0) ? Math.pow(bb, 1 / 2.2) * 255 : 0;
        }
      }
    }
  }

  const insideLuma: number[] = [], outsideLuma: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    const luma = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
    if (tData[i] > 250) insideLuma.push(luma);
    else if (tData[i] < 5) outsideLuma.push(luma);
  }

  const insideStdDev = getStandardDeviation(insideLuma);
  const outsideStdDev = getStandardDeviation(outsideLuma);

  const avgIn = insideLuma.reduce((a, b) => a + b, 0) / insideLuma.length || 0;
  const avgOut = outsideLuma.reduce((a, b) => a + b, 0) / outsideLuma.length || 0;

  return Math.abs(insideStdDev - outsideStdDev) + Math.abs(avgIn - avgOut) * 0.5;
};

const runTextureSolver = (cropData: Uint8ClampedArray, maskData: Uint8ClampedArray, size: number) => {
  let bestAlpha = 0.55, bestError = Infinity, bestModeLinear = false;

  const pairs = [];
  for (let i = 0; i < size * size; i++) {
    if (i % size > size - 3) continue;
    const m1 = maskData[i * 4], m2 = maskData[(i + 2) * 4];
    if (m1 > 250 && m2 < 5) {
      const idx = i * 4, idxN = (i + 2) * 4;
      pairs.push({
        r: cropData[idx], g: cropData[idx + 1], b: cropData[idx + 2],
        tR: cropData[idxN], tG: cropData[idxN + 1], tB: cropData[idxN + 2]
      });
    }
  }

  for (const isLinear of [true, false]) {
    for (let a = 0.20; a <= 0.90; a += 0.01) {
      let totalEnergy = 0;
      for (const p of pairs) {
        let rRest, gRest, bRest;
        if (!isLinear) {
          const inv = 1 - a;
          rRest = (p.r - 255 * a) / inv; gRest = (p.g - 255 * a) / inv; bRest = (p.b - 255 * a) / inv;
        } else {
          const inv = 1 - a;
          const lr = Math.pow(p.r / 255, 2.2), lg = Math.pow(p.g / 255, 2.2), lb = Math.pow(p.b / 255, 2.2);
          const rr = (lr - a) / inv, gg = (lg - a) / inv, bb = (lb - a) / inv;
          rRest = (rr > 0) ? Math.pow(rr, 1 / 2.2) * 255 : 0;
          gRest = (gg > 0) ? Math.pow(gg, 1 / 2.2) * 255 : 0;
          bRest = (bb > 0) ? Math.pow(bb, 1 / 2.2) * 255 : 0;
        }
        rRest = Math.max(0, Math.min(255, rRest));
        gRest = Math.max(0, Math.min(255, gRest));
        bRest = Math.max(0, Math.min(255, bRest));

        totalEnergy += Math.abs(rRest - p.tR) + Math.abs(gRest - p.tG) + Math.abs(bRest - p.tB);
      }
      if (totalEnergy < bestError) { bestError = totalEnergy; bestAlpha = a; bestModeLinear = isLinear; }
    }
  }
  return { alpha: bestAlpha, linear: bestModeLinear };
};

const runBrightnessSolver = (cropData: Uint8ClampedArray, maskData: Uint8ClampedArray, size: number) => {
  const sumIn = { r: 0, g: 0, b: 0, c: 0 }, sumOut = { r: 0, g: 0, b: 0, c: 0 };

  for (let i = 0; i < size * size; i++) {
    const a = maskData[i * 4]; const idx = i * 4;
    const r = cropData[idx], g = cropData[idx + 1], b = cropData[idx + 2];

    if (a > 250) {
      sumIn.r += r; sumIn.g += g; sumIn.b += b; sumIn.c++;
    } else if (a < 5) {
      const x = i % size, y = Math.floor(i / size);
      const center = size / 2;
      if (Math.abs(x - center) < size * 0.4 && Math.abs(y - center) < size * 0.4) {
        sumOut.r += r; sumOut.g += g; sumOut.b += b; sumOut.c++;
      }
    }
  }

  if (sumIn.c === 0 || sumOut.c === 0) return { alpha: 0.55, linear: true };

  const avgIn = { r: sumIn.r / sumIn.c, g: sumIn.g / sumIn.c, b: sumIn.b / sumIn.c };
  const avgOut = { r: sumOut.r / sumOut.c, g: sumOut.g / sumOut.c, b: sumOut.b / sumOut.c };

  let bestAlpha = 0.55, bestError = Infinity, bestModeLinear = false;

  for (const isLinear of [true, false]) {
    for (let a = 0.20; a <= 0.90; a += 0.01) {
      let rRest = 0, gRest = 0, bRest = 0;
      if (!isLinear) {
        const inv = 1 - a; rRest = (avgIn.r - 255 * a) / inv; gRest = (avgIn.g - 255 * a) / inv; bRest = (avgIn.b - 255 * a) / inv;
      } else {
        const inv = 1 - a;
        const lr = Math.pow(avgIn.r / 255, 2.2), lg = Math.pow(avgIn.g / 255, 2.2), lb = Math.pow(avgIn.b / 255, 2.2);
        const rr = (lr - a) / inv, gg = (lg - a) / inv, bb = (lb - a) / inv;
        rRest = (rr > 0) ? Math.pow(rr, 1 / 2.2) * 255 : 0; gRest = (gg > 0) ? Math.pow(gg, 1 / 2.2) * 255 : 0; bRest = (bb > 0) ? Math.pow(bb, 1 / 2.2) * 255 : 0;
      }
      const err = Math.abs(rRest - avgOut.r) + Math.abs(gRest - avgOut.g) + Math.abs(bRest - avgOut.b);
      if (err < bestError) { bestError = err; bestAlpha = a; bestModeLinear = isLinear; }
    }
  }
  return { alpha: bestAlpha, linear: bestModeLinear };
};

const runHistogramSolver = (cropData: Uint8ClampedArray, maskData: Uint8ClampedArray, size: number) => {
  const lumasOut = [];
  for (let i = 0; i < size * size; i++) {
    if (maskData[i * 4] < 5) {
      const idx = i * 4;
      lumasOut.push(cropData[idx] * 0.299 + cropData[idx + 1] * 0.587 + cropData[idx + 2] * 0.114);
    }
  }
  const stdDevOut = getStandardDeviation(lumasOut);

  let bestAlpha = 0.55, bestError = Infinity, bestModeLinear = false;

  for (const isLinear of [true, false]) {
    for (let a = 0.20; a <= 0.90; a += 0.02) {
      const lumasIn = [];
      for (let i = 0; i < size * size; i += 2) {
        if (maskData[i * 4] > 250) {
          const idx = i * 4;
          const r = cropData[idx], g = cropData[idx + 1], b = cropData[idx + 2];
          let rRest, gRest, bRest;
          if (!isLinear) {
            const inv = 1 - a; rRest = (r - 255 * a) / inv; gRest = (g - 255 * a) / inv; bRest = (b - 255 * a) / inv;
          } else {
            const inv = 1 - a;
            const lr = Math.pow(r / 255, 2.2), lg = Math.pow(g / 255, 2.2), lb = Math.pow(b / 255, 2.2);
            const rr = (lr - a) / inv, gg = (lg - a) / inv, bb = (lb - a) / inv;
            rRest = (rr > 0) ? Math.pow(rr, 1 / 2.2) * 255 : 0; gRest = (gg > 0) ? Math.pow(gg, 1 / 2.2) * 255 : 0; bRest = (bb > 0) ? Math.pow(bb, 1 / 2.2) * 255 : 0;
          }
          lumasIn.push(rRest * 0.299 + gRest * 0.587 + bRest * 0.114);
        }
      }
      const stdDevIn = getStandardDeviation(lumasIn);
      const err = Math.abs(stdDevIn - stdDevOut);
      if (err < bestError) { bestError = err; bestAlpha = a; bestModeLinear = isLinear; }
    }
  }
  return { alpha: bestAlpha, linear: bestModeLinear };
};

export const runMaskerSolvers = async (bgDataUrl: string): Promise<MaskerSolverResult> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      const W = img.naturalWidth;
      const H = img.naturalHeight;

      const targetSize = (W <= 1024 || H <= 1024) ? 48 : 96;
      const expectedMargin = (W <= 1024 || H <= 1024) ? 32 : 64;

      const cvT = document.createElement('canvas');
      cvT.width = targetSize; cvT.height = targetSize;
      const ctxT = cvT.getContext('2d', { willReadFrequently: true });
      if (!ctxT) return resolve({ alpha: 0.55, linear: true, score: 0, x: 0, y: 0 });

      const scale = targetSize / SVG_SIZE;
      ctxT.fillStyle = 'black'; ctxT.fillRect(0, 0, targetSize, targetSize);
      ctxT.translate(targetSize / 2, targetSize / 2);
      ctxT.scale(scale, scale);
      ctxT.translate(-SVG_SIZE / 2, -SVG_SIZE / 2);
      const p = new Path2D(GEMINI_WATERMARK_SVG_PATH);
      ctxT.fillStyle = 'white'; ctxT.fill(p);
      const tData = ctxT.getImageData(0, 0, targetSize, targetSize).data;

      const tSum = Array.from(tData).reduce((acc, val, i) => i % 4 === 0 ? acc + val : acc, 0);

      const scanZone = (startX: number, startY: number, w: number, h: number) => {
        const cvS = document.createElement('canvas');
        cvS.width = w; cvS.height = h;
        const ctxS = cvS.getContext('2d', { willReadFrequently: true });
        if (!ctxS) return { score: -1, x: 0, y: 0 };
        ctxS.drawImage(img, -startX, -startY);
        const imgData = ctxS.getImageData(0, 0, w, h).data;

        let bestZoneScore = -1, bestZoneX = 0, bestZoneY = 0;

        const T: number[] = [];
        for (let y = 0; y < targetSize; y += 2) for (let x = 0; x < targetSize; x += 2) T.push(tData[(y * targetSize + x) * 4]);
        const meanT = T.reduce((a, b) => a + b, 0) / T.length;
        const denomT = Math.sqrt(T.reduce((a, b) => a + (b - meanT) ** 2, 0));

        for (let ly = 0; ly < h - targetSize; ly += 2) {
          for (let lx = 0; lx < w - targetSize; lx += 2) {
            const I: number[] = [];
            for (let ty = 0; ty < targetSize; ty += 2) for (let tx = 0; tx < targetSize; tx += 2) {
              const idx = ((ly + ty) * w + (lx + tx)) * 4;
              I.push(imgData[idx] * 0.299 + imgData[idx + 1] * 0.587 + imgData[idx + 2] * 0.114);
            }
            const meanI = I.reduce((a, b) => a + b, 0) / I.length;
            let num = 0, denI = 0;
            for (let k = 0; k < I.length; k++) {
              const diffI = I[k] - meanI;
              num += diffI * (T[k] - meanT);
              denI += diffI ** 2;
            }
            if (denI === 0) continue;
            const score = num / (Math.sqrt(denI) * denomT);
            if (score > bestZoneScore) { bestZoneScore = score; bestZoneX = lx; bestZoneY = ly; }
          }
        }
        return { score: bestZoneScore, x: startX + bestZoneX, y: startY + bestZoneY };
      };

      let finalResult = { score: -1, x: 0, y: 0 };
      const margin = 300;
      const z1 = scanZone(Math.max(0, W - margin), Math.max(0, H - margin), Math.min(W, margin), Math.min(H, margin));
      if (z1.score > 0.60) finalResult = z1;
      else {
        const z2 = scanZone(0, Math.max(0, H - margin), Math.min(W, margin), Math.min(H, margin));
        if (z2.score > 0.60) finalResult = z2;
        else {
          finalResult = { x: W - targetSize - expectedMargin, y: H - targetSize - expectedMargin, score: 0 };
        }
      }

      const fCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      if (!fCtx) return resolve({ alpha: 0.55, linear: true, score: 0, x: 0, y: 0 });
      fCtx.canvas.width = targetSize; fCtx.canvas.height = targetSize;
      fCtx.drawImage(img, -finalResult.x, -finalResult.y);
      const cropData = fCtx.getImageData(0, 0, targetSize, targetSize).data;

      const solvers = [
        runTextureSolver(cropData, tData, targetSize),
        runBrightnessSolver(cropData, tData, targetSize),
        runHistogramSolver(cropData, tData, targetSize),
        { alpha: 0.55, linear: true }, // Gradient mock
      ];

      let bestScore = Infinity;
      let winner = solvers[0];

      for (const res of solvers) {
        const score = await judgeResult(res, finalResult, targetSize, tData, img);
        if (score < bestScore) {
          bestScore = score;
          winner = res;
        }
      }

      const finalX = finalResult.x - (W - targetSize - expectedMargin);
      const finalY = finalResult.y - (H - targetSize - expectedMargin);

      resolve({
        alpha: winner.alpha,
        linear: winner.linear,
        score: bestScore,
        x: finalX,
        y: finalY
      });
    };
    img.onerror = () => resolve({ alpha: 0.55, linear: true, score: 0, x: 0, y: 0 });
    img.src = bgDataUrl;
  });
};


