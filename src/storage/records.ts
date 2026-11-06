// 태블릿 안(localStorage)에만 저장합니다. 서버로 보내지 않습니다.
import type { Baseline } from '../pose/guard.ts';
import { SIGNALS, type Level, type SignalKind } from '../caller/signals.ts';
import { STANCE_LABEL, mergeSummaries, type JudgeSummary, type Stance } from '../caller/actionJudge.ts';

export type GuardRound = {
  at: number;
  mission: string;
  seconds: number;
  handKeepRate: number;
  elbowKeepRate: number;
  longestBreakMs: number;
  warnings: number;
};

export type CallerRound = {
  at: number;
  level: Level;
  rounds: number;
  signals: number;
  measured: number;
  returned: number;
  rate: number | null;
  /** 앞손 설정 (동작 판정을 켠 경우) */
  stance?: Stance;
  /** 신호대로 동작했는지 판정한 결과 (카메라를 끈 경우 null) */
  action?: JudgeSummary | null;
};

export const CHECKLIST = [
  { key: 'guard', label: '가드 유지', hint: '손은 얼굴 옆' },
  { key: 'chin', label: '턱 당기기', hint: '턱을 들지 않기' },
  { key: 'recover', label: '펀치 후 가드 복귀', hint: '뻗고 바로 돌아오기' },
  { key: 'elbow', label: '팔꿈치 붙이기', hint: '옆구리에 붙이기' },
  { key: 'stance', label: '스탠스', hint: '발은 어깨너비' },
] as const;
export type ChecklistKey = (typeof CHECKLIST)[number]['key'];
export type Score = 1 | 2 | 3;
export const SCORE_LABEL: Record<Score, string> = { 3: '잘했어요', 2: '조금 더', 1: '아직이에요' };

export type SessionRecord = {
  id: string;
  lesson: number;
  date: string;
  studentId: string;
  checklist: Record<ChecklistKey, Score>;
  reflection: string;
  guard: GuardRound[];
  caller: CallerRound[];
};

type TodayData = { date: string; guard: GuardRound[]; caller: CallerRound[] };
type SavedBaseline = { date: string; savedAt: number; baseline: Baseline };

const K = {
  student: 'bsc.studentId',
  records: 'bsc.records.v1',
  today: 'bsc.today.v1',
  baseline: 'bsc.baseline.v1',
};

const memory = new Map<string, string>();
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key) ?? memory.get(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    const raw = memory.get(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  }
}
function write(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    localStorage.setItem(key, raw);
  } catch {
    // 저장 공간을 쓸 수 없으면 이번 사용 동안만 기억합니다.
  }
}

export function todayString(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 학번
export const getStudentId = () => read<string>(K.student, '');
export const setStudentId = (id: string) => write(K.student, id);

// 오늘 측정값
export function getToday(): TodayData {
  const t = read<TodayData | null>(K.today, null);
  if (!t || t.date !== todayString()) return { date: todayString(), guard: [], caller: [] };
  return t;
}
export function addGuardRound(r: GuardRound) {
  const t = getToday();
  write(K.today, { ...t, guard: [...t.guard, r] });
}
export function addCallerRound(r: CallerRound) {
  const t = getToday();
  write(K.today, { ...t, caller: [...t.caller, r] });
}

// 내 가드 (오늘 등록한 것만 사용)
export function getBaseline(): SavedBaseline | null {
  const b = read<SavedBaseline | null>(K.baseline, null);
  return b && b.date === todayString() ? b : null;
}
export function saveBaseline(baseline: Baseline) {
  write(K.baseline, { date: todayString(), savedAt: Date.now(), baseline });
}

// 차시 기록
export const getRecords = () => read<SessionRecord[]>(K.records, []);
export function saveRecord(rec: SessionRecord) {
  const list = getRecords().filter((r) => r.id !== rec.id);
  list.push(rec);
  list.sort((a, b) => a.lesson - b.lesson || a.date.localeCompare(b.date));
  write(K.records, list);
}
export function deleteRecord(id: string) {
  write(K.records, getRecords().filter((r) => r.id !== id));
}
export function nextLessonNumber(): number {
  const list = getRecords();
  const today = list.find((r) => r.date === todayString());
  if (today) return today.lesson;
  return list.reduce((m, r) => Math.max(m, r.lesson), 0) + 1;
}

// 요약 계산
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${Math.round(v * 100)}%`);

export function summarizeGuard(rounds: GuardRound[]) {
  if (!rounds.length) return null;
  const avg = (f: (r: GuardRound) => number) => rounds.reduce((s, r) => s + f(r), 0) / rounds.length;
  return {
    hand: avg((r) => r.handKeepRate),
    elbow: avg((r) => r.elbowKeepRate),
    longest: Math.max(...rounds.map((r) => r.longestBreakMs)),
  };
}

export function summarizeCaller(rounds: CallerRound[]) {
  const measured = rounds.reduce((s, r) => s + r.measured, 0);
  const returned = rounds.reduce((s, r) => s + r.returned, 0);
  if (!rounds.length) return null;
  const actions = rounds.map((r) => r.action).filter((a): a is JudgeSummary => !!a);
  const stance = [...rounds].reverse().find((r) => r.stance)?.stance ?? null;
  return {
    measured,
    returned,
    rate: measured > 0 ? returned / measured : null,
    maxLevel: Math.max(...rounds.map((r) => r.level)) as Level,
    action: mergeSummaries(actions),
    stance,
  };
}

/** 반응 시간 표시: 0.62초 */
export const sec = (ms: number | null | undefined) => (ms === null || ms === undefined ? '-' : `${(ms / 1000).toFixed(2)}초`);

/** 동작별 이름 (슬립은 방향까지) */
export const KIND_NAME: Record<SignalKind, string> = {
  jab: SIGNALS.jab.label,
  straight: SIGNALS.straight.label,
  onetwo: SIGNALS.onetwo.label,
  slipLeft: '왼쪽 슬립',
  slipRight: '오른쪽 슬립',
  duck: SIGNALS.duck.label,
};
export const KIND_ORDER: SignalKind[] = ['jab', 'straight', 'onetwo', 'slipLeft', 'slipRight', 'duck'];

/** 동작 점수 한 줄: "75% (판정 12번 중 9번 정답, 평균 반응 0.62초)" */
export function actionLine(a: JudgeSummary | null | undefined): string {
  if (!a) return '측정 안 함';
  if (a.accuracy === null) return '판정 안 됨 (몸이 잘 안 보였어요)';
  const rt = a.avgReactionMs !== null ? `, 평균 반응 ${sec(a.avgReactionMs)}` : '';
  const early = a.early ? `, 신호 전에 움직임 ${a.early}번` : '';
  return `${pct(a.accuracy)} (판정 ${a.judged}번 중 ${a.correct}번 정답${rt}${early})`;
}

/** 구글 폼·클래스룸에 붙여 넣을 요약 글 */
export function buildCopyText(rec: SessionRecord): string {
  const lines: string[] = [];
  lines.push(`[복싱 셀프코치] 학번 ${rec.studentId} · ${rec.lesson}차시 · ${rec.date}`);
  if (rec.guard.length) {
    lines.push('■ 가드 체크');
    rec.guard.forEach((g, i) => {
      lines.push(
        `  ${i + 1}) ${g.mission} ${g.seconds}초 - 손 유지 ${pct(g.handKeepRate)}, 팔꿈치 유지 ${pct(g.elbowKeepRate)}, 가장 오래 무너진 시간 ${(g.longestBreakMs / 1000).toFixed(1)}초`,
      );
    });
  } else {
    lines.push('■ 가드 체크: 측정 없음');
  }
  const c = summarizeCaller(rec.caller);
  if (c) {
    lines.push(`■ 섀도 반응 콜러: 최고 레벨 ${c.maxLevel}${c.stance ? ` · ${STANCE_LABEL[c.stance]}` : ''}`);
    lines.push(`  - 동작 점수: ${actionLine(c.action)}`);
    if (c.action) {
      const parts = KIND_ORDER.filter((k) => c.action?.perKind[k]?.judged).map((k) => {
        const v = c.action!.perKind[k]!;
        return `${KIND_NAME[k]} ${v.correct}/${v.judged}`;
      });
      if (parts.length) lines.push(`  - 동작별: ${parts.join(', ')}`);
    }
    lines.push(
      `  - 가드 복귀율: ${c.rate === null ? '측정 안 됨' : `${pct(c.rate)} (공격 신호 ${c.measured}번 중 ${c.returned}번)`}`,
    );
  } else {
    lines.push('■ 섀도 반응 콜러: 기록 없음');
  }
  lines.push('■ 자기점검');
  for (const item of CHECKLIST) {
    lines.push(`  - ${item.label}: ${SCORE_LABEL[rec.checklist[item.key]]}`);
  }
  lines.push(`■ 소감: ${rec.reflection.trim() || '(없음)'}`);
  return lines.join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
