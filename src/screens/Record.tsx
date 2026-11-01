import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BarChart3, ClipboardCopy, Minus, NotebookPen, Plus, Shield, Trash2 } from 'lucide-react';
import { Button, Card, EmptyState, Field, ScreenHeader } from '../components/ui.tsx';
import {
  CHECKLIST,
  SCORE_LABEL,
  buildCopyText,
  copyText,
  deleteRecord,
  getRecords,
  getStudentId,
  getToday,
  nextLessonNumber,
  pct,
  saveRecord,
  setStudentId,
  summarizeCaller,
  summarizeGuard,
  todayString,
  type ChecklistKey,
  type Score,
  type SessionRecord,
} from '../storage/records.ts';

export function RecordScreen({ onExit, onGoGuard }: { onExit: () => void; onGoGuard: () => void }) {
  const today = useMemo(() => getToday(), []);
  const [studentId, setId] = useState(getStudentId());
  const [lesson, setLesson] = useState(nextLessonNumber());
  const existing = useMemo(() => getRecords().find((r) => r.date === todayString() && r.lesson === lesson), [lesson]);
  const [checklist, setChecklist] = useState<Partial<Record<ChecklistKey, Score>>>(existing?.checklist ?? {});
  const [reflection, setReflection] = useState(existing?.reflection ?? '');
  const [records, setRecords] = useState<SessionRecord[]>(getRecords());
  const [toast, setToast] = useState<string>('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const guardSum = summarizeGuard(today.guard);
  const callerSum = summarizeCaller(today.caller);
  const answered = CHECKLIST.every((c) => checklist[c.key]);
  const canSave = studentId.trim().length > 0 && answered;

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3200);
  };

  const save = async () => {
    if (!canSave) return;
    setStudentId(studentId.trim());
    const rec: SessionRecord = {
      id: `${todayString()}-${lesson}`,
      lesson,
      date: todayString(),
      studentId: studentId.trim(),
      checklist: checklist as Record<ChecklistKey, Score>,
      reflection: reflection.trim(),
      guard: today.guard,
      caller: today.caller,
    };
    saveRecord(rec);
    setRecords(getRecords());
    const ok = await copyText(buildCopyText(rec));
    showToast(ok ? '저장하고 복사했어요! 구글 폼이나 클래스룸에 붙여 넣어 주세요.' : '저장했어요. 복사가 안 되면 기록 카드의 복사 버튼을 눌러 주세요.');
  };

  const copyOne = async (rec: SessionRecord) => {
    const ok = await copyText(buildCopyText(rec));
    showToast(ok ? `${rec.lesson}차시 결과를 복사했어요.` : '복사하지 못했어요.');
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="내 기록" onBack={onExit} />
      <main className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-6 pb-6 md:grid-cols-[1.15fr_1fr]">
        <div className="space-y-5">
          <Card className="grid gap-5 sm:grid-cols-2">
            <Field label="학번" hint="이름은 쓰지 않아요">
              <input
                inputMode="numeric"
                value={studentId}
                onChange={(e) => setId(e.target.value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 10))}
                placeholder="예: 10203"
                className="h-14 w-full rounded-2xl bg-slate-100 px-4 text-xl font-bold outline-none transition-all duration-200 focus:bg-white focus:shadow-md focus:ring-2 focus:ring-mint-300"
              />
            </Field>
            <Field label="차시">
              <div className="flex h-14 items-center gap-2">
                <button
                  type="button"
                  aria-label="차시 줄이기"
                  onClick={() => setLesson((l) => Math.max(1, l - 1))}
                  className="pressable flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100"
                >
                  <Minus className="h-5 w-5" />
                </button>
                <span className="tabular w-20 text-center text-3xl font-black">{lesson}</span>
                <button
                  type="button"
                  aria-label="차시 늘리기"
                  onClick={() => setLesson((l) => Math.min(30, l + 1))}
                  className="pressable flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100"
                >
                  <Plus className="h-5 w-5" />
                </button>
              </div>
            </Field>
          </Card>

          <Card className="space-y-4">
            <h2 className="text-xl font-extrabold">오늘 AI 측정값 (자동 입력)</h2>
            {!guardSum && !callerSum ? (
              <EmptyState
                icon={<Shield className="h-10 w-10" />}
                title="오늘 측정한 기록이 아직 없어요"
                desc="가드 체크나 섀도 반응 콜러를 하면 여기에 자동으로 들어와요."
                action={
                  <Button size="md" onClick={onGoGuard}>
                    가드 체크부터 해 볼까요?
                  </Button>
                }
              />
            ) : (
              <div className="space-y-3">
                {today.guard.map((g, i) => (
                  <div key={g.at} className="flex flex-wrap items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                    <span className="font-extrabold">
                      {i + 1}. {g.mission}
                    </span>
                    <span className="text-ink-soft">{g.seconds}초</span>
                    <span className="ml-auto flex gap-2 text-sm font-bold">
                      <span className="rounded-xl bg-mint-50 px-3 py-1 text-mint-700">손 {pct(g.handKeepRate)}</span>
                      <span className="rounded-xl bg-mint-50 px-3 py-1 text-mint-700">팔꿈치 {pct(g.elbowKeepRate)}</span>
                    </span>
                  </div>
                ))}
                {callerSum && (
                  <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                    <span className="font-extrabold">섀도 반응 콜러</span>
                    <span className="text-ink-soft">최고 레벨 {callerSum.maxLevel}</span>
                    <span className="ml-auto flex flex-wrap gap-2 text-sm font-bold">
                      <span className="rounded-xl bg-slate-200/60 px-3 py-1 text-straight">
                        동작 점수{' '}
                        {!callerSum.action ? '측정 안 함' : callerSum.action.accuracy === null ? '판정 안 됨' : pct(callerSum.action.accuracy)}
                      </span>
                      <span className="rounded-xl bg-amber-50 px-3 py-1 text-amber-700">
                        가드 복귀 {callerSum.rate === null ? '측정 안 됨' : pct(callerSum.rate)}
                      </span>
                    </span>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card className="space-y-4">
            <h2 className="text-xl font-extrabold">자기점검</h2>
            <div className="space-y-3">
              {CHECKLIST.map((c) => (
                <div key={c.key} className="flex flex-wrap items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                  <div className="min-w-36 flex-1">
                    <div className="font-extrabold">{c.label}</div>
                    <div className="text-sm text-ink-soft">{c.hint}</div>
                  </div>
                  <div className="flex gap-2">
                    {([3, 2, 1] as Score[]).map((s) => {
                      const on = checklist[c.key] === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setChecklist((p) => ({ ...p, [c.key]: s }))}
                          className={`pressable h-11 rounded-xl px-3 text-sm font-bold ${
                            on ? (s === 3 ? 'bg-mint-500 text-white' : s === 2 ? 'bg-mint-200 text-mint-700' : 'bg-slate-300 text-ink') : 'bg-white text-ink-soft shadow-sm'
                          }`}
                        >
                          {SCORE_LABEL[s]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <Field label="소감 한 줄">
              <input
                value={reflection}
                maxLength={80}
                onChange={(e) => setReflection(e.target.value)}
                placeholder="예: 잽을 뻗은 뒤 손이 늦게 돌아와서 다음에는 빨리 당길 거예요."
                className="h-14 w-full rounded-2xl bg-slate-100 px-4 text-lg outline-none transition-all duration-200 focus:bg-white focus:shadow-md focus:ring-2 focus:ring-mint-300"
              />
            </Field>
          </Card>

          <Button size="xl" className="w-full" onClick={save} disabled={!canSave}>
            <ClipboardCopy className="h-7 w-7" /> 저장하고 결과 복사
          </Button>
          {!canSave && (
            <p className="text-center text-sm text-ink-soft">
              {studentId.trim() ? '자기점검 5문항을 모두 골라 주세요.' : '학번을 먼저 써 주세요.'}
            </p>
          )}
        </div>

        <div className="space-y-5">
          <Card className="space-y-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-mint-600" />
              <h2 className="text-xl font-extrabold">차시별 변화</h2>
            </div>
            {records.length === 0 ? (
              <EmptyState
                icon={<NotebookPen className="h-10 w-10" />}
                title="아직 저장한 기록이 없어요"
                desc="첫 차시를 기록하면 여기에서 내 가드가 어떻게 좋아지는지 볼 수 있어요!"
              />
            ) : (
              <History records={records} />
            )}
          </Card>

          {records.length > 0 && (
            <Card className="space-y-3">
              <h2 className="text-xl font-extrabold">저장한 기록</h2>
              {[...records].reverse().map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                  <div className="flex-1">
                    <div className="font-extrabold">
                      {r.lesson}차시 <span className="font-medium text-ink-soft">· {r.date}</span>
                    </div>
                    <div className="truncate text-sm text-ink-soft">{r.reflection || '소감 없음'}</div>
                  </div>
                  <Button size="md" variant="white" onClick={() => copyOne(r)}>
                    <ClipboardCopy className="h-5 w-5" /> 복사
                  </Button>
                  {confirmDelete === r.id ? (
                    <Button
                      size="md"
                      variant="danger"
                      onClick={() => {
                        deleteRecord(r.id);
                        setRecords(getRecords());
                        setConfirmDelete(null);
                      }}
                    >
                      정말 지울까요?
                    </Button>
                  ) : (
                    <Button size="md" variant="ghost" aria-label="기록 지우기" onClick={() => setConfirmDelete(r.id)}>
                      <Trash2 className="h-5 w-5" />
                    </Button>
                  )}
                </div>
              ))}
            </Card>
          )}
        </div>
      </main>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-ink px-6 py-4 text-lg font-bold text-white shadow-md"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Bar({ value, color }: { value: number | null; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
        {value !== null && <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.round(value * 100)}%` }} />}
      </div>
      <span className="tabular w-12 text-right text-sm font-bold">{pct(value)}</span>
    </div>
  );
}

function History({ records }: { records: SessionRecord[] }) {
  const rows = records.map((r) => {
    const g = summarizeGuard(r.guard);
    const c = summarizeCaller(r.caller);
    return { r, hand: g?.hand ?? null, elbow: g?.elbow ?? null, act: c?.action?.accuracy ?? null, ret: c?.rate ?? null };
  });
  const last = rows[rows.length - 1];
  const prev = rows.length > 1 ? rows[rows.length - 2] : null;
  const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.round((a - b) * 100));
  const dHand = prev ? diff(last.hand, prev.hand) : null;
  const dElbow = prev ? diff(last.elbow, prev.elbow) : null;
  const dAct = prev ? diff(last.act, prev.act) : null;
  const changes = [
    dHand !== null && `손 유지율 ${dHand >= 0 ? '+' : ''}${dHand}%p`,
    dElbow !== null && `팔꿈치 유지율 ${dElbow >= 0 ? '+' : ''}${dElbow}%p`,
    dAct !== null && `동작 점수 ${dAct >= 0 ? '+' : ''}${dAct}%p`,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 text-sm font-bold text-ink-soft">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-mint-500" /> 손 유지율
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-mint-300" /> 팔꿈치 유지율
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-straight" /> 동작 점수
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-defense" /> 가드 복귀율
        </span>
      </div>
      {rows.map(({ r, hand, elbow, act, ret }) => (
        <div key={r.id} className="space-y-1.5">
          <div className="font-extrabold">{r.lesson}차시</div>
          <Bar value={hand} color="bg-mint-500" />
          <Bar value={elbow} color="bg-mint-300" />
          <Bar value={act} color="bg-straight" />
          <Bar value={ret} color="bg-defense" />
        </div>
      ))}
      {prev && changes.length > 0 && (
        <div className="rounded-2xl bg-mint-50 p-4 font-bold text-mint-700">지난 차시보다 {changes.join(', ')}</div>
      )}
    </div>
  );
}
