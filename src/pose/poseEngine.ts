// MediaPipe 자세 인식기를 한 번만 만들어 앱 전체에서 함께 씁니다.
// 영상은 태블릿 안에서만 처리하고 어디에도 보내지 않습니다.
import type { PoseLandmarker } from '@mediapipe/tasks-vision';

const BASE = import.meta.env.BASE_URL;
const LOCAL_WASM = `${BASE}mediapipe/wasm`;
const LOCAL_MODEL = `${BASE}models/pose_landmarker_lite.task`;
const REMOTE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

let enginePromise: Promise<PoseLandmarker> | null = null;

async function loadModelBuffer(): Promise<Uint8Array> {
  for (const url of [LOCAL_MODEL, REMOTE_MODEL]) {
    try {
      const res = await fetch(url);
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || type.includes('text/html')) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > 100_000) return buf;
    } catch {
      // 다음 주소로 넘어갑니다.
    }
  }
  throw new Error('자세 인식 모델을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
}

async function create(): Promise<PoseLandmarker> {
  // 첫 화면을 빨리 띄우려고 자세 인식 코드는 필요할 때 불러옵니다.
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const [fileset, model] = await Promise.all([FilesetResolver.forVisionTasks(LOCAL_WASM), loadModelBuffer()]);
  const make = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: model, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  try {
    const engine = await make('GPU');
    console.info('[자세 인식] 준비 완료 (GPU)');
    return engine;
  } catch {
    const engine = await make('CPU');
    console.info('[자세 인식] 준비 완료 (CPU)');
    return engine;
  }
}

export function getPoseEngine(): Promise<PoseLandmarker> {
  if (!enginePromise) {
    enginePromise = create().catch((err) => {
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}
