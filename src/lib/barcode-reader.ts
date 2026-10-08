import { NotFoundException, ChecksumException, FormatException } from "@zxing/library";
type DetectorClass = new (options: { formats: string[] }) => { detect: (video: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/** Frames stay on the device. ZXing is loaded only when native detection is absent. */
export async function createBarcodeReader(native?: DetectorClass) {
  let detector: InstanceType<DetectorClass> | undefined;
  try { if (native) detector = new native({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] }); } catch { /* Some implementations expose the API but not these formats. */ }
  let reader: import("@zxing/browser").BrowserMultiFormatOneDReader | undefined;
  const canvas = document.createElement("canvas");
  async function fallback(video: HTMLVideoElement) {
    if (!reader) { const { BrowserMultiFormatOneDReader } = await import("@zxing/browser"); reader = new BrowserMultiFormatOneDReader(); }
    if (!video.videoWidth || !video.videoHeight) return [];
    const scale = Math.min(1, 1280 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas unavailable");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    try { return [{ rawValue: reader.decodeFromCanvas(canvas).getText() }]; }
    catch (error) {
      if (error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException) return [];
      throw error;
    }
  }
  if (!detector) { const { BrowserMultiFormatOneDReader } = await import("@zxing/browser"); reader = new BrowserMultiFormatOneDReader(); }
  return { async detect(video: HTMLVideoElement) {
    if (detector) {
      try { return await detector.detect(video); } catch { detector = undefined; }
    }
    return fallback(video);
  } };
}
