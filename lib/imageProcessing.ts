export const removeWhiteBackground = async (imageFile: File, tolerance: number = 20): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(imageFile);

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Loop over every pixel (4 values: R, G, B, A)
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Calculate distance from pure white (255, 255, 255)
        const diffR = 255 - r;
        const diffG = 255 - g;
        const diffB = 255 - b;
        const distance = Math.sqrt(diffR * diffR + diffG * diffG + diffB * diffB);

        // We map the 0-100 tolerance input to a max color distance (0-200)
        // A distance of 100 means colors up to (197, 197, 197) are affected.
        const maxDist = tolerance * 2;

        if (distance <= maxDist) {
          if (maxDist === 0 && distance === 0) {
            data[i + 3] = 0;
          } else if (maxDist > 0) {
            const ratio = distance / maxDist;
            // Quadratic feathering for smoother edges
            data[i + 3] = 255 * (ratio * ratio);
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL("image/png"));
      URL.revokeObjectURL(url);
    };

    img.onerror = () => {
      reject(new Error("Failed to load image for processing"));
      URL.revokeObjectURL(url);
    };

    img.src = url;
  });
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

        // Export as JPEG since it's composited and shouldn't have transparency
        resolve(canvas.toDataURL("image/jpeg", 0.95));
      };

      fgImg.onerror = reject;
      fgImg.src = foregroundDataUrl;
    };

    bgImg.onerror = reject;
    bgImg.src = backgroundDataUrl;
  });
};
