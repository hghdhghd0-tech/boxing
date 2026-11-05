import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Hand, NotebookPen, RotateCcw, Shield, Square, Timer, TriangleAlert } from 'lucide-react';
import { GUARD } from '../config.ts';
import { Button, Card, Choice, ScreenHeader, Stat, Toggle } from '../components/ui.tsx';
import { CameraStage, type Tone } from '../components/CameraStage.tsx';
import { GuardFigure } from '../components/Illustrations.tsx';
import { drawPose } from '../pose/drawPose.ts';
import {
  GuardTracker,
  IDX,
  MetricsSmoother,
  calibrate,
  computeMetrics,
  evaluate,
  jointVisible,
  type Baseline,
  type GuardMetrics,
  type GuardStats,
  type Issue,
  type JointKey,
  type Landmark,
} from '../pose/guard.ts';
import { usePoseCamera } from '../pose/usePoseCamera.ts';
import { addGuardRound, getBaseline, pct, saveBaseline } from '../storage/records.ts';
import { prefs } from '../lib/prefs.ts';
import { beep, bell, keepScreenOn, unlockAudio } from '../lib/device.ts';

type Step =
  | 'intro'
  | 'setup'
  | 'countdown'
  | 'collect'
  | 'regFail'
  | 'regDone'
  | 'menu'
  | 'roundCountdown'
  | 'round'
  | 'result';

const STAGE_STEPS: Step[] = ['setup', 'countdown', 'collect', 'regFail', 'regDone', 'roundCountdown', 'round'];

const MISSIONS = [
  { id: 'r1', name: 'R1 서서 유지', desc: '가드를 잡고 그대로 서 있기', seconds: 30 },
  { id: 'r2', name: 'R2 좌우 스텝', desc: '가드를 지키며 좌우로 스텝 (앞뒤로 가지 않기)', seconds: 30 },
  { id: 'r3', name: 'R3 잽 뻗고 복귀', desc: '잽을 뻗고 바로 가드로 돌아오기', seconds: 60 },
  { id: 'free', name: '자유 연습', desc: '스스로 정한 동작으로 가드 지키기', seconds: 60 },
] as const;

const GROUPS: { label: string; joints: JointKey[] }[] = [
  { label: '얼굴', joints: ['nose'] },
  { label: '어깨', joints: ['lShoulder', 'rShoulder'] },
  { label: '팔꿈치', joints: ['lElbow', 'rElbow'] },
  { label: '손목', joints: ['lWrist', 'rWrist'] },
  { label: '엉덩이', joints: ['lHip', 'rHip'] },
];

type Live = {
  groups: boolean[];
  hint: string;
  ready: boolean;
  unknown: boolean;
  warnHand: boolean;
  warnElbow: boolean;
};

const EMPTY_LIVE: Live = { groups: GROUPS.map(() => false), hint: '카메라 앞에 서 주세요', ready: false, unknown: true, warnHand: false, warnElbow: false };

function shoulderSpan(lm: Landmark[], aspect: number) {
  const a = lm[IDX.lShoulder];
  const b = lm[IDX.rShoulder];
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

function setupHint(lm: Landmark[] | null, aspect: number): { hint: string; ready: boolean; groups: boolean[] } {
  const groups = GROUPS.map((g) => g.joints.every((j) => jointVisible(lm, j)));
  if (!lm) return { hint: '카메라 앞 표시 자리에 서 주세요', ready: false, groups };
  const shouldersOk = groups[1];
  if (shouldersOk) {
    const s = shoulderSpan(lm, aspect);
    if (s > 0.34) return { hint: '너무 가까워요. 뒤로 한 걸음', ready: false, groups };
    if (s < 0.09) return { hint: '너무 멀어요. 앞으로 한 걸음', ready: false, groups };
    if (!groups[4]) return { hint: '엉덩이까지 보이게 뒤로 한 걸음', ready: false, groups };
  }
  const missing = GROUPS.filter((_, i) => !groups[i]).map((g) => g.label);
  if (missing.length) return { hint: `안 보여요: ${missing.join(', ')}`, ready: false, groups };
  return { hint: '좋아요! 그대로 서 있어요', ready: true, groups };
}

const FAIL_TITLE: Record<'notVisible' | 'moving' | 'minimum', string> = {
  notVisible: '몸이 잘 안 보였어요',
  moving: '움직이지 말고 다시 해요',
  minimum: '가드 자세를 고쳐 볼까요?',
};

export function GuardCheck({ onExit, onGoRecord }: { onExit: () => void; onGoRecord: () => void }) {
  const saved = getBaseline();
  const [baseline, setBaseline] = useState<Baseline | null>(saved?.baseline ?? null);
  const [savedAt, setSavedAt] = useState<number | null>(saved?.savedAt ?? null);
  const [step, setStep] = useState<Step>(saved ? 'menu' : 'intro');
  const [missionId, setMissionId] = useState<(typeof MISSIONS)[number]['id']>('r1');
  const [seconds, setSeconds] = useState<number>(30);
  const [sound, setSound] = useState(prefs.guardSound());
  const [live, setLive] = useState<Live>(EMPTY_LIVE);
  const [now, setNow] = useState(() => performance.now());
  const [fail, setFail] = useState<{ reason: 'notVisible' | 'moving' | 'minimum'; issues: Issue[] } | null>(null);
  const [result, setResult] = useState<GuardStats | null>(null);

  const stepRef = useRef<Step>(step);
  const stepStartRef = useRef(performance.now());
  const stableSinceRef = useRef<number | null>(null);
  const samplesRef = useRef<GuardMetrics[]>([]);
  const attemptsRef = useRef(0);
  const trackerRef = useRef(new GuardTracker());
  const smootherRef = useRef(new MetricsSmoother());
  const issueJointsRef = useRef<JointKey[]>([]);
  const wasWarnRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;

  const mission = MISSIONS.find((m) => m.id === missionId)!;

  const go = useCallback((s: Step) => {
    stepRef.current = s;
    stepStartRef.current = performance.now();
    setStep(s);
  }, []);

  const onFrame = useCallback(
    (lm: Landmark[] | null, t: number, aspect: number, video: HTMLVideoElement) => {
      const s = stepRef.current;
      let bad: JointKey[] = [];

      if (s === 'setup' || s === 'intro' || s === 'menu' || s === 'roundCountdown' || s === 'countdown') {
        const h = setupHint(lm, aspect);
        if (s === 'setup') {
          if (h.ready) {
            stableSinceRef.current = stableSinceRef.current ?? t;
            if (t - stableSinceRef.current >= 1500) {
              stableSinceRef.current = null;
              go('countdown');
            }
          } else {
            stableSinceRef.current = null;
          }
        }
        setLive((p) => ({ ...p, ...h, unknown: !h.ready }));
      } else if (s === 'collect') {
        attemptsRef.current += 1;
        const m = computeMetrics(lm, aspect);
        if (m) samplesRef.current.push(m);
      } else if (s === 'regFail') {
        bad = issueJointsRef.current;
      } else if (s === 'round') {
        const base = baselineRef.current;
        const m = smootherRef.current.push(computeMetrics(lm, aspect));
        const ev = m && base ? evaluate(m, base) : null;
        const st = trackerRef.current.update(t, ev);
        bad = st.badJoints.filter((j) =>
          j === 'lWrist' || j === 'rWrist' ? st.warnHand : st.warnElbow,
        );
        const warning = st.warnHand || st.warnElbow;
        if (warning && !wasWarnRef.current && prefs.guardSound()) beep(440, 220);
        wasWarnRef.current = warning;
        setLive((p) => ({ ...p, unknown: st.unknown, warnHand: st.warnHand, warnElbow: st.warnElbow }));
      }

      drawPose(canvasRef.current, video, lm, bad);
    },
    [go],
  );

  const { videoRef, status, error, retry } = usePoseCamera(onFrame);

  // 시간에 따라 다음 단계로 넘어가기
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = performance.now();
      setNow(t);
      const s = stepRef.current;
      const el = t - stepStartRef.current;
      if (s === 'countdown' && el >= 3000) {
        samplesRef.current = [];
        attemptsRef.current = 0;
        go('collect');
      } else if (s === 'collect' && el >= GUARD.registerMs) {
        const r = calibrate(samplesRef.current, attemptsRef.current);
        if (r.ok) {
          saveBaseline(r.baseline);
          setBaseline(r.baseline);
          setSavedAt(Date.now());
          if (prefs.guardSound()) beep(988, 200);
          go('regDone');
        } else {
          setFail({ reason: r.reason, issues: r.issues });
          issueJointsRef.current = r.issues.map((i) => i.joint);
          go('regFail');
        }
      } else if (s === 'regFail' && el >= 5000) {
        go('setup');
      } else if (s === 'regDone' && el >= 2200) {
        go('menu');
      } else if (s === 'roundCountdown' && el >= 5000) {
        trackerRef.current = new GuardTracker();
        smootherRef.current.reset();
        wasWarnRef.current = false;
        if (prefs.guardSound()) bell();
        go('round');
      } else if (s === 'round' && el >= seconds * 1000) {
        const st = trackerRef.current.stats();
        setResult(st);
        addGuardRound({
          at: Date.now(),
          mission: mission.name,
          seconds,
          handKeepRate: st.handKeepRate,
          elbowKeepRate: st.elbowKeepRate,
          longestBreakMs: st.longestBreakMs,
          warnings: st.warnings,
        });
        if (prefs.guardSound()) bell();
        go('result');
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [go, seconds, mission.name]);

  // 라운드 중에는 화면이 꺼지지 않게
  useEffect(() => {
    void keepScreenOn(STAGE_STEPS.includes(step));
    return () => void keepScreenOn(false);
  }, [step]);

  const el = Math.max(0, now - stepStartRef.current);
  const stage = STAGE_STEPS.includes(step);
  const startRegister = () => {
    unlockAudio();
    setFail(null);
    stableSinceRef.current = null;
    go('setup');
  };
  const startRound = () => {
    unlockAudio();
    go('roundCountdown');
  };

  let tone: Tone = 'none';
  if (step === 'round') tone = live.unknown ? 'unknown' : live.warnHand || live.warnElbow ? 'warn' : 'ok';
  else if (step === 'setup') tone = live.ready ? 'ok' : 'unknown';
  else if (step === 'regFail') tone = 'warn';
  else if (step === 'regDone' || step === 'collect') tone = 'ok';

  const camera = (
    <CameraStage
      videoRef={videoRef}
      canvasRef={canvasRef}
      status={status}
      error={error}
      onRetry={retry}
      tone={tone}
      className={stage ? 'h-full w-full rounded-none' : 'h-full w-full'}
    >
      {stage && (
        <StageOverlay
          step={step}
          el={el}
          live={live}
          fail={fail}
          missionName={mission.name}
          missionDesc={mission.desc}
          seconds={seconds}
          onStop={() => go(baseline ? 'menu' : 'intro')}
        />
      )}
    </CameraStage>
  );

  if (stage) {
    return <div className="fixed inset-0 z-40 bg-slate-900">{camera}</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="가드 체크" onBack={onExit} />
      <main className={`grid min-h-0 flex-1 gap-5 px-6 pb-6 ${step === 'intro' ? 'md:grid-cols-[1.8fr_1fr]' : 'md:grid-cols-[1.35fr_1fr]'}`}>
        <div className="min-h-[260px]">{camera}</div>

        <div className="min-h-0 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className={step === 'intro' ? 'h-full' : 'space-y-5'}
            >
              {step === 'intro' && <Intro onStart={startRegister} />}

              {step === 'menu' && (
                <>
                  <Card className="space-y-2">
                    <div className="flex items-center gap-2 text-mint-700">
                      <CheckCircle2 className="h-6 w-6" />
                      <span className="text-lg font-extrabold">내 가드 등록 완료</span>
                    </div>
                    <p className="text-ink-soft">
                      {savedAt ? `오늘 ${new Date(savedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}에 ` : ''}
                      등록한 내 가드와 비교해서 판정해요. 태블릿 위치를 옮겼다면 다시 등록해 주세요.
                    </p>
                    <Button variant="soft" size="md" onClick={startRegister}>
                      <RotateCcw className="h-5 w-5" /> 내 가드 다시 등록
                    </Button>
                  </Card>
                  <Card className="space-y-4">
                    <h2 className="text-xl font-extrabold">미션 고르기</h2>
                    <div className="grid gap-3">
                      {MISSIONS.map((m) => {
                        const on = m.id === missionId;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              setMissionId(m.id);
                              setSeconds(m.seconds);
                            }}
                            className={`pressable rounded-2xl p-4 text-left ${on ? 'bg-mint-500 text-white shadow-md shadow-mint-500/25' : 'bg-slate-50 hover:bg-slate-100'}`}
                          >
                            <div className="text-lg font-extrabold">{m.name}</div>
                            <div className={on ? 'text-mint-50' : 'text-ink-soft'}>{m.desc}</div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="space-y-2">
                      <div className="font-bold">라운드 시간</div>
                      <Choice
                        value={seconds}
                        onChange={setSeconds}
                        options={[
                          { value: 30, label: '30초' },
                          { value: 60, label: '60초' },
                        ]}
                      />
                    </div>
                    <Toggle
                      checked={sound}
                      onChange={(v) => {
                        setSound(v);
                        prefs.setGuardSound(v);
                      }}
                      label="경고음"
                      hint="기본은 꺼짐 (여러 대가 함께 울리면 헷갈려요)"
                    />
                    <Button size="xl" className="w-full" onClick={startRound} disabled={status !== 'ready'}>
                      <Timer className="h-7 w-7" /> 라운드 시작
                    </Button>
                    <p className="text-center text-sm text-ink-soft">시작을 누르면 5초 동안 표시 자리로 가서 가드 자세를 잡아요.</p>
                  </Card>
                </>
              )}

              {step === 'result' && result && (
                <Result
                  stats={result}
                  seconds={seconds}
                  missionName={mission.name}
                  onAgain={startRound}
                  onMenu={() => go('menu')}
                  onRecord={onGoRecord}
                  onHome={onExit}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

const INTRO_STEPS = [
  { title: '태블릿 세우기', desc: '바닥에 세워 화면이 살짝 위를 보게' },
  { title: '표시 자리에 서기', desc: '2.5~3m 뒤, 머리부터 엉덩이까지 보이게' },
  { title: '가드 잡고 3초 멈추기', desc: '주먹은 턱 옆, 팔꿈치는 옆구리' },
];

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <Card className="flex max-h-full flex-col gap-3 p-5">
      <div className="flex shrink-0 items-center gap-3">
        <GuardFigure className="h-12 w-auto shrink-0" />
        <div>
          <h2 className="text-lg font-extrabold">내 가드 등록</h2>
          <p className="text-sm text-ink-soft">처음 한 번, 3단계면 끝나요</p>
        </div>
      </div>
      {/* 화면이 작으면 이 목록만 스크롤되고, 시작 버튼은 항상 보입니다 */}
      <ol className="min-h-0 space-y-1.5 overflow-y-auto">
        {INTRO_STEPS.map((st, i) => (
          <li key={st.title} className="flex items-start gap-3 rounded-xl bg-slate-50 px-3 py-2">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mint-500 text-sm font-extrabold text-white">
              {i + 1}
            </span>
            <span className="leading-snug">
              <span className="block font-bold">{st.title}</span>
              <span className="block text-sm text-ink-soft">{st.desc}</span>
            </span>
          </li>
        ))}
      </ol>
      <Button size="lg" className="w-full shrink-0" onClick={onStart}>
        <Shield className="h-6 w-6" /> 가드 등록 시작
      </Button>
    </Card>
  );
}

function BigNumber({ n }: { n: number }) {
  return (
    <motion.div
      key={n}
      initial={{ scale: 1.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="tabular text-[20vmin] leading-none font-black text-white drop-shadow-[0_6px_24px_rgba(0,0,0,0.45)]"
    >
      {n}
    </motion.div>
  );
}

/** 안내 글은 모두 화면 왼쪽에 모읍니다. 가운데(학생이 서는 자리)는 비워 두어 내 모습이 보이게 합니다. */
function SidePanel({ children }: { children: ReactNode }) {
  return (
    <div className="absolute top-4 left-4 flex max-h-[calc(100%-6.5rem)] w-[22vw] max-w-[340px] min-w-[min(200px,44vw)] flex-col gap-2 overflow-hidden rounded-2xl bg-white/85 p-4 shadow-md backdrop-blur">
      {children}
    </div>
  );
}

/** 오른쪽 가운데에 큰 숫자 (가운데를 가리지 않게) */
function SideNumber({ n }: { n: number }) {
  return (
    <div className="absolute top-1/2 right-[3vw] flex min-w-[16vmin] -translate-y-1/2 justify-center rounded-3xl bg-black/35 px-[1.5vw] py-[1.5vmin] backdrop-blur">
      <BigNumber n={n} />
    </div>
  );
}

function StepLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className="text-[clamp(12px,2vmin,17px)] font-bold text-ink-soft">
      내 가드 등록 {n}/3 · {label}
    </div>
  );
}

function StageOverlay({
  step,
  el,
  live,
  fail,
  missionName,
  missionDesc,
  seconds,
  onStop,
}: {
  step: Step;
  el: number;
  live: Live;
  fail: { reason: 'notVisible' | 'moving' | 'minimum'; issues: Issue[] } | null;
  missionName: string;
  missionDesc: string;
  seconds: number;
  onStop: () => void;
}) {
  const remain = Math.max(0, Math.ceil(seconds - el / 1000));
  const pill = 'rounded-2xl bg-white/90 px-6 py-4 shadow-md backdrop-blur';
  return (
    <div className="absolute inset-0">
      {step === 'setup' && (
        <SidePanel>
          <StepLabel n={1} label="자리 잡기" />
          <div className={`text-[clamp(18px,3.4vmin,30px)] leading-tight font-black ${live.ready ? 'text-mint-600' : 'text-ink'}`}>{live.hint}</div>
          <div className="flex flex-wrap gap-1">
            {GROUPS.map((g, i) => (
              <span
                key={g.label}
                className={`rounded-lg px-2 py-0.5 text-[clamp(11px,1.8vmin,15px)] font-bold ${live.groups[i] ? 'bg-mint-500 text-white' : 'bg-slate-200 text-slate-500'}`}
              >
                {g.label}
              </span>
            ))}
          </div>
        </SidePanel>
      )}

      {step === 'countdown' && (
        <>
          <SidePanel>
            <StepLabel n={2} label="가드 잡기" />
            <div className="flex items-center gap-4">
              <GuardFigure className="h-[10vmin] max-h-20 w-auto shrink-0" />
              <div className="text-[clamp(18px,3.4vmin,30px)] leading-tight font-black">가드 잡고 멈춰요</div>
            </div>
            <div className="text-[clamp(12px,2vmin,17px)] font-bold text-ink-soft">주먹은 턱 옆, 팔꿈치는 옆구리</div>
          </SidePanel>
          <SideNumber n={Math.max(1, 3 - Math.floor(el / 1000))} />
        </>
      )}

      {step === 'collect' && (
        <>
          {/* 멀리서도 보이게 화면 맨 위에 얇은 진행 막대 */}
          <div className="absolute inset-x-0 top-0 h-3 bg-white/30">
            <div className="h-full bg-mint-500 transition-all duration-100" style={{ width: `${Math.min(100, (el / GUARD.registerMs) * 100)}%` }} />
          </div>
          <SidePanel>
            <StepLabel n={3} label="멈추기" />
            <div className="text-[clamp(20px,3.8vmin,34px)] leading-tight font-black text-mint-600">그대로 멈춰요!</div>
            <div className="h-4 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-mint-500 transition-all duration-100" style={{ width: `${Math.min(100, (el / GUARD.registerMs) * 100)}%` }} />
            </div>
          </SidePanel>
        </>
      )}

      {step === 'regFail' && fail && (
        <SidePanel>
          <div className="flex items-center gap-3">
            <TriangleAlert className="h-[clamp(20px,3.6vmin,32px)] w-[clamp(20px,3.6vmin,32px)] shrink-0 text-rose-500" />
            <div className="text-[clamp(17px,3.2vmin,28px)] leading-tight font-black">{FAIL_TITLE[fail.reason]}</div>
          </div>
          {fail.reason === 'minimum' ? (
            <>
              <ul className="space-y-1 text-[clamp(16px,2.9vmin,26px)] leading-tight font-extrabold text-rose-600">
                {fail.issues.map((i) => (
                  <li key={`${i.side}-${i.kind}`}>{i.message}</li>
                ))}
              </ul>
              <div className="text-[clamp(12px,2vmin,17px)] font-bold text-ink-soft">화면에 빨갛게 표시된 관절을 고쳐요</div>
            </>
          ) : (
            <div className="text-[clamp(12px,2vmin,17px)] font-bold text-ink-soft">
              {fail.reason === 'moving' ? '3초 동안 가드 자세 그대로 멈춰 주세요' : '표시 자리에서 몸 전체가 보이게 서 주세요'}
            </div>
          )}
          <div className="text-[clamp(12px,2vmin,17px)] text-ink-soft">{Math.max(1, Math.ceil(5 - el / 1000))}초 뒤에 다시 해요</div>
        </SidePanel>
      )}

      {step === 'regDone' && (
        <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}>
          <SidePanel>
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-[clamp(24px,4.5vmin,40px)] w-[clamp(24px,4.5vmin,40px)] shrink-0 text-mint-500" />
              <div className="text-[clamp(20px,3.8vmin,34px)] font-black">등록 완료!</div>
            </div>
            <div className="text-[clamp(12px,2vmin,17px)] font-bold text-ink-soft">태블릿으로 와서 미션을 골라요</div>
          </SidePanel>
        </motion.div>
      )}

      {step === 'roundCountdown' && (
        <>
          <SidePanel>
            <div className="text-[clamp(18px,3.4vmin,30px)] leading-tight font-black">{missionName}</div>
            <div className="text-[clamp(12px,2vmin,17px)] font-bold text-ink-soft">{missionDesc}</div>
            <div className="text-[clamp(15px,2.6vmin,22px)] font-extrabold text-mint-600">표시 자리로 가서 가드!</div>
          </SidePanel>
          <SideNumber n={Math.max(1, 5 - Math.floor(el / 1000))} />
        </>
      )}

      {step === 'round' && (
        <>
          <div className={`${pill} absolute top-6 left-6 text-[3.5vmin] font-extrabold`}>{missionName}</div>
          <div className={`${pill} tabular absolute top-6 right-6 text-[8vmin] leading-none font-black`}>
            {Math.floor(remain / 60)}:{String(remain % 60).padStart(2, '0')}
          </div>
          {/* 경고는 아래쪽에: 손·팔꿈치가 가려지지 않게 */}
          <div className="absolute inset-x-0 bottom-[3vmin] flex justify-center">
            {live.unknown ? (
              <div className="rounded-2xl bg-defense px-8 py-4 text-[4.5vmin] font-black text-ink shadow-md">상체가 다 보이게 서 주세요</div>
            ) : live.warnHand || live.warnElbow ? (
              <motion.div
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                className="flex items-center gap-[3vw] rounded-2xl bg-warn px-10 py-4 text-white shadow-md"
              >
                {live.warnHand && (
                  <span className="flex items-center gap-3 text-[9vmin] leading-none font-black">
                    <Hand className="h-[8vmin] w-[8vmin]" /> 손 올려!
                  </span>
                )}
                {live.warnElbow && <span className="text-[9vmin] leading-none font-black">팔꿈치 붙여!</span>}
              </motion.div>
            ) : null}
          </div>
        </>
      )}

      <button
        type="button"
        onClick={onStop}
        className="pressable absolute bottom-6 left-6 z-10 flex items-center gap-2 rounded-2xl bg-white/90 px-5 py-3 text-lg font-bold text-ink shadow-md"
      >
        <Square className="h-5 w-5" /> 그만
      </button>
    </div>
  );
}

function Result({
  stats,
  seconds,
  missionName,
  onAgain,
  onMenu,
  onRecord,
  onHome,
}: {
  stats: GuardStats;
  seconds: number;
  missionName: string;
  onAgain: () => void;
  onMenu: () => void;
  onRecord: () => void;
  onHome: () => void;
}) {
  const seen = stats.validMs / (seconds * 1000);
  let tip: string;
  if (stats.validMs < 1000) tip = '몸이 거의 보이지 않았어요. 서는 자리와 태블릿 각도를 다시 확인해 주세요.';
  else if (stats.handKeepRate >= 0.85 && stats.elbowKeepRate >= 0.85) tip = '가드를 아주 잘 지켰어요! 다음 미션에 도전해 보세요.';
  else if (stats.handKeepRate <= stats.elbowKeepRate) tip = '손이 자주 내려갔어요. 주먹을 턱 옆에 붙여 두는 느낌으로 해 봐요.';
  else tip = '팔꿈치가 자주 벌어졌어요. 팔꿈치로 옆구리를 살짝 누르는 느낌으로 해 봐요.';

  const noData = stats.validMs < 1000;
  return (
    <>
      <div className="flex items-baseline justify-between">
        <h2 className="text-2xl font-extrabold">{missionName} 결과</h2>
        <span className="text-ink-soft">{seconds}초</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Stat label="손 유지율" value={noData ? '-' : pct(stats.handKeepRate)} tone={stats.handKeepRate >= 0.8 ? 'mint' : 'rose'} />
        <Stat label="팔꿈치 유지율" value={noData ? '-' : pct(stats.elbowKeepRate)} tone={stats.elbowKeepRate >= 0.8 ? 'mint' : 'rose'} />
        <Stat label="가장 오래 무너진 시간" value={noData ? '-' : `${(stats.longestBreakMs / 1000).toFixed(1)}초`} tone="slate" />
        <Stat label="경고 횟수" value={noData ? '-' : `${stats.warnings}번`} tone="slate" />
      </div>
      <div className="rounded-2xl bg-mint-50 p-6">
        <p className="text-lg font-bold text-mint-700">{tip}</p>
        <p className="mt-2 text-sm text-ink-soft">
          1초 넘게 무너진 시간만 계산했어요. 몸이 보인 시간은 {Math.round(Math.min(1, seen) * 100)}%예요.
          AI 판정은 참고용이고, 턱 당기기처럼 AI가 못 보는 부분도 있어요.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Button onClick={onAgain}>
          <RotateCcw className="h-5 w-5" /> 같은 미션 다시
        </Button>
        <Button variant="white" onClick={onMenu}>
          다른 미션
        </Button>
        <Button variant="soft" onClick={onRecord}>
          <NotebookPen className="h-5 w-5" /> 기록하러 가기
        </Button>
        <Button variant="ghost" onClick={onHome}>
          처음으로
        </Button>
      </div>
    </>
  );
}
