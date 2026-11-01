// 가드 판정 로직 (화면과 분리된 순수 계산 코드)
// 좌표는 MediaPipe 정규화 좌표(0~1, y는 아래로 증가)를 받습니다.
// "왼/오른"은 학생 본인 기준입니다. (MediaPipe의 left = 사람의 왼쪽)

import { CALLER, GUARD } from '../config.ts';

export type Landmark = { x: number; y: number; z?: number; visibility?: number };
export type Side = 'left' | 'right';
export type JointKey = 'nose' | 'lShoulder' | 'rShoulder' | 'lElbow' | 'rElbow' | 'lWrist' | 'rWrist' | 'lHip' | 'rHip';

export const IDX: Record<JointKey, number> = {
  nose: 0,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
};

export type SideMetrics = {
  /** 손목이 어깨선보다 위에 있는 정도 (+면 위, -면 아래) */
  handHeight: number;
  /** 손목과 코 사이 거리 */
  handFace: number;
  /** 팔꿈치가 몸통 옆선(어깨~엉덩이) 밖으로 나간 정도 (+면 바깥) */
  elbowOut: number;
  /** 팔꿈치가 어깨보다 위로 올라간 정도 (+면 위) */
  elbowLift: number;
};

export type GuardMetrics = { left: SideMetrics; right: SideMetrics; shoulderWidth: number };

const REQUIRED: JointKey[] = ['nose', 'lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lWrist', 'rWrist'];
export const SETUP_JOINTS: JointKey[] = [...REQUIRED, 'lHip', 'rHip'];

const vis = (p: Landmark | undefined) => (p ? (p.visibility ?? 1) : 0);

export function jointVisible(lm: Landmark[] | null, key: JointKey, min: number = GUARD.minVisibility): boolean {
  if (!lm) return false;
  const p = lm[IDX[key]];
  if (!p) return false;
  return vis(p) >= min && p.x > -0.02 && p.x < 1.02 && p.y > -0.02 && p.y < 1.02;
}

/** 관절 좌표로 가드 측정값을 계산합니다. 인식이 불확실하면 null. aspect = 영상 가로/세로 비율 */
export function computeMetrics(lm: Landmark[] | null, aspect: number): GuardMetrics | null {
  if (!lm || lm.length < 25) return null;
  for (const k of REQUIRED) if (!jointVisible(lm, k)) return null;

  const P = (k: JointKey) => ({ x: lm[IDX[k]].x * aspect, y: lm[IDX[k]].y });
  const lSh = P('lShoulder');
  const rSh = P('rShoulder');
  const S = Math.hypot(lSh.x - rSh.x, lSh.y - rSh.y);
  if (S < 0.04) return null; // 너무 멀리 있거나 옆으로 섬

  const centerX = (lSh.x + rSh.x) / 2;
  const nose = P('nose');

  const side = (s: Side): SideMetrics => {
    const sh = s === 'left' ? lSh : rSh;
    const el = P(s === 'left' ? 'lElbow' : 'rElbow');
    const wr = P(s === 'left' ? 'lWrist' : 'rWrist');
    const hipKey: JointKey = s === 'left' ? 'lHip' : 'rHip';

    let lineX = sh.x;
    if (jointVisible(lm, hipKey, 0.4)) {
      const hip = P(hipKey);
      const dy = hip.y - sh.y;
      if (Math.abs(dy) > 1e-3) {
        const t = (el.y - sh.y) / dy;
        lineX = sh.x + t * (hip.x - sh.x);
      }
    }
    const outward = sh.x >= centerX ? 1 : -1;

    return {
      handHeight: (sh.y - wr.y) / S,
      handFace: Math.hypot(wr.x - nose.x, wr.y - nose.y) / S,
      elbowOut: ((el.x - lineX) * outward) / S,
      elbowLift: (sh.y - el.y) / S,
    };
  };

  return { left: side('left'), right: side('right'), shoulderWidth: S };
}

export type IssueKind = 'handLow' | 'handFar' | 'elbowOut' | 'elbowHigh';
export type Issue = { side: Side; kind: IssueKind; joint: JointKey; message: string };

const sideWord = (s: Side) => (s === 'left' ? '왼' : '오른');
const handWord = (s: Side) => (s === 'left' ? '왼손' : '오른손');

/** 등록할 때의 최소 기준 검사 */
export function checkRegisterMinimum(m: GuardMetrics): Issue[] {
  const issues: Issue[] = [];
  for (const s of ['left', 'right'] as Side[]) {
    const v = m[s];
    const wrist: JointKey = s === 'left' ? 'lWrist' : 'rWrist';
    const elbow: JointKey = s === 'left' ? 'lElbow' : 'rElbow';
    if (v.handHeight < 0) {
      issues.push({ side: s, kind: 'handLow', joint: wrist, message: `${handWord(s)}이 낮아요` });
    } else if (v.handFace > GUARD.min.handFaceDistance) {
      issues.push({ side: s, kind: 'handFar', joint: wrist, message: `${handWord(s)}을 얼굴 가까이` });
    }
    if (v.elbowOut > GUARD.min.elbowOutRegister) {
      issues.push({ side: s, kind: 'elbowOut', joint: elbow, message: `${sideWord(s)} 팔꿈치가 벌어졌어요` });
    } else if (v.elbowLift > GUARD.min.elbowAboveShoulder) {
      issues.push({ side: s, kind: 'elbowHigh', joint: elbow, message: `${sideWord(s)} 팔꿈치를 내려요` });
    }
  }
  return issues;
}

const median = (arr: number[]) => {
  const a = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};
const quantile = (arr: number[], q: number) => {
  const a = [...arr].sort((x, y) => x - y);
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
};

export type Baseline = { left: SideMetrics; right: SideMetrics };
export type CalibrationResult =
  | { ok: true; baseline: Baseline }
  | { ok: false; reason: 'notVisible' | 'moving' | 'minimum'; issues: Issue[] };

const METRIC_KEYS: (keyof SideMetrics)[] = ['handHeight', 'handFace', 'elbowOut', 'elbowLift'];

/** 3초 동안 모은 측정값으로 "내 가드" 기준을 만듭니다. */
export function calibrate(samples: GuardMetrics[], attempts: number): CalibrationResult {
  if (attempts === 0 || samples.length < 8 || samples.length / attempts < GUARD.registerMinValidRatio) {
    return { ok: false, reason: 'notVisible', issues: [] };
  }
  for (const s of ['left', 'right'] as Side[]) {
    for (const k of METRIC_KEYS) {
      const vals = samples.map((m) => m[s][k]);
      if (quantile(vals, 0.9) - quantile(vals, 0.1) > GUARD.registerMaxSpread) {
        return { ok: false, reason: 'moving', issues: [] };
      }
    }
  }
  const pick = (s: Side): SideMetrics => ({
    handHeight: median(samples.map((m) => m[s].handHeight)),
    handFace: median(samples.map((m) => m[s].handFace)),
    elbowOut: median(samples.map((m) => m[s].elbowOut)),
    elbowLift: median(samples.map((m) => m[s].elbowLift)),
  });
  const baseline: Baseline = { left: pick('left'), right: pick('right') };
  const issues = checkRegisterMinimum({ ...baseline, shoulderWidth: 1 });
  if (issues.length) return { ok: false, reason: 'minimum', issues };
  return { ok: true, baseline };
}

export type FrameEval = {
  handBad: boolean;
  elbowBad: boolean;
  badJoints: JointKey[];
};

/** 한 장면을 내 가드 기준 + 최소 기준으로 판정합니다. */
export function evaluate(m: GuardMetrics, base: Baseline): FrameEval {
  const badJoints: JointKey[] = [];
  let handBad = false;
  let elbowBad = false;
  for (const s of ['left', 'right'] as Side[]) {
    const v = m[s];
    const b = base[s];
    const h =
      v.handHeight < -GUARD.min.handBelowShoulder ||
      b.handHeight - v.handHeight >= GUARD.handDrop ||
      v.handFace - b.handFace >= GUARD.handAway;
    const e =
      v.elbowOut > GUARD.min.elbowOutRound ||
      v.elbowOut - b.elbowOut >= GUARD.elbowOut ||
      v.elbowLift > Math.max(GUARD.min.elbowAboveShoulder, b.elbowLift + GUARD.min.elbowAboveShoulder);
    if (h) {
      handBad = true;
      badJoints.push(s === 'left' ? 'lWrist' : 'rWrist');
    }
    if (e) {
      elbowBad = true;
      badJoints.push(s === 'left' ? 'lElbow' : 'rElbow');
    }
  }
  return { handBad, elbowBad, badJoints };
}

/** 측정값 흔들림을 줄이는 지수 평활 */
export class MetricsSmoother {
  private prev: GuardMetrics | null = null;
  private alpha: number;
  constructor(alpha = 0.5) {
    this.alpha = alpha;
  }
  reset() {
    this.prev = null;
  }
  push(m: GuardMetrics | null): GuardMetrics | null {
    if (!m) {
      this.prev = null;
      return null;
    }
    if (!this.prev) {
      this.prev = m;
      return m;
    }
    const a = this.alpha;
    const mix = (p: SideMetrics, c: SideMetrics): SideMetrics => ({
      handHeight: p.handHeight * (1 - a) + c.handHeight * a,
      handFace: p.handFace * (1 - a) + c.handFace * a,
      elbowOut: p.elbowOut * (1 - a) + c.elbowOut * a,
      elbowLift: p.elbowLift * (1 - a) + c.elbowLift * a,
    });
    this.prev = {
      left: mix(this.prev.left, m.left),
      right: mix(this.prev.right, m.right),
      shoulderWidth: m.shoulderWidth,
    };
    return this.prev;
  }
}

export type TrackerState = {
  unknown: boolean;
  warnHand: boolean;
  warnElbow: boolean;
  badJoints: JointKey[];
};

export type GuardStats = {
  validMs: number;
  handKeepRate: number;
  elbowKeepRate: number;
  longestBreakMs: number;
  warnings: number;
};

/** 시간에 따라 가드 상태를 추적합니다. (1초 유예, 유지율, 가장 오래 무너진 시간) */
export class GuardTracker {
  private lastT: number | null = null;
  private lastState: TrackerState | null = null;
  private handBadSince: number | null = null;
  private elbowBadSince: number | null = null;
  private anyBadSince: number | null = null;
  private unknownSince: number | null = null;
  private validMs = 0;
  private handCollapsedMs = 0;
  private elbowCollapsedMs = 0;
  private longestBreakMs = 0;
  private warnings = 0;
  private wasWarning = false;

  update(t: number, frame: FrameEval | null): TrackerState {
    // 앞 장면 상태를 지난 시간만큼 누적
    if (this.lastT !== null && this.lastState) {
      const dt = Math.min(250, Math.max(0, t - this.lastT));
      if (!this.lastState.unknown) {
        this.validMs += dt;
        if (this.lastState.warnHand) this.handCollapsedMs += dt;
        if (this.lastState.warnElbow) this.elbowCollapsedMs += dt;
      }
    }
    this.lastT = t;

    let state: TrackerState;
    if (!frame) {
      if (this.unknownSince === null) this.unknownSince = t;
      if (t - this.unknownSince > 1500) {
        this.handBadSince = null;
        this.elbowBadSince = null;
        this.anyBadSince = null;
      }
      state = { unknown: true, warnHand: false, warnElbow: false, badJoints: [] };
    } else {
      this.unknownSince = null;
      this.handBadSince = frame.handBad ? (this.handBadSince ?? t) : null;
      this.elbowBadSince = frame.elbowBad ? (this.elbowBadSince ?? t) : null;
      const anyBad = frame.handBad || frame.elbowBad;
      if (anyBad) {
        this.anyBadSince = this.anyBadSince ?? t;
        this.longestBreakMs = Math.max(this.longestBreakMs, t - this.anyBadSince);
      } else {
        this.anyBadSince = null;
      }
      const warnHand = this.handBadSince !== null && t - this.handBadSince >= GUARD.graceMs;
      const warnElbow = this.elbowBadSince !== null && t - this.elbowBadSince >= GUARD.graceMs;
      state = { unknown: false, warnHand, warnElbow, badJoints: frame.badJoints };
    }

    const warning = state.warnHand || state.warnElbow;
    if (warning && !this.wasWarning) this.warnings += 1;
    this.wasWarning = warning;
    this.lastState = state;
    return state;
  }

  stats(): GuardStats {
    const v = this.validMs;
    return {
      validMs: v,
      handKeepRate: v > 0 ? 1 - this.handCollapsedMs / v : 0,
      elbowKeepRate: v > 0 ? 1 - this.elbowCollapsedMs / v : 0,
      longestBreakMs: this.longestBreakMs,
      warnings: this.warnings,
    };
  }
}

type Pending = { t0: number; frames: number; valid: number; okSince: number | null; returned: boolean };

/** 섀도 반응 콜러: 공격 신호 뒤 가드로 돌아왔는지 측정합니다. (라운드 중 경고는 띄우지 않음) */
export class ReturnTracker {
  private pending: Pending[] = [];
  private measured = 0;
  private returned = 0;

  onAttackSignal(t: number) {
    this.pending.push({ t0: t, frames: 0, valid: 0, okSince: null, returned: false });
  }

  /** guardOk: true(가드 유지) / false(무너짐) / null(인식 안 됨) */
  onFrame(t: number, guardOk: boolean | null) {
    const keep: Pending[] = [];
    for (const p of this.pending) {
      const start = p.t0 + CALLER.returnIgnoreMs;
      const end = p.t0 + CALLER.returnWindowMs;
      if (t > end) {
        this.finish(p);
        continue;
      }
      if (t >= start && !p.returned) {
        p.frames += 1;
        if (guardOk !== null) p.valid += 1;
        if (guardOk) {
          p.okSince = p.okSince ?? t;
          if (t - p.okSince >= CALLER.returnHoldMs) p.returned = true;
        } else {
          p.okSince = null;
        }
      }
      keep.push(p);
    }
    this.pending = keep;
  }

  private finish(p: Pending) {
    if (p.returned) {
      this.measured += 1;
      this.returned += 1;
    } else if (p.frames > 0 && p.valid / p.frames >= 0.5) {
      this.measured += 1;
    }
  }

  /** 라운드가 끝날 때 남은 신호를 정리합니다. */
  flush() {
    for (const p of this.pending) this.finish(p);
    this.pending = [];
  }

  summary() {
    return {
      measured: this.measured,
      returned: this.returned,
      rate: this.measured > 0 ? this.returned / this.measured : null,
    };
  }
}
