import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowLeft, ArrowRight, Camera, Check, NotebookPen, Play, RotateCcw, Square, TrendingUp, X } from 'lucide-react';
import { Button, Card, Choice, ScreenHeader, Stat, Toggle } from '../components/ui.tsx';
import { LEVELS, SIGNALS, pickNextSignal, type Level, type SignalKind } from '../caller/signals.ts';
import { ActionJudge, type Detected, type JudgeResult, type JudgeSummary, type Stance } from '../caller/actionJudge.ts';
import { MetricsSmoother, ReturnTracker, computeMetrics, evaluate, type Baseline, type Landmark } from '../pose/guard.ts';
import { usePoseCamera } from '../pose/usePoseCamera.ts';
import { KIND_NAME, KIND_ORDER, addCallerRound, getBaseline, pct, sec } from '../storage/records.ts';
import { prefs } from '../lib/prefs.ts';
import { beep, bell, keepScreenOn, toggleFullscreen, unlockAudio } from '../lib/device.ts';

type Step = 'settings' | 'countdown' | 'run' | 'rest' | 'result';
type Shown = { kind: SignalKind; id: number } | null;
type Feedback = { id: number; ok: boolean; text: string } | null;
type Summary = {
  signals: number;
  measured: number;
  returned: number;
  rate: number | null;
  rounds: number;
  action: JudgeSummary | null;
};

/** 앞손 설정에 따라 잽·스트레이트가 어느 손인지 */
const HANDS: Record<Stance, { lead: string; rear: string; title: string; who: string }> = {
  orthodox: { lead: '왼손', rear: '오른손', title: '왼손이 앞', who: '오른손잡이' },
  southpaw: { lead: '오른손', rear: '왼손', title: '오른손이 앞', who: '왼손잡이' },
};

/** 틀렸을 때 화면에 보여 줄 말 */
function wrongText(d: Detected | 'unknown'): string {
  if (d === 'none') return '동작이 안 보였어요';
  if (d === 'other') return '뒷손이 먼저 나갔어요';
  if (d === 'unknown') return '';
  return `보인 동작: ${KIND_NAME[d]}`;
}

const SIGNAL_TONE: Record<SignalKind, number> = {
  jab: 660,
  straight: 523,
  onetwo: 784,
  slipLeft: 392,
  slipRight: 392,
  duck: 330,
};

export function Caller({ onExit, onGoRecord, onGoGuard }: { onExit: () => void; onGoRecord: () => void; onGoGuard: () => void }) {
  const saved = getBaseline();
  const baseline: Baseline | null = saved?.baseline ?? null;

  const [level, setLevel] = useState<Level>(1);
  const [roundSec, setRoundSec] = useState(60);
  const [restSec, setRestSec] = useState(30);
  const [rounds, setRounds] = useState(2);
  const [intervalSec, setIntervalSec] = useState(3);
  const [hideWords, setHideWords] = useState(prefs.hideWords());
  const [sound, setSound] = useState(prefs.callerSound());
  const [camera, setCamera] = useState(prefs.callerCamera());
  const [stance, setStance] = useState<Stance | null>(prefs.stance());
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [live, setLive] = useState({ correct: 0, judged: 0 });
  const [step, setStep] = useState<Step>('settings');
  const [shown, setShown] = useState<Shown>(null);
  const [now, setNow] = useState(() => performance.now());
  const [roundIndex, setRoundIndex] = useState(1);
  const [visible, setVisible] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);

  const stepRef = useRef<Step>('settings');
  const stepStartRef = useRef(performance.now());
  const countdownMsRef = useRef(5000);
  const roundRef = useRef(1);
  const nextAtRef = useRef(0);
  const hideAtRef = useRef(0);
  const recentRef = useRef<SignalKind[]>([]);
  const signalCountRef = useRef(0);
  const shownIdRef = useRef(0);
  const returnRef = useRef(new ReturnTracker());
  const smootherRef = useRef(new MetricsSmoother());
  const judgeRef = useRef<ActionJudge | null>(null);
  const feedbackIdRef = useRef(0);
  const feedbackUntilRef = useRef(0);
  const liveRef = useRef({ correct: 0, judged: 0 });
  const visibleRef = useRef(false);
  const current = {
    level,
    roundSec,
    restSec,
    rounds,
    intervalSec,
    sound,
    /** 카메라로 동작 판정 */
    judging: camera && !!stance,
    /** 가드 복귀율 (내 가드가 등록된 경우만) */
    measuring: camera && !!baseline,
    stance,
  };
  const settingsRef = useRef(current);
  settingsRef.current = current;

  const go = useCallback((s: Step) => {
    stepRef.current = s;
    stepStartRef.current = performance.now();
    setStep(s);
  }, []);

  const showJudged = useCallback((results: JudgeResult[], t: number) => {
    const judged = results.filter((r) => r.correct !== null);
    if (!judged.length) return;
    for (const r of judged) {
      liveRef.current.judged += 1;
      if (r.correct) liveRef.current.correct += 1;
    }
    setLive({ ...liveRef.current });
    const last = judged[judged.length - 1];
    feedbackIdRef.current += 1;
    feedbackUntilRef.current = t + 1100;
    setFeedback({ id: feedbackIdRef.current, ok: !!last.correct, text: last.correct ? '좋아요!' : wrongText(last.detected) });
  }, []);

  const onFrame = useCallback(
    (lm: Landmark[] | null, t: number, aspect: number) => {
      const m = computeMetrics(lm, aspect);
      const vis = !!m;
      if (vis !== visibleRef.current) {
        visibleRef.current = vis;
        setVisible(vis);
      }
      const s = stepRef.current;
      const judge = judgeRef.current;
      if (judge && (s === 'run' || s === 'countdown')) {
        judge.onFrame(t, lm, aspect);
        showJudged(judge.takeFresh(), t);
      }
      if (s !== 'run' || !baseline || !settingsRef.current.measuring) return;
      const sm = smootherRef.current.push(m);
      const ok = sm ? (() => {
        const ev = evaluate(sm, baseline);
        return !ev.handBad && !ev.elbowBad;
      })() : null;
      returnRef.current.onFrame(t, ok);
    },
    [baseline, showJudged],
  );

  const camOn = camera && step !== 'result';
  const { videoRef, status, error, retry } = usePoseCamera(onFrame, camOn);

  const finishRound = useCallback(() => {
    const st = settingsRef.current;
    setShown(null);
    setFeedback(null);
    if (st.sound) bell();
    // 라운드 끝에 걸린 신호도 마무리해서 점수에 넣습니다.
    const judge = judgeRef.current;
    if (judge) {
      judge.flush();
      showJudged(judge.takeFresh(), performance.now());
    }
    if (roundRef.current < st.rounds) {
      go('rest');
    } else {
      returnRef.current.flush();
      const r = returnRef.current.summary();
      const action = judge ? judge.summary() : null;
      const res: Summary = {
        signals: signalCountRef.current,
        measured: st.measuring ? r.measured : 0,
        returned: st.measuring ? r.returned : 0,
        rate: st.measuring ? r.rate : null,
        rounds: roundRef.current,
        action,
      };
      setSummary(res);
      addCallerRound({
        at: Date.now(),
        level: st.level,
        rounds: res.rounds,
        signals: res.signals,
        measured: res.measured,
        returned: res.returned,
        rate: res.rate,
        stance: judge && st.stance ? st.stance : undefined,
        action,
      });
      go('result');
    }
  }, [go, showJudged]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const t = performance.now();
      setNow(t);
      const s = stepRef.current;
      const el = t - stepStartRef.current;
      const st = settingsRef.current;
      if (s === 'countdown' && el >= countdownMsRef.current) {
        nextAtRef.current = t + 1200;
        hideAtRef.current = 0;
        if (st.sound) bell();
        go('run');
      } else if (s === 'run') {
        if (el >= st.roundSec * 1000) {
          finishRound();
          return;
        }
        if (hideAtRef.current && t >= hideAtRef.current) {
          hideAtRef.current = 0;
          setShown(null);
        }
        if (feedbackUntilRef.current && t >= feedbackUntilRef.current) {
          feedbackUntilRef.current = 0;
          setFeedback(null);
        }
        const remain = st.roundSec * 1000 - el;
        if (t >= nextAtRef.current && remain > 1200) {
          const kind = pickNextSignal(st.level, recentRef.current);
          recentRef.current = [...recentRef.current, kind].slice(-2);
          signalCountRef.current += 1;
          shownIdRef.current += 1;
          setShown({ kind, id: shownIdRef.current });
          // 앞 신호의 판정 글자가 새 신호와 겹쳐 헷갈리지 않게 지웁니다. (점수는 위쪽 숫자에 남아요)
          feedbackUntilRef.current = 0;
          setFeedback(null);
          const ms = st.intervalSec * 1000;
          if (SIGNALS[kind].attack && st.measuring) returnRef.current.onAttackSignal(t);
          judgeRef.current?.onSignal(t, kind, ms);
          if (st.sound) beep(SIGNAL_TONE[kind], 140);
          hideAtRef.current = t + Math.min(1300, ms - 500);
          nextAtRef.current = t + Math.max(1800, ms + (Math.random() - 0.5) * 600);
        }
      } else if (s === 'rest' && el >= st.restSec * 1000) {
        roundRef.current += 1;
        setRoundIndex(roundRef.current);
        countdownMsRef.current = 3000;
        go('countdown');
      }
    }, 50);
    return () => window.clearInterval(id);
  }, [go, finishRound]);

  useEffect(() => {
    void keepScreenOn(step === 'countdown' || step === 'run' || step === 'rest');
    return () => void keepScreenOn(false);
  }, [step]);

  const start = () => {
    unlockAudio();
    roundRef.current = 1;
    setRoundIndex(1);
    signalCountRef.current = 0;
    recentRef.current = [];
    returnRef.current = new ReturnTracker();
    smootherRef.current.reset();
    const st = settingsRef.current;
    judgeRef.current = st.judging && st.stance ? new ActionJudge(st.stance) : null;
    liveRef.current = { correct: 0, judged: 0 };
    setLive({ correct: 0, judged: 0 });
    feedbackUntilRef.current = 0;
    setFeedback(null);
    setShown(null);
    setSummary(null);
    countdownMsRef.current = 5000;
    go('countdown');
  };

  const el = Math.max(0, now - stepStartRef.current);
  const running = step === 'countdown' || step === 'run' || step === 'rest';

  // 카메라 영상: 설정 화면에서는 작은 미리보기, 라운드 중에는 숨겨 둔 채로 측정만 합니다.
  const video = (
    <video
      ref={videoRef}
      playsInline
      muted
      className={
        step === 'settings'
          ? 'mirror h-full w-full rounded-2xl bg-slate-900 object-cover'
          : 'pointer-events-none fixed right-0 bottom-0 h-24 w-32 opacity-[0.01]'
      }
    />
  );

  if (running) {
    const remain = Math.max(0, Math.ceil(settingsRef.current.roundSec - el / 1000));
    return (
      <div className="fixed inset-0 z-40 select-none">
        {video}
        {step === 'countdown' && (
          <div className="flex h-full flex-col items-center justify-center gap-6 bg-canvas">
            <div className="text-[5vh] font-extrabold text-ink-soft">
              라운드 {roundIndex} / {rounds} · {LEVELS[level].name}
            </div>
            <motion.div
              key={Math.ceil((countdownMsRef.current - el) / 1000)}
              initial={{ scale: 1.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="tabular text-[40vh] leading-none font-black text-mint-500"
            >
              {Math.max(1, Math.ceil((countdownMsRef.current - el) / 1000))}
            </motion.div>
            <div className="rounded-2xl bg-white px-8 py-4 text-[4vh] font-extrabold shadow-md">표시 자리로 가서 가드!</div>
          </div>
        )}

        {step === 'run' && (
          <div className="relative h-full">
            <AnimatePresence>
              {shown ? (
                <motion.div
                  key={shown.id}
                  initial={{ opacity: 0.4, scale: 1.02 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.08 }}
                  className="absolute inset-0"
                >
                  <SignalView kind={shown.kind} hideWords={hideWords} />
                </motion.div>
              ) : (
                <motion.div
                  key="idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.08 }}
                  className="absolute inset-0 flex items-center justify-center bg-canvas"
                >
                  <span className="text-[9vh] font-black text-mint-200">가드</span>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-6">
              <span className="flex items-center gap-3">
                <span className="rounded-2xl bg-black/25 px-5 py-3 text-[3.2vh] font-extrabold text-white backdrop-blur">
                  라운드 {roundIndex}/{rounds}
                </span>
                {settingsRef.current.judging && (
                  <span className="tabular flex items-center gap-1.5 rounded-2xl bg-black/25 px-5 py-3 text-[3.2vh] font-extrabold text-white backdrop-blur">
                    <Check className="h-[3.2vh] w-[3.2vh]" strokeWidth={3} />
                    {live.correct} / {live.judged}
                  </span>
                )}
              </span>
              <span className="tabular rounded-2xl bg-black/25 px-5 py-3 text-[6vh] leading-none font-black text-white backdrop-blur">
                {Math.floor(remain / 60)}:{String(remain % 60).padStart(2, '0')}
              </span>
            </div>
            <AnimatePresence>
              {feedback && (
                <motion.div
                  key={feedback.id}
                  initial={{ opacity: 0, y: 24, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="pointer-events-none absolute inset-x-0 bottom-[6vh] flex justify-center"
                >
                  <span
                    className={`flex items-center gap-3 rounded-full bg-white px-8 py-4 text-[5vh] leading-none font-black shadow-md ${feedback.ok ? 'text-mint-600' : 'text-rose-500'}`}
                  >
                    {feedback.ok ? <Check className="h-[6vh] w-[6vh]" strokeWidth={3.5} /> : <X className="h-[6vh] w-[6vh]" strokeWidth={3.5} />}
                    {feedback.text}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
            {camera && (
              <span className="absolute right-6 bottom-6 flex items-center gap-2 rounded-2xl bg-black/25 px-4 py-2 text-sm font-bold text-white backdrop-blur">
                <span className={`h-3 w-3 rounded-full ${visible ? 'bg-mint-300' : 'bg-slate-400'}`} />
                {visible ? 'AI가 동작을 보고 있어요' : '몸이 안 보여요'}
              </span>
            )}
          </div>
        )}

        {step === 'rest' && (
          <div className="flex h-full flex-col items-center justify-center gap-4 bg-mint-500 text-white">
            <div className="text-[8vh] font-black">휴식</div>
            <div className="tabular text-[30vh] leading-none font-black">{Math.max(0, Math.ceil(restSec - el / 1000))}</div>
            <div className="text-[4vh] font-bold text-mint-50">
              다음: 라운드 {roundIndex + 1} / {rounds} · 숨 고르고 가드 준비
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setShown(null);
            go('settings');
          }}
          className="pressable absolute bottom-6 left-6 flex items-center gap-2 rounded-2xl bg-white/90 px-5 py-3 text-lg font-bold text-ink shadow-md"
        >
          <Square className="h-5 w-5" /> 그만
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title="섀도 반응 콜러"
        onBack={onExit}
        right={
          <Button variant="white" size="md" onClick={toggleFullscreen}>
            전체 화면
          </Button>
        }
      />
      <main className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-6 pb-6 md:grid-cols-[1.25fr_1fr]">
        {step === 'result' && summary ? (
          <CallerResult
            summary={summary}
            level={level}
            stance={camera ? stance : null}
            measuring={camera && !!baseline}
            onAgain={start}
            onLevelUp={
              level < 3
                ? () => {
                    setLevel((level + 1) as Level);
                    go('settings');
                  }
                : undefined
            }
            onSettings={() => go('settings')}
            onRecord={onGoRecord}
          />
        ) : (
          <>
            <div className="space-y-5">
              <Card className="space-y-4">
                <h2 className="text-xl font-extrabold">레벨 고르기</h2>
                <div className="grid gap-3">
                  {([1, 2, 3] as Level[]).map((lv) => {
                    const on = lv === level;
                    return (
                      <button
                        key={lv}
                        type="button"
                        onClick={() => setLevel(lv)}
                        className={`pressable rounded-2xl p-5 text-left ${on ? 'bg-mint-500 text-white shadow-md shadow-mint-500/25' : 'bg-slate-50 hover:bg-slate-100'}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-xl font-extrabold">{LEVELS[lv].name}</div>
                            <div className={on ? 'text-mint-50' : 'text-ink-soft'}>{LEVELS[lv].desc}</div>
                          </div>
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {LEVELS[lv].pool.map((k) => (
                              <MiniChip key={k} kind={k} />
                            ))}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Card>
              <Card className="space-y-3">
                <h2 className="text-xl font-extrabold">신호 보는 법</h2>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(['jab', 'straight', 'onetwo', 'slipLeft', 'slipRight', 'duck'] as SignalKind[]).map((k) => (
                    <div key={k} className="overflow-hidden rounded-2xl shadow-sm">
                      <div className="relative h-20">
                        <SignalView kind={k} hideWords={false} compact />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-ink-soft">화면을 향해 치지 말고, 허공에 동작해요.</p>
              </Card>
            </div>

            <div className="space-y-5">
              <Card className="space-y-4">
                <h2 className="text-xl font-extrabold">라운드 설정</h2>
                <div className="space-y-2">
                  <div className="font-bold">라운드 시간</div>
                  <Choice value={roundSec} onChange={setRoundSec} options={[60, 90, 120].map((v) => ({ value: v, label: `${v}초` }))} />
                </div>
                <div className="space-y-2">
                  <div className="font-bold">라운드 수</div>
                  <Choice value={rounds} onChange={setRounds} options={[1, 2, 3].map((v) => ({ value: v, label: `${v}번` }))} />
                </div>
                <div className="space-y-2">
                  <div className="font-bold">휴식 시간</div>
                  <Choice value={restSec} onChange={setRestSec} options={[15, 30, 45].map((v) => ({ value: v, label: `${v}초` }))} />
                </div>
                <div className="space-y-2">
                  <div className="font-bold">신호 간격</div>
                  <Choice value={intervalSec} onChange={setIntervalSec} options={[2, 3, 4, 5].map((v) => ({ value: v, label: `${v}초` }))} />
                </div>
                <Toggle
                  checked={hideWords}
                  onChange={(v) => {
                    setHideWords(v);
                    prefs.setHideWords(v);
                  }}
                  label="단어 숨기기 (도전 모드)"
                  hint="색과 화살표만 보고 반응해요"
                />
                <Toggle
                  checked={sound}
                  onChange={(v) => {
                    setSound(v);
                    prefs.setCallerSound(v);
                  }}
                  label="효과음"
                  hint="기본은 꺼짐 (여러 대가 함께 울리면 헷갈려요)"
                />
              </Card>

              <Card className="space-y-4">
                <div className="flex items-center gap-2">
                  <Camera className="h-6 w-6 text-mint-600" />
                  <h2 className="text-xl font-extrabold">AI 동작 판정</h2>
                </div>
                <Toggle
                  checked={camera}
                  onChange={(v) => {
                    setCamera(v);
                    prefs.setCallerCamera(v);
                  }}
                  label="카메라로 동작 점수 매기기"
                  hint="신호대로 움직였는지 AI가 봐요. 영상은 저장하지 않아요."
                />
                {camera && (
                  <>
                    <div className="space-y-2">
                      <div className="font-bold">
                        내 앞손 {!stance && <span className="text-rose-500">· 먼저 골라 주세요</span>}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {(['orthodox', 'southpaw'] as Stance[]).map((k) => {
                          const on = stance === k;
                          const h = HANDS[k];
                          return (
                            <button
                              key={k}
                              type="button"
                              onClick={() => {
                                setStance(k);
                                prefs.setStance(k);
                              }}
                              className={`pressable rounded-2xl p-4 text-left ${on ? 'bg-mint-500 text-white shadow-md shadow-mint-500/25' : 'bg-slate-50 hover:bg-slate-100'}`}
                            >
                              <div className="text-lg font-extrabold">{h.title}</div>
                              <div className={`text-sm ${on ? 'text-mint-50' : 'text-ink-soft'}`}>
                                {h.who} · 잽 {h.lead}, 스트레이트 {h.rear}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-sm text-ink-soft">설 때 앞에 나온 발과 같은 쪽 손이 앞손이에요.</p>
                    </div>
                    <div className="relative h-40 overflow-hidden rounded-2xl">
                      {video}
                      {status !== 'ready' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-canvas p-4 text-center">
                          {status === 'loading' ? (
                            <>
                              <div className="skeleton h-12 w-12 rounded-full" />
                              <div className="skeleton h-4 w-40 rounded-full" />
                              <span className="text-sm font-bold text-mint-700">AI 자세 인식 준비 중</span>
                            </>
                          ) : (
                            <>
                              <span className="text-sm font-bold text-rose-600">{error}</span>
                              <Button size="md" onClick={retry}>
                                다시 시도
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                      {status === 'ready' && (
                        <span className="absolute bottom-2 left-2 rounded-xl bg-black/40 px-3 py-1 text-sm font-bold text-white">
                          {visible ? '몸이 잘 보여요' : '표시 자리에 서면 확인돼요'}
                        </span>
                      )}
                    </div>
                    {baseline ? (
                      <p className="rounded-2xl bg-mint-50 px-4 py-3 text-sm font-bold text-mint-700">
                        내 가드가 등록되어 있어서 펀치 뒤 가드 복귀율도 함께 재요.
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                        <p className="flex-1 text-sm text-ink-soft">가드 체크에서 내 가드를 등록하면 가드 복귀율도 잴 수 있어요.</p>
                        <Button variant="white" size="md" onClick={onGoGuard}>
                          가드 등록하기
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </Card>

              <Button size="xl" className="w-full" onClick={start} disabled={camera && (status === 'loading' || !stance)}>
                <Play className="h-7 w-7" /> 시작
              </Button>
              {camera && !stance && <p className="text-center font-bold text-rose-500">내 앞손을 고르면 시작할 수 있어요.</p>}
              <p className="text-center text-sm text-ink-soft">시작을 누르면 5초 동안 표시 자리로 가서 가드 자세를 잡아요.</p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function MiniChip({ kind }: { kind: SignalKind }) {
  const info = SIGNALS[kind];
  const bg =
    kind === 'jab' ? 'bg-jab text-white' : kind === 'straight' ? 'bg-straight text-white' : kind === 'onetwo' ? '' : 'bg-defense text-ink';
  const arrow = kind === 'slipLeft' ? '←' : kind === 'slipRight' ? '→' : kind === 'duck' ? '↓' : '';
  if (kind === 'onetwo')
    return (
      <span className="rounded-xl bg-[linear-gradient(90deg,var(--color-jab)_50%,var(--color-straight)_50%)] px-2.5 py-1 text-sm font-extrabold text-white">
        원투
      </span>
    );
  return (
    <span className={`rounded-xl px-2.5 py-1 text-sm font-extrabold ${bg}`}>
      {arrow}
      {info.label}
    </span>
  );
}

/** 화면 가득 신호를 보여 줍니다. compact는 안내용 작은 크기 */
export function SignalView({ kind, hideWords, compact = false }: { kind: SignalKind; hideWords: boolean; compact?: boolean }) {
  const info = SIGNALS[kind];
  const big = compact ? 'text-2xl' : 'text-[24vh]';
  const sub = compact ? 'text-xs' : 'text-[5.5vh]';
  const icon = compact ? 'h-8 w-8' : 'h-[38vh] w-[38vh]';
  const words = !hideWords;

  if (kind === 'onetwo') {
    return (
      <div className="absolute inset-0 flex">
        <div className="flex-1 bg-jab" />
        <div className="flex-1 bg-straight" />
        {words && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
            <span className={`${big} leading-none font-black drop-shadow-[0_4px_16px_rgba(0,0,0,0.35)]`}>원투</span>
            <span className={`${sub} font-bold`}>{info.sub}</span>
          </div>
        )}
      </div>
    );
  }

  if (!info.attack) {
    const Icon = kind === 'slipLeft' ? ArrowLeft : kind === 'slipRight' ? ArrowRight : ArrowDown;
    return (
      <div className={`absolute inset-0 flex items-center justify-center bg-defense text-ink ${compact ? 'gap-1' : 'gap-[4vw]'}`}>
        <Icon className={icon} strokeWidth={3} />
        {words && (
          <div className="flex flex-col items-start">
            <span className={`${big} leading-none font-black`}>{info.label}</span>
            <span className={`${sub} font-bold`}>{info.sub}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`absolute inset-0 flex flex-col items-center justify-center text-white ${kind === 'jab' ? 'bg-jab' : 'bg-straight'}`}>
      {words && (
        <>
          <span className={`${big} leading-none font-black drop-shadow-[0_4px_16px_rgba(0,0,0,0.25)]`}>{info.label}</span>
          <span className={`${sub} font-bold`}>{info.sub}</span>
        </>
      )}
    </div>
  );
}

const KIND_TIP: Record<SignalKind, (h: (typeof HANDS)[Stance] | null) => string> = {
  jab: (h) => `앞손${h ? `(${h.lead})` : ''}으로 곧게 뻗었다가 바로 당겨 보세요.`,
  straight: (h) => `뒷손${h ? `(${h.rear})` : ''}을 허리를 돌리며 끝까지 쭉 뻗어 보세요.`,
  onetwo: () => '앞손 → 뒷손 순서로, 두 번 모두 끝까지 뻗어 보세요.',
  slipLeft: () => '발은 그대로 두고 상체만 왼쪽으로 기울여 보세요.',
  slipRight: () => '발은 그대로 두고 상체만 오른쪽으로 기울여 보세요.',
  duck: () => '무릎을 굽혀 머리 높이를 확 낮춰 보세요.',
};

function CallerResult({
  summary,
  level,
  stance,
  measuring,
  onAgain,
  onLevelUp,
  onSettings,
  onRecord,
}: {
  summary: Summary;
  level: Level;
  stance: Stance | null;
  measuring: boolean;
  onAgain: () => void;
  onLevelUp?: () => void;
  onSettings: () => void;
  onRecord: () => void;
}) {
  const a = summary.action;
  const hands = stance ? HANDS[stance] : null;
  const kinds = a ? KIND_ORDER.filter((k) => (a.perKind[k]?.judged ?? 0) > 0) : [];

  // 가장 약한 동작 (2번 이상 판정된 것 중 정확도가 가장 낮은 것)
  const weakest = a
    ? kinds
        .map((k) => ({ k, ...a.perKind[k]! }))
        .filter((v) => v.judged >= 2 && v.correct / v.judged < 0.6)
        .sort((x, y) => x.correct / x.judged - y.correct / y.judged)[0]
    : undefined;

  const tips: string[] = [];
  if (a && a.accuracy !== null) {
    if (a.accuracy >= 0.8) tips.push('신호대로 정확하게 움직였어요! 단어 숨기기나 레벨 올리기에 도전해 보세요.');
    else if (weakest) tips.push(`더 연습할 동작: ${KIND_NAME[weakest.k]}. ${KIND_TIP[weakest.k](hands)}`);
    else tips.push('신호를 끝까지 보고, 크고 분명하게 움직여 보세요.');
  } else if (a) {
    tips.push('몸이 잘 보이지 않아 동작을 판정하지 못했어요. 표시 자리에 서서 머리부터 엉덩이까지 화면에 나오게 해 주세요.');
  } else {
    tips.push('신호를 보고 바로 움직였나요? 다음에는 단어 숨기기에 도전해 보세요.');
  }
  if (measuring && summary.rate !== null) {
    if (summary.rate >= 0.8) tips.push('펀치 뒤에 가드로도 잘 돌아왔어요.');
    else if (summary.rate >= 0.5) tips.push('펀치 뒤 가드 복귀: 뻗은 주먹을 "같은 길로" 빨리 당겨 와 봐요.');
    else tips.push('펀치 뒤에 손이 내려가 있었어요. 신호 간격을 늘려서 천천히 연습해 봐요.');
  }

  const actionSub = !a
    ? '카메라를 끄고 했어요'
    : a.accuracy === null
      ? '몸이 잘 안 보여 판정하지 못했어요'
      : `판정 ${a.judged}번 중 ${a.correct}번 정답${a.unknown ? ` · 판정 불가 ${a.unknown}번` : ''}`;

  return (
    <div className="space-y-5 md:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-2xl font-extrabold">
          {LEVELS[level].name} 결과 · 라운드 {summary.rounds}번 · 신호 {summary.signals}개
        </h2>
        {hands && (
          <span className="rounded-xl bg-white px-3 py-1.5 text-sm font-bold text-ink-soft shadow-sm">
            앞손: {hands.lead} ({hands.who})
          </span>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="동작 점수"
          value={a && a.accuracy !== null ? pct(a.accuracy) : '-'}
          sub={actionSub}
          tone={a && a.accuracy !== null && a.accuracy < 0.6 ? 'rose' : 'mint'}
        />
        <Stat
          label="평균 반응 시간"
          value={a ? sec(a.avgReactionMs) : '-'}
          sub="신호가 나오고 맞게 움직이기까지"
          tone="slate"
        />
        <Stat
          label="가드 복귀율"
          value={measuring && summary.rate !== null ? pct(summary.rate) : '-'}
          sub={
            !measuring
              ? '내 가드를 등록하면 잴 수 있어요'
              : summary.rate === null
                ? '몸이 잘 안 보여 재지 못했어요'
                : `공격 신호 ${summary.measured}번 중 ${summary.returned}번 돌아왔어요`
          }
          tone={summary.rate !== null && summary.rate < 0.6 ? 'rose' : 'mint'}
        />
      </div>

      {kinds.length > 0 && a && (
        <Card className="space-y-3">
          <h3 className="text-lg font-extrabold">동작별 정확도</h3>
          {kinds.map((k) => {
            const v = a.perKind[k]!;
            const r = v.correct / v.judged;
            return (
              <div key={k} className="flex items-center gap-3">
                <span className="w-28 shrink-0">
                  <MiniChip kind={k} />
                </span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all duration-200 ${r >= 0.6 ? 'bg-mint-500' : 'bg-rose-400'}`}
                    style={{ width: `${Math.round(r * 100)}%` }}
                  />
                </div>
                <span className="tabular w-24 text-right text-sm font-bold">
                  {v.correct}/{v.judged} · {pct(r)}
                </span>
              </div>
            );
          })}
        </Card>
      )}

      <div className="space-y-2 rounded-2xl bg-mint-50 p-6">
        {tips.map((t) => (
          <p key={t} className="text-lg font-bold text-mint-700">
            {t}
          </p>
        ))}
        <p className="text-sm text-ink-soft">
          AI 판정은 참고용이에요. 카메라 각도나 옷, 조명 때문에 다르게 볼 수 있어요. 판정이 이상하면 선생님께 알려 주세요.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Button onClick={onAgain}>
          <RotateCcw className="h-5 w-5" /> 다시 하기
        </Button>
        {onLevelUp && (
          <Button variant="white" onClick={onLevelUp}>
            <TrendingUp className="h-5 w-5" /> 레벨 올리기
          </Button>
        )}
        <Button variant="white" onClick={onSettings}>
          설정 바꾸기
        </Button>
        <Button variant="soft" onClick={onRecord}>
          <NotebookPen className="h-5 w-5" /> 기록하러 가기
        </Button>
      </div>
    </div>
  );
}
