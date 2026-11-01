import { GUARD } from '../config.ts';
import { IDX, type JointKey, type Landmark } from './guard.ts';

const BONES: [JointKey, JointKey][] = [
  ['lShoulder', 'rShoulder'],
  ['lShoulder', 'lElbow'],
  ['lElbow', 'lWrist'],
  ['rShoulder', 'rElbow'],
  ['rElbow', 'rWrist'],
  ['lShoulder', 'lHip'],
  ['rShoulder', 'rHip'],
  ['lHip', 'rHip'],
];

const JOINTS: JointKey[] = ['nose', 'lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lWrist', 'rWrist', 'lHip', 'rHip'];

const OK = '#10B981';
const BAD = '#E5484D';
const DIM = 'rgba(148,163,184,0.7)';

/** 카메라 영상 위에 관절 점과 선을 그립니다. (캔버스는 CSS로 거울처럼 뒤집어 표시) */
export function drawPose(canvas: HTMLCanvasElement | null, video: HTMLVideoElement | null, lm: Landmark[] | null, bad: JointKey[] = []) {
  if (!canvas || !video || !video.videoWidth) return;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!lm) return;

  const W = canvas.width;
  const H = canvas.height;
  const scale = Math.max(W, H) / 640;
  const badSet = new Set(bad);
  const ok = (k: JointKey) => (lm[IDX[k]]?.visibility ?? 0) >= GUARD.minVisibility;
  const pt = (k: JointKey) => ({ x: lm[IDX[k]].x * W, y: lm[IDX[k]].y * H });

  ctx.lineCap = 'round';
  for (const [a, b] of BONES) {
    if (!ok(a) || !ok(b)) continue;
    const p = pt(a);
    const q = pt(b);
    ctx.strokeStyle = badSet.has(a) || badSet.has(b) ? 'rgba(229,72,77,0.85)' : 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 6 * scale;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }
  for (const k of JOINTS) {
    const p = pt(k);
    const visible = ok(k);
    const r = (k === 'lWrist' || k === 'rWrist' || k === 'lElbow' || k === 'rElbow' ? 13 : 9) * scale;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = !visible ? DIM : badSet.has(k) ? BAD : OK;
    ctx.fill();
    ctx.lineWidth = 3 * scale;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
  }
}
