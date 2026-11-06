// 섀도 반응 콜러: 학생이 신호대로 동작했는지 판정합니다. (화면과 분리된 순수 계산 코드)
//
// 방법: 신호가 나오기 직전 0.4초의 자세를 "기준 자세"로 잡고, 신호 뒤에 어디가 움직였는지 봅니다.
// - 펀치(잽·스트레이트·원투): 손목이 얼굴에서 멀어짐 (얼굴 기준으로 재므로 슬립·더킹 때 손이 같이 움직여도 펀치로 보지 않음)
// - 슬립: 머리가 엉덩이 기준으로 옆으로 움직임 (좌우 스텝은 엉덩이도 같이 움직여서 슬립이 아님)
// - 더킹: 머리가 아래로 내려감
// "왼/오른"은 학생 본인 기준입니다.

import { JUDGE } from '../config.ts';
import { IDX, jointVisible, type Landmark, type Side } from '../pose/guard.ts';
import { SIGNALS, type SignalKind } from './signals.ts';

export type Stance = 'orthodox' | 'southpaw';
export const STANCE_LABEL: Record<Stance, string> = {
  orthodox: '오른손잡이 (왼손이 앞)',
  southpaw: '왼손잡이 (오른손이 앞)',
};
export const leadSide = (s: Stance): Side => (s === 'orthodox' ? 'left' : 'right');

type V3 = { x: number; y: number; z: number };
type Feature = {
  t: number;
  /** 어깨너비 */
  S: number;
  /** 손목 - 코 */
  wrist: Record<Side, V3>;
  /** 손목이 같은 쪽 어깨선보다 위에 있는 정도 */
  handHeight: Record<Side, number>;
  /** 머리가 학생 왼쪽으로 간 정도 (엉덩이가 보이면 엉덩이 기준) */
  headLat: number;
  hipRef: boolean;
  headY: number;
};

export type Detected = SignalKind | 'none' | 'other';
export type JudgeResult = {
  expected: SignalKind;
  detected: Detected | 'unknown';
  correct: boolean | null;
  reactionMs: number | null;
  t0: number;
};

/** 한 장면의 관절 좌표에서 판정에 쓸 값을 뽑습니다. 인식이 불확실하면 null */
export function extractFeature(lm: Landmark[] | null, aspect: number, t: number): Feature | null {
  if (!lm || lm.length < 25) return null;
  for (const k of ['nose', 'lShoulder', 'rShoulder', 'lWrist', 'rWrist'] as const) if (!jointVisible(lm, k)) return null;
  const P = (i: number): V3 => ({ x: lm[i].x * aspect, y: lm[i].y, z: (lm[i].z ?? 0) * aspect });
  const nose = P(IDX.nose);
  const lSh = P(IDX.lShoulder);
  const rSh = P(IDX.rShoulder);
  const S = Math.hypot(lSh.x - rSh.x, lSh.y - rSh.y);
  if (S < 0.04) return null;
  const leftDir = lSh.x >= rSh.x ? 1 : -1; // 화면에서 학생 왼쪽 방향
  const rel = (i: number): V3 => {
    const w = P(i);
    return { x: w.x - nose.x, y: w.y - nose.y, z: w.z - nose.z };
  };
  const hipRef = jointVisible(lm, 'lHip', 0.4) && jointVisible(lm, 'rHip', 0.4);
  const baseX = hipRef ? ((lm[IDX.lHip].x + lm[IDX.rHip].x) / 2) * aspect : 0;
  return {
    t,
    S,
    wrist: { left: rel(IDX.lWrist), right: rel(IDX.rWrist) },
    handHeight: {
      left: (lSh.y - lm[IDX.lWrist].y) / S,
      right: (rSh.y - lm[IDX.rWrist].y) / S,
    },
    headLat: (nose.x - baseX) * leftDir,
    hipRef,
    headY: nose.y,
  };
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

type Reference = {
  S: number;
  wrist: Record<Side, V3>;
  headLat: number;
  hipRef: boolean;
  headY: number;
};

function makeReference(frames: Feature[]): Reference | null {
  if (frames.length < 2) return null;
  const v = (f: (x: Feature) => number) => median(frames.map(f));
  const w = (s: Side): V3 => ({ x: v((f) => f.wrist[s].x), y: v((f) => f.wrist[s].y), z: v((f) => f.wrist[s].z) });
  return {
    S: v((f) => f.S),
    wrist: { left: w('left'), right: w('right') },
    headLat: v((f) => f.headLat),
    hipRef: frames.every((f) => f.hipRef),
    headY: v((f) => f.headY),
  };
}

type Streak = { count: number; since: number | null; crossedAt: number | null; dir: number };
const newStreak = (): Streak => ({ count: 0, since: null, crossedAt: null, dir: 0 });
function step(s: Streak, on: boolean, t: number, need: number, dir = 0) {
  if (s.crossedAt !== null) return;
  if (on) {
    s.since = s.since ?? t;
    s.count += 1;
    if (s.count === 1) s.dir = dir;
    if (s.count >= need) s.crossedAt = s.since;
  } else {
    s.count = 0;
    s.since = null;
  }
}

type Pending = {
  expected: SignalKind;
  t0: number;
  end: number;
  ref: Reference | null;
  frames: number;
  valid: number;
  hand: Record<Side, Streak>;
  slip: Streak;
  duck: Streak;
};

export class ActionJudge {
  private stance: Stance;
  private history: Feature[] = [];
  private pending: Pending[] = [];
  private results: JudgeResult[] = [];
  private fresh: JudgeResult[] = [];
  private lastFrameT: number | null = null;

  constructor(stance: Stance) {
    this.stance = stance;
  }

  /** 신호가 나왔을 때 호출. intervalMs는 신호 간격 */
  onSignal(t: number, kind: SignalKind, intervalMs: number) {
    let refFrames = this.history.filter((f) => f.t >= t - JUDGE.referenceMs && f.t <= t);
    // 느린 태블릿이라 장면 수가 적으면 1초 안의 마지막 두 장면을 씁니다.
    if (refFrames.length < 2) refFrames = this.history.filter((f) => f.t <= t).slice(-2);
    const windowMs = Math.min(JUDGE.windowMs, Math.max(900, intervalMs - 300));
    this.pending.push({
      expected: kind,
      t0: t,
      end: t + windowMs,
      ref: makeReference(refFrames),
      frames: 0,
      valid: 0,
      hand: { left: newStreak(), right: newStreak() },
      slip: newStreak(),
      duck: newStreak(),
    });
  }

  /** 자세 인식 장면마다 호출 */
  onFrame(t: number, lm: Landmark[] | null, aspect: number) {
    const f = extractFeature(lm, aspect, t);
    // 느린 태블릿(장면 간격이 김)에서는 한 장면만 넘어도 동작으로 인정합니다.
    const need = this.lastFrameT !== null && t - this.lastFrameT > JUDGE.slowFrameMs ? 1 : JUDGE.minFrames;
    this.lastFrameT = t;
    if (f) {
      this.history.push(f);
      while (this.history.length && this.history[0].t < t - 1000) this.history.shift();
    }
    const keep: Pending[] = [];
    for (const p of this.pending) {
      if (t > p.end) {
        this.finish(p);
        continue;
      }
      if (t > p.t0) {
        p.frames += 1;
        if (f && p.ref) {
          p.valid += 1;
          this.observe(p, p.ref, f, need);
          // 신호대로 움직인 것이 확인되면 바로 판정 (화면에 ✓를 빨리 보여 주려고)
          // 잽은 뒤따르는 뒷손(원투)이 있는지 잠깐 더 봅니다.
          const c = this.classify(p);
          const settled = p.expected !== 'jab' || (c.at !== null && t - c.at >= JUDGE.jabConfirmMs);
          if (c.detected === p.expected && settled) {
            this.finish(p);
            continue;
          }
        }
      }
      keep.push(p);
    }
    this.pending = keep;
  }

  private observe(p: Pending, ref: Reference, f: Feature, need: number) {
    const S = ref.S;
    for (const s of ['left', 'right'] as Side[]) {
      const d2 = Math.hypot(f.wrist[s].x - ref.wrist[s].x, f.wrist[s].y - ref.wrist[s].y) / S;
      const forward = Math.max(0, (ref.wrist[s].z - f.wrist[s].z) / S);
      const move = d2 + JUDGE.forwardWeight * forward;
      const dropped = f.handHeight[s] < -JUDGE.dropBelowShoulder;
      step(p.hand[s], move >= JUDGE.punchMove && !dropped, f.t, need);
    }
    const lat = ref.hipRef === f.hipRef ? (f.headLat - ref.headLat) / S : 0;
    const drop = (f.headY - ref.headY) / S;
    step(p.duck, drop >= JUDGE.duckDrop && drop >= Math.abs(lat), f.t, need);
    step(p.slip, Math.abs(lat) >= JUDGE.slipLateral && Math.abs(lat) > drop, f.t, need, Math.sign(lat));
  }

  private classify(p: Pending): { detected: Detected; at: number | null } {
    const lead = leadSide(this.stance);
    const rear: Side = lead === 'left' ? 'right' : 'left';
    const tl = p.hand[lead].crossedAt;
    const tr = p.hand[rear].crossedAt;
    const hand = (): { detected: Detected; at: number | null } | null => {
      if (tl !== null && tr !== null) {
        return tl <= tr + JUDGE.oneTwoTieMs ? { detected: 'onetwo', at: tl } : { detected: 'other', at: tr };
      }
      if (tl !== null) return { detected: 'jab', at: tl };
      if (tr !== null) return { detected: 'straight', at: tr };
      return null;
    };
    const head = (): { detected: Detected; at: number | null } | null => {
      if (p.duck.crossedAt !== null) return { detected: 'duck', at: p.duck.crossedAt };
      if (p.slip.crossedAt !== null)
        return { detected: p.slip.dir > 0 ? 'slipLeft' : 'slipRight', at: p.slip.crossedAt };
      return null;
    };
    // 신호가 공격이면 손을 먼저, 방어면 머리를 먼저 봅니다.
    const order = SIGNALS[p.expected].attack ? [hand, head] : [head, hand];
    for (const fn of order) {
      const r = fn();
      if (r) return r;
    }
    return { detected: 'none', at: null };
  }

  private finish(p: Pending) {
    let r: JudgeResult;
    if (!p.ref || p.frames === 0 || p.valid / p.frames < JUDGE.minValidRatio) {
      r = { expected: p.expected, detected: 'unknown', correct: null, reactionMs: null, t0: p.t0 };
    } else {
      const c = this.classify(p);
      const correct = c.detected === p.expected;
      r = {
        expected: p.expected,
        detected: c.detected,
        correct,
        reactionMs: correct && c.at !== null ? Math.max(0, c.at - p.t0) : null,
        t0: p.t0,
      };
    }
    this.results.push(r);
    this.fresh.push(r);
  }

  /** 라운드가 끝날 때 남은 신호를 마무리합니다. */
  flush() {
    for (const p of this.pending) this.finish(p);
    this.pending = [];
  }

  /** 마지막으로 가져간 뒤 새로 끝난 판정 결과 (화면 표시용) */
  takeFresh(): JudgeResult[] {
    const out = this.fresh;
    this.fresh = [];
    return out;
  }

  summary() {
    return summarizeJudgements(this.results);
  }
}

export type KindStat = { judged: number; correct: number };
export type JudgeSummary = {
  judged: number;
  correct: number;
  unknown: number;
  accuracy: number | null;
  avgReactionMs: number | null;
  perKind: Partial<Record<SignalKind, KindStat>>;
};

export function summarizeJudgements(results: JudgeResult[]): JudgeSummary {
  const judged = results.filter((r) => r.correct !== null);
  const correct = judged.filter((r) => r.correct);
  const times = correct.map((r) => r.reactionMs).filter((v): v is number => v !== null);
  const perKind: Partial<Record<SignalKind, KindStat>> = {};
  for (const r of judged) {
    const k = perKind[r.expected] ?? { judged: 0, correct: 0 };
    k.judged += 1;
    if (r.correct) k.correct += 1;
    perKind[r.expected] = k;
  }
  return {
    judged: judged.length,
    correct: correct.length,
    unknown: results.length - judged.length,
    accuracy: judged.length ? correct.length / judged.length : null,
    avgReactionMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
    perKind,
  };
}

/** 여러 라운드(또는 여러 번)의 요약을 합칩니다. */
export function mergeSummaries(list: JudgeSummary[]): JudgeSummary | null {
  if (!list.length) return null;
  const perKind: Partial<Record<SignalKind, KindStat>> = {};
  let judged = 0;
  let correct = 0;
  let unknown = 0;
  let rtSum = 0;
  let rtN = 0;
  for (const s of list) {
    judged += s.judged;
    correct += s.correct;
    unknown += s.unknown;
    if (s.avgReactionMs !== null) {
      rtSum += s.avgReactionMs * s.correct;
      rtN += s.correct;
    }
    for (const [k, v] of Object.entries(s.perKind) as [SignalKind, KindStat][]) {
      const cur = perKind[k] ?? { judged: 0, correct: 0 };
      perKind[k] = { judged: cur.judged + v.judged, correct: cur.correct + v.correct };
    }
  }
  return {
    judged,
    correct,
    unknown,
    accuracy: judged ? correct / judged : null,
    avgReactionMs: rtN ? rtSum / rtN : null,
    perKind,
  };
}
