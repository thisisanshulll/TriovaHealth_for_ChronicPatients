import sharp from 'sharp';
import Tesseract from 'tesseract.js';

export async function ocrImageBuffer(buffer: Buffer): Promise<string> {
  const png = await sharp(buffer).png().toBuffer();
  const {
    data: { text },
  } = await Tesseract.recognize(png, 'eng', { logger: () => undefined });
  return text || '';
}
