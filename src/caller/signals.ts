// 섀도 반응 콜러의 신호 정의

export type SignalKind = 'jab' | 'straight' | 'onetwo' | 'slipLeft' | 'slipRight' | 'duck';
export type Level = 1 | 2 | 3;

export type SignalInfo = {
  kind: SignalKind;
  label: string;
  sub: string;
  attack: boolean;
};

export const SIGNALS: Record<SignalKind, SignalInfo> = {
  jab: { kind: 'jab', label: '잽', sub: '앞손', attack: true },
  straight: { kind: 'straight', label: '스트레이트', sub: '뒷손 쭉 뻗어 치기', attack: true },
  onetwo: { kind: 'onetwo', label: '원투', sub: '잽 + 스트레이트', attack: true },
  slipLeft: { kind: 'slipLeft', label: '슬립', sub: '왼쪽으로 피하기', attack: false },
  slipRight: { kind: 'slipRight', label: '슬립', sub: '오른쪽으로 피하기', attack: false },
  duck: { kind: 'duck', label: '덕킹', sub: '숙여 피하기', attack: false },
};

export const LEVELS: Record<Level, { name: string; desc: string; pool: SignalKind[]; weights: number[] }> = {
  1: { name: '레벨 1', desc: '잽 · 스트레이트 단타', pool: ['jab', 'straight'], weights: [1, 1] },
  2: {
    name: '레벨 2',
    desc: '원투 중심 (잽 · 스트레이트 · 원투)',
    pool: ['jab', 'straight', 'onetwo'],
    weights: [1, 1, 2],
  },
  3: {
    name: '레벨 3',
    desc: '공격 · 방어 섞기',
    pool: ['jab', 'straight', 'onetwo', 'slipLeft', 'slipRight', 'duck'],
    weights: [1, 1, 1.5, 1, 1, 1],
  },
};

/** 다음 신호를 고릅니다. 같은 신호가 세 번 연속 나오지 않게 합니다. */
export function pickNextSignal(level: Level, recent: SignalKind[], rand: () => number = Math.random): SignalKind {
  const { pool, weights } = LEVELS[level];
  const last2 = recent.slice(-2);
  const blocked = last2.length === 2 && last2[0] === last2[1] ? last2[0] : null;
  const cand = pool.map((k, i) => ({ k, w: k === blocked ? 0 : weights[i] }));
  const total = cand.reduce((s, c) => s + c.w, 0);
  let r = rand() * total;
  for (const c of cand) {
    r -= c.w;
    if (r < 0) return c.k;
  }
  return cand.filter((c) => c.w > 0)[0].k;
}
