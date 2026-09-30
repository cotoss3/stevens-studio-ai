/**
 * Utility to process product images for professional e-commerce requirements:
 * 1. Guarantees output is exactly 1000x1000 pixels.
 * 2. Scans the non-white/transparent product bounds.
 * 3. Scales and centers the product so its dominant dimension covers exactly 95% of the canvas.
 * 4. Fills the canvas background with pure absolute white (#FFFFFF).
 */
export async function processAndResizeProductImage(
  base64Data: string,
  targetSize = 1000,
  fillPercentage = 0.95
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = base64Data;

    img.onload = () => {
      try {
        // Step 1: Draw the original image on an offscreen canvas to analyze pixels
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) {
          throw new Error('No se pudo inicializar la herramienta de análisis de imagen.');
        }

        tempCtx.drawImage(img, 0, 0);
        const imageData = tempCtx.getImageData(0, 0, img.width, img.height);
        const data = imageData.data;

        // Step 2: Detect bounding box of the actual product (ignoring pure white e-commerce background)
        let minX = img.width;
        let maxX = 0;
        let minY = img.height;
        let maxY = 0;
        let foundProductPixels = false;

        // Sample corner colors (slightly offset from absolute edges to avoid solid borders if any)
        const samples = [
          { x: 5, y: 5 },
          { x: img.width - 6, y: 5 },
          { x: 5, y: img.height - 6 },
          { x: img.width - 6, y: img.height - 6 }
        ];

        let sumR = 0, sumG = 0, sumB = 0, count = 0;
        samples.forEach(s => {
          if (s.x >= 0 && s.x < img.width && s.y >= 0 && s.y < img.height) {
            const idx = (s.y * img.width + s.x) * 4;
            sumR += data[idx];
            sumG += data[idx + 1];
            sumB += data[idx + 2];
            count++;
          }
        });

        const bgR = count > 0 ? sumR / count : 255;
        const bgG = count > 0 ? sumG / count : 255;
        const bgB = count > 0 ? sumB / count : 255;

        // Ignore a 15-pixel border around the edges of the image to bypass compression artifacts,
        // vignetting, or thin black borders that might warp the bounding box.
        const borderMargin = Math.min(15, Math.floor(Math.min(img.width, img.height) * 0.05));

        for (let y = borderMargin; y < img.height - borderMargin; y++) {
          for (let x = borderMargin; x < img.width - borderMargin; x++) {
            const index = (y * img.width + x) * 4;
            const r = data[index];
            const g = data[index + 1];
            const b = data[index + 2];
            const a = data[index + 3];

            // If it's transparent, it's definitely background
            const isTransparent = a < 30;

            // Check distance from estimated corner background color
            const diffFromBg = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);

            // A pixel is background if it's transparent, very close to corner colors, or near pure white
            const isBackground = isTransparent || diffFromBg < 35 || (r >= 244 && g >= 244 && b >= 244);

            if (!isBackground) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
              foundProductPixels = true;
            }
          }
        }

        // If no product pixels found (fallback), use full image (minus margins)
        if (!foundProductPixels) {
          minX = borderMargin;
          maxX = img.width - 1 - borderMargin;
          minY = borderMargin;
          maxY = img.height - 1 - borderMargin;
        }

        const productWidth = maxX - minX + 1;
        const productHeight = maxY - minY + 1;

        // Step 3: Create the final 1000x1000 container canvas
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = targetSize;
        finalCanvas.height = targetSize;
        const finalCtx = finalCanvas.getContext('2d');
        if (!finalCtx) {
          throw new Error('No se pudo inicializar la herramienta de escalado final.');
        }

        // Ensure background is pure white (#FFFFFF)
        finalCtx.fillStyle = '#FFFFFF';
        finalCtx.fillRect(0, 0, targetSize, targetSize);

        // Step 4: Calculate scale factor so the dominant dimension occupies exactly 95% of targetSize
        const targetProductDimension = targetSize * fillPercentage; // 1000 * 0.95 = 950px
        const maxProductDimension = Math.max(productWidth, productHeight);
        const scale = targetProductDimension / maxProductDimension;

        const scaledWidth = productWidth * scale;
        const scaledHeight = productHeight * scale;

        // Calculate centering offsets
        const destX = (targetSize - scaledWidth) / 2;
        const destY = (targetSize - scaledHeight) / 2;

        // Draw cropped, scaled and perfectly centered product onto the final canvas
        finalCtx.drawImage(
          tempCanvas,
          minX,
          minY,
          productWidth,
          productHeight,
          destX,
          destY,
          scaledWidth,
          scaledHeight
        );

        // Export high-quality JPG image
        const processedBase64 = finalCanvas.toDataURL('image/jpeg', 0.95);
        resolve(processedBase64);
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = (err) => {
      reject(new Error('Error al cargar la imagen generada por Gemini para su redimensionamiento.'));
    };
  });
}
