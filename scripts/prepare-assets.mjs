// 빌드·개발 전에 자세 인식(MediaPipe) 파일을 public 폴더로 준비합니다.
// 1) node_modules의 WASM 파일을 public/mediapipe/wasm 으로 복사
// 2) 자세 인식 모델(pose_landmarker_lite.task)이 없으면 Google 공식 주소에서 내려받기
//    - 내려받기에 실패해도 빌드는 계속됩니다. 앱이 실행될 때 공식 주소에서 직접 불러옵니다.
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDst = join(root, 'public', 'mediapipe', 'wasm');
const modelDir = join(root, 'public', 'models');
const modelFile = join(modelDir, 'pose_landmarker_lite.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

async function exists(path) {
  try {
    const s = await stat(path);
    return s.size > 0;
  } catch {
    return false;
  }
}

await mkdir(wasmDst, { recursive: true });
for (const f of WASM_FILES) {
  await copyFile(join(wasmSrc, f), join(wasmDst, f));
}
console.log(`[prepare-assets] WASM 파일 ${WASM_FILES.length}개 복사 완료`);

await mkdir(modelDir, { recursive: true });
if (await exists(modelFile)) {
  console.log('[prepare-assets] 자세 인식 모델이 이미 있습니다.');
} else {
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(modelFile, buf);
    console.log(`[prepare-assets] 자세 인식 모델 내려받기 완료 (${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
  } catch (err) {
    console.warn(
      `[prepare-assets] 모델을 내려받지 못했습니다 (${err.message}). ` +
        '앱 실행 시 Google 공식 주소에서 직접 불러옵니다.',
    );
  }
}
