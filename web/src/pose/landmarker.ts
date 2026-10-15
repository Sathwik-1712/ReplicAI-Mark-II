/**
 * MediaPipe Pose Landmarker running in the browser. The WASM runtime ships with this app; the model
 * file comes from Google's model storage once and is then cached by the browser.
 */
import { PoseLandmarker } from "@mediapipe/tasks-vision";
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import type { PoseFrame } from "../engine/types";

const MODELS = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
};

const cache = new Map<string, Promise<PoseLandmarker>>();

/** One landmarker per model quality, created once. Tries the GPU first, then the CPU. */
export function getLandmarker(quality: "lite" | "full"): Promise<PoseLandmarker> {
  let p = cache.get(quality);
  if (!p) {
    p = (async () => {
      let last: unknown;
      for (const delegate of ["GPU", "CPU"] as const) {
        try {
          return await PoseLandmarker.createFromOptions(
            { wasmLoaderPath, wasmBinaryPath },
            {
              baseOptions: { modelAssetPath: MODELS[quality], delegate },
              runningMode: "VIDEO",
              numPoses: 1,
              minPoseDetectionConfidence: 0.5,
              minPosePresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
            },
          );
        } catch (e) {
          last = e;
        }
      }
      throw last;
    })();
    p.catch(() => cache.delete(quality));
    cache.set(quality, p);
  }
  return p;
}

let lastTs = 0;

/** Runs the model on the current video frame. Returns null when nobody is in view. */
export function detect(lm: PoseLandmarker, video: HTMLVideoElement): PoseFrame | null {
  // VIDEO mode needs strictly increasing timestamps.
  const t = Math.max(performance.now(), lastTs + 1);
  lastTs = t;
  const res = lm.detectForVideo(video, t);
  const image = res.landmarks[0];
  const world = res.worldLandmarks[0];
  if (!image || !world) return null;
  return { t, image, world, aspect: video.videoWidth / Math.max(1, video.videoHeight) };
}

export async function openCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot use a camera here. Open the app over https or on localhost.");
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === "NotAllowedError") throw new Error("Camera permission was blocked. Allow the camera in your browser's address bar, then try again.");
    if (name === "NotFoundError" || name === "OverconstrainedError") throw new Error("No camera found. Plug one in or try another device.");
    if (name === "NotReadableError") throw new Error("The camera is busy in another app. Close it there and try again.");
    if (name === "NotSupportedError" || name === "SecurityError") throw new Error("This browser cannot open the camera on this page. Use Chrome, Edge or Safari over https, or analyze a recorded video.");
    throw e;
  }
}
