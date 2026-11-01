import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowLeft, ArrowRight, Camera, NotebookPen, Play, RotateCcw, Square, TrendingUp } from 'lucide-react';
import { Button, Card, Choice, ScreenHeader, Stat, Toggle } from '../components/ui.tsx';
import { LEVELS, SIGNALS, pickNextSignal, type Level, type SignalKind } from '../caller/signals.ts';
import { MetricsSmoother, ReturnTracker, computeMetrics, evaluate, type Baseline, type Landmark } from '../pose/guard.ts';
import { usePoseCamera } from '../pose/usePoseCamera.ts';
import { addCallerRound, getBaseline, pct } from '../storage/records.ts';
import { prefs } from '../lib/prefs.ts';
import { beep, bell, keepScreenOn, toggleFullscreen, unlockAudio } from '../lib/device.ts';

type Step = 'settings' | 'countdown' | 'run' | 'rest' | 'result';
type Shown = { kind: SignalKind; id: number } | null;

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
  const [measure, setMeasure] = useState(!!baseline);
  const [step, setStep] = useState<Step>('settings');
  const [shown, setShown] = useState<Shown>(null);
  const [now, setNow] = useState(() => performance.now());
  const [roundIndex, setRoundIndex] = useState(1);
  const [visible, setVisible] = useState(false);
  const [summary, setSummary] = useState<{ signals: number; measured: number; returned: number; rate: number | null; rounds: number } | null>(null);

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
  const visibleRef = useRef(false);
  const settingsRef = useRef({ level, roundSec, restSec, rounds, intervalSec, sound, measuring: measure && !!baseline });
  settingsRef.current = { level, roundSec, restSec, rounds, intervalSec, sound, measuring: measure && !!baseline };

  const go = useCallback((s: Step) => {
    stepRef.current = s;
    stepStartRef.current = performance.now();
    setStep(s);
  }, []);

  const onFrame = useCallback(
    (lm: Landmark[] | null, t: number, aspect: number) => {
      const m = computeMetrics(lm, aspect);
      const vis = !!m;
      if (vis !== visibleRef.current) {
        visibleRef.current = vis;
        setVisible(vis);
      }
      if (stepRef.current !== 'run' || !baseline) return;
      const sm = smootherRef.current.push(m);
      const ok = sm ? (() => {
        const ev = evaluate(sm, baseline);
        return !ev.handBad && !ev.elbowBad;
      })() : null;
      returnRef.current.onFrame(t, ok);
    },
    [baseline],
  );

  const camOn = measure && !!baseline && step !== 'result';
  const { videoRef, status, error, retry } = usePoseCamera(onFrame, camOn);

  const finishRound = useCallback(() => {
    const st = settingsRef.current;
    setShown(null);
    if (st.sound) bell();
    if (roundRef.current < st.rounds) {
      go('rest');
    } else {
      returnRef.current.flush();
      const r = returnRef.current.summary();
      const res = { signals: signalCountRef.current, ...r, rounds: roundRef.current };
      setSummary(res);
      addCallerRound({
        at: Date.now(),
        level: st.level,
        rounds: roundRef.current,
        signals: res.signals,
        measured: st.measuring ? r.measured : 0,
        returned: st.measuring ? r.returned : 0,
        rate: st.measuring ? r.rate : null,
      });
      go('result');
    }
  }, [go]);

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
        const remain = st.roundSec * 1000 - el;
        if (t >= nextAtRef.current && remain > 1200) {
          const kind = pickNextSignal(st.level, recentRef.current);
          recentRef.current = [...recentRef.current, kind].slice(-2);
          signalCountRef.current += 1;
          shownIdRef.current += 1;
          setShown({ kind, id: shownIdRef.current });
          if (SIGNALS[kind].attack && st.measuring) returnRef.current.onAttackSignal(t);
          if (st.sound) beep(SIGNAL_TONE[kind], 140);
          const ms = st.intervalSec * 1000;
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
              <span className="rounded-2xl bg-black/25 px-5 py-3 text-[3.2vh] font-extrabold text-white backdrop-blur">
                라운드 {roundIndex}/{rounds}
              </span>
              <span className="tabular rounded-2xl bg-black/25 px-5 py-3 text-[6vh] leading-none font-black text-white backdrop-blur">
                {Math.floor(remain / 60)}:{String(remain % 60).padStart(2, '0')}
              </span>
            </div>
            {settingsRef.current.measuring && (
              <span className="absolute right-6 bottom-6 flex items-center gap-2 rounded-2xl bg-black/25 px-4 py-2 text-sm font-bold text-white backdrop-blur">
                <span className={`h-3 w-3 rounded-full ${visible ? 'bg-mint-300' : 'bg-slate-400'}`} />
                {visible ? '가드 복귀 측정 중' : '몸이 안 보여요'}
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
            measuring={measure && !!baseline}
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
                  <h2 className="text-xl font-extrabold">가드 복귀율 측정</h2>
                </div>
                {baseline ? (
                  <>
                    <Toggle checked={measure} onChange={setMeasure} label="카메라로 가드 복귀 측정" hint="라운드 중에는 경고 없이 조용히 재요" />
                    {measure && (
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
                    )}
                  </>
                ) : (
                  <div className="rounded-2xl bg-mint-50 p-5">
                    <p className="font-bold text-mint-700">가드 체크에서 내 가드를 먼저 등록하면 펀치 후 가드 복귀율도 잴 수 있어요.</p>
                    <Button variant="white" size="md" className="mt-3" onClick={onGoGuard}>
                      가드 등록하러 가기
                    </Button>
                  </div>
                )}
              </Card>

              <Button size="xl" className="w-full" onClick={start} disabled={measure && !!baseline && status === 'loading'}>
                <Play className="h-7 w-7" /> 시작
              </Button>
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

function CallerResult({
  summary,
  level,
  measuring,
  onAgain,
  onLevelUp,
  onSettings,
  onRecord,
}: {
  summary: { signals: number; measured: number; returned: number; rate: number | null; rounds: number };
  level: Level;
  measuring: boolean;
  onAgain: () => void;
  onLevelUp?: () => void;
  onSettings: () => void;
  onRecord: () => void;
}) {
  let tip = '신호를 보고 바로 움직였나요? 다음에는 단어 숨기기에 도전해 보세요.';
  if (measuring && summary.rate !== null) {
    if (summary.rate >= 0.8) tip = '펀치 뒤에 가드로 잘 돌아왔어요! 레벨을 올려 볼까요?';
    else if (summary.rate >= 0.5) tip = '절반 넘게 돌아왔어요. 뻗은 주먹을 "같은 길로" 빨리 당겨 와 봐요.';
    else tip = '펀치 뒤에 손이 내려가 있었어요. 신호 간격을 늘려서 천천히 연습해 봐요.';
  } else if (measuring) {
    tip = '몸이 잘 보이지 않아 복귀율을 재지 못했어요. 서는 자리를 확인해 주세요.';
  }
  return (
    <div className="space-y-5 md:col-span-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-2xl font-extrabold">
          {LEVELS[level].name} 결과 · 라운드 {summary.rounds}번
        </h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="가드 복귀율"
          value={measuring && summary.rate !== null ? pct(summary.rate) : '-'}
          sub={
            !measuring
              ? '측정하지 않았어요'
              : summary.rate === null
                ? '몸이 잘 안 보여 재지 못했어요'
                : `공격 신호 ${summary.measured}번 중 ${summary.returned}번 돌아왔어요`
          }
          tone={summary.rate !== null && summary.rate < 0.6 ? 'rose' : 'mint'}
        />
        <Stat label="받은 신호" value={`${summary.signals}개`} tone="slate" />
        <Stat label="레벨" value={String(level)} sub={LEVELS[level].desc} tone="slate" />
      </div>
      <Card className="bg-mint-50 shadow-none">
        <p className="text-lg font-bold text-mint-700">{tip}</p>
        <p className="mt-2 text-sm text-ink-soft">공격 신호 뒤 1.5초 안에 가드로 돌아왔는지 AI가 잰 값이에요. 참고용으로 써 주세요.</p>
      </Card>
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
