// 가드 판정 로직 자동 테스트: npm test
import {
  GuardTracker,
  IDX,
  ReturnTracker,
  calibrate,
  checkRegisterMinimum,
  computeMetrics,
  evaluate,
  type GuardMetrics,
  type JointKey,
  type Landmark,
} from '../src/pose/guard.ts';
import { pickNextSignal, LEVELS, type SignalKind } from '../src/caller/signals.ts';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const ASPECT = 640 / 480;

// 정면에서 본 사람 (카메라 영상 기준: 사람의 왼쪽이 화면 오른쪽)
const GUARD_POSE: Partial<Record<JointKey, [number, number]>> = {
  nose: [0.5, 0.28],
  lShoulder: [0.58, 0.4],
  rShoulder: [0.42, 0.4],
  lElbow: [0.57, 0.52],
  rElbow: [0.43, 0.52],
  lWrist: [0.54, 0.32],
  rWrist: [0.46, 0.32],
  lHip: [0.56, 0.75],
  rHip: [0.44, 0.75],
};

function makeLandmarks(
  over: Partial<Record<JointKey, [number, number]>> = {},
  jitter = 0,
  visibility = 0.95,
): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
  const pose = { ...GUARD_POSE, ...over };
  for (const [k, v] of Object.entries(pose) as [JointKey, [number, number]][]) {
    lm[IDX[k]] = {
      x: v[0] + (Math.random() - 0.5) * jitter,
      y: v[1] + (Math.random() - 0.5) * jitter,
      visibility,
    };
  }
  return lm;
}

const metrics = (over: Partial<Record<JointKey, [number, number]>> = {}, jitter = 0) =>
  computeMetrics(makeLandmarks(over, jitter), ASPECT) as GuardMetrics;

console.log('\n[가드 측정]');
test('바른 가드: 측정값이 계산되고 최소 기준을 통과한다', () => {
  const m = metrics();
  assert(m, '측정값이 null');
  assert(m.left.handHeight > 0.2, `손 높이 ${m.left.handHeight}`);
  assert(m.left.handFace < 0.6, `손-얼굴 ${m.left.handFace}`);
  assert(Math.abs(m.left.elbowOut) < 0.1, `팔꿈치 벌어짐 ${m.left.elbowOut}`);
  assert(checkRegisterMinimum(m).length === 0, JSON.stringify(checkRegisterMinimum(m)));
});

test('양손을 내리면 "왼손/오른손이 낮아요"', () => {
  const issues = checkRegisterMinimum(metrics({ lWrist: [0.6, 0.6], rWrist: [0.4, 0.6] }));
  const msgs = issues.map((i) => i.message);
  assert(msgs.includes('왼손이 낮아요') && msgs.includes('오른손이 낮아요'), msgs.join(','));
});

test('왼손만 내리면 왼쪽만 짚는다', () => {
  const issues = checkRegisterMinimum(metrics({ lWrist: [0.6, 0.6] }));
  assert(issues.length === 1 && issues[0].side === 'left' && issues[0].joint === 'lWrist', JSON.stringify(issues));
});

test('팔꿈치를 벌리면 "팔꿈치가 벌어졌어요"', () => {
  const issues = checkRegisterMinimum(metrics({ lElbow: [0.7, 0.45], rElbow: [0.3, 0.45] }));
  assert(issues.filter((i) => i.kind === 'elbowOut').length === 2, JSON.stringify(issues));
});

test('손이 얼굴에서 멀면 "얼굴 가까이"', () => {
  const issues = checkRegisterMinimum(metrics({ lWrist: [0.7, 0.3] }));
  assert(issues.some((i) => i.kind === 'handFar' && i.side === 'left'), JSON.stringify(issues));
});

test('관절 인식이 불확실하면 판정 보류(null)', () => {
  assert(computeMetrics(makeLandmarks({}, 0, 0.3), ASPECT) === null, 'null이어야 함');
});

console.log('\n[내 가드 등록]');
test('조금씩 흔들려도 바른 가드면 등록된다', () => {
  const samples = Array.from({ length: 45 }, () => metrics({}, 0.006));
  const r = calibrate(samples, 45);
  assert(r.ok, JSON.stringify(r));
});

test('크게 움직이면 "움직이지 말고 다시"', () => {
  const samples = Array.from({ length: 45 }, (_, i) =>
    metrics(i % 2 ? {} : { lWrist: [0.6, 0.45], rWrist: [0.4, 0.45] }),
  );
  const r = calibrate(samples, 45);
  assert(!r.ok && r.reason === 'moving', JSON.stringify(r));
});

test('인식된 장면이 적으면 "상체가 보이게"', () => {
  const samples = Array.from({ length: 10 }, () => metrics());
  const r = calibrate(samples, 45);
  assert(!r.ok && r.reason === 'notVisible', JSON.stringify(r));
});

test('손을 내린 채 등록하면 거부되고 부위를 알려 준다', () => {
  const samples = Array.from({ length: 45 }, () => metrics({ lWrist: [0.6, 0.55], rWrist: [0.4, 0.55] }, 0.004));
  const r = calibrate(samples, 45);
  assert(!r.ok && r.reason === 'minimum' && r.issues.length === 2, JSON.stringify(r));
});

console.log('\n[라운드 판정]');
const base = (() => {
  const r = calibrate(Array.from({ length: 45 }, () => metrics()), 45);
  if (!r.ok) throw new Error('기준 등록 실패');
  return r.baseline;
})();

test('바른 가드는 무너짐 없음', () => {
  const e = evaluate(metrics({}, 0.004), base);
  assert(!e.handBad && !e.elbowBad, JSON.stringify(e));
});

test('손을 어깨 아래로 내리면 손 무너짐', () => {
  const e = evaluate(metrics({ rWrist: [0.4, 0.5] }), base);
  assert(e.handBad && !e.elbowBad && e.badJoints.includes('rWrist'), JSON.stringify(e));
});

test('팔꿈치만 벌리면 팔꿈치 무너짐', () => {
  const e = evaluate(metrics({ lElbow: [0.68, 0.48] }), base);
  assert(!e.handBad && e.elbowBad && e.badJoints.includes('lElbow'), JSON.stringify(e));
});

test('1초 유예: 0.5초 무너짐은 경고 없음, 1.5초 무너짐은 경고', () => {
  const tr = new GuardTracker();
  const ok = evaluate(metrics(), base);
  const bad = evaluate(metrics({ lWrist: [0.6, 0.55] }), base);
  let t = 0;
  for (let i = 0; i < 30; i++) tr.update((t += 66), ok);
  let warned = false;
  for (let i = 0; i < 8; i++) warned = tr.update((t += 66), bad).warnHand || warned;
  assert(!warned, '0.5초에 경고하면 안 됨');
  for (let i = 0; i < 10; i++) tr.update((t += 66), ok);
  let warnAt = -1;
  for (let i = 0; i < 23; i++) {
    const s = tr.update((t += 66), bad);
    if (s.warnHand && warnAt < 0) warnAt = i;
  }
  assert(warnAt >= 14 && warnAt <= 16, `경고 시점 ${warnAt}번째 장면 (약 1초 뒤여야 함)`);
  const st = tr.stats();
  assert(st.handKeepRate > 0.7 && st.handKeepRate < 0.95, `손 유지율 ${st.handKeepRate}`);
  assert(st.elbowKeepRate === 1, `팔꿈치 유지율 ${st.elbowKeepRate}`);
  assert(st.longestBreakMs > 1300, `최장 무너짐 ${st.longestBreakMs}`);
  assert(st.warnings === 1, `경고 횟수 ${st.warnings}`);
});

test('인식 안 된 시간은 유지율 계산에서 빠진다', () => {
  const tr = new GuardTracker();
  const ok = evaluate(metrics(), base);
  let t = 0;
  for (let i = 0; i < 15; i++) tr.update((t += 66), ok);
  for (let i = 0; i < 30; i++) tr.update((t += 66), null);
  const st = tr.stats();
  assert(st.handKeepRate === 1 && st.validMs < 1200, JSON.stringify(st));
});

console.log('\n[가드 복귀율]');
test('펀치 후 돌아오면 성공, 안 돌아오면 실패', () => {
  const rt = new ReturnTracker();
  let t = 0;
  rt.onAttackSignal(t);
  for (; t <= 2000; t += 66) rt.onFrame(t, t < 400 ? false : true);
  rt.onAttackSignal(t);
  const t1 = t;
  for (; t <= t1 + 2000; t += 66) rt.onFrame(t, false);
  rt.flush();
  const s = rt.summary();
  assert(s.measured === 2 && s.returned === 1 && s.rate === 0.5, JSON.stringify(s));
});

test('인식이 안 된 신호는 계산에서 뺀다', () => {
  const rt = new ReturnTracker();
  rt.onAttackSignal(0);
  for (let t = 0; t <= 2000; t += 66) rt.onFrame(t, null);
  rt.flush();
  const s = rt.summary();
  assert(s.measured === 0 && s.rate === null, JSON.stringify(s));
});

console.log('\n[섀도 반응 콜러 신호]');
test('레벨 1은 잽·스트레이트만 나온다', () => {
  const seen = new Set<SignalKind>();
  let prev: SignalKind[] = [];
  for (let i = 0; i < 300; i++) {
    const k = pickNextSignal(1, prev);
    seen.add(k);
    prev = [...prev, k].slice(-2);
  }
  assert([...seen].every((k) => k === 'jab' || k === 'straight'), [...seen].join(','));
});

test('레벨 3은 공격과 방어가 모두 나온다', () => {
  const seen = new Set<SignalKind>();
  let prev: SignalKind[] = [];
  for (let i = 0; i < 400; i++) {
    const k = pickNextSignal(3, prev);
    seen.add(k);
    prev = [...prev, k].slice(-2);
  }
  assert(LEVELS[3].pool.every((k) => seen.has(k)), [...seen].join(','));
});

test('같은 신호가 세 번 연속 나오지 않는다', () => {
  let prev: SignalKind[] = [];
  for (let i = 0; i < 1000; i++) {
    const k = pickNextSignal(1, prev);
    assert(!(prev.length === 2 && prev[0] === k && prev[1] === k), `${i}번째에 ${k} 3연속`);
    prev = [...prev, k].slice(-2);
  }
});

console.log(`\n결과: ${passed}개 통과, ${failed}개 실패\n`);
if (failed > 0) process.exit(1);
