import type { ReactNode } from 'react';
import { ChevronRight, Lock, NotebookPen, Shield, ShieldCheck, Zap } from 'lucide-react';
import { getBaseline, getStudentId, getToday } from '../storage/records.ts';

export type ScreenId = 'home' | 'guard' | 'caller' | 'record';

function MenuCard({
  icon,
  title,
  desc,
  tag,
  accent,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  tag: string;
  accent?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable group flex flex-col overflow-hidden rounded-2xl bg-white text-left shadow-sm hover:shadow-md"
    >
      {accent}
      <div className="flex flex-1 flex-col gap-4 p-7">
        <div className="flex items-center justify-between">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-mint-50 text-mint-600">{icon}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-ink-soft">{tag}</span>
        </div>
        <div>
          <div className="text-2xl font-black tracking-tight">{title}</div>
          <p className="mt-1 text-base leading-relaxed text-ink-soft">{desc}</p>
        </div>
        <span className="mt-auto flex items-center gap-1 font-bold text-mint-600">
          시작하기 <ChevronRight className="h-5 w-5 transition-all duration-200 group-hover:translate-x-1" />
        </span>
      </div>
    </button>
  );
}

export function Home({ onOpen }: { onOpen: (s: ScreenId) => void }) {
  const baseline = getBaseline();
  const today = getToday();
  const sid = getStudentId();
  const date = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-6 overflow-y-auto px-6 py-6">
      <header className="flex flex-wrap items-center gap-4">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="h-14 w-14 rounded-2xl shadow-sm" />
        <div>
          <h1 className="text-3xl font-black tracking-tight">복싱 셀프코치</h1>
          <p className="text-ink-soft">AI가 내 가드를 봐 주는 복싱 수업</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="rounded-2xl bg-white px-4 py-2 font-bold shadow-sm">{date}</span>
          <span
            className={`flex items-center gap-1.5 rounded-2xl px-4 py-2 font-bold shadow-sm ${baseline ? 'bg-mint-500 text-white' : 'bg-white text-ink-soft'}`}
          >
            <ShieldCheck className="h-5 w-5" />
            {baseline ? '오늘 내 가드 등록됨' : '내 가드 등록 전'}
          </span>
          {sid && <span className="rounded-2xl bg-white px-4 py-2 font-bold shadow-sm">학번 {sid}</span>}
        </div>
      </header>

      <section className="grid gap-5 md:grid-cols-3">
        <MenuCard
          icon={<Shield className="h-8 w-8" />}
          title="가드 체크"
          desc="손은 얼굴 옆, 팔꿈치는 옆구리! 태블릿을 바닥에 세우면 AI가 내 가드를 실시간으로 봐 줘요."
          tag="1차시 핵심"
          accent={<div className="h-2 bg-mint-500" />}
          onClick={() => onOpen('guard')}
        />
        <MenuCard
          icon={<Zap className="h-8 w-8" />}
          title="섀도 반응 콜러"
          desc="색과 화살표를 보고 잽 · 스트레이트 · 원투 · 슬립 · 덕킹! 펀치 뒤 가드 복귀율도 재요."
          tag="2차시부터"
          accent={
            <div className="flex h-2">
              <div className="flex-1 bg-jab" />
              <div className="flex-1 bg-straight" />
              <div className="flex-1 bg-defense" />
            </div>
          }
          onClick={() => onOpen('caller')}
        />
        <MenuCard
          icon={<NotebookPen className="h-8 w-8" />}
          title="내 기록"
          desc={`자기점검을 하고 결과를 복사해 제출해요.${today.guard.length + today.caller.length ? ` 오늘 측정 ${today.guard.length + today.caller.length}개가 있어요.` : ''}`}
          tag="수업 마무리"
          accent={<div className="h-2 bg-mint-300" />}
          onClick={() => onOpen('record')}
        />
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-4 text-lg font-extrabold">오늘 수업 순서</div>
        <ol className="grid gap-3 sm:grid-cols-4">
          {[
            ['1', '태블릿 세우기', '바닥에 세우고 2.5~3m 뒤 표시 자리'],
            ['2', '내 가드 등록', '3초 멈추면 AI가 내 가드를 기억'],
            ['3', '미션 · 콜러', 'R1~R3 미션, 2차시부터 콜러'],
            ['4', '기록 제출', '자기점검 후 결과 복사'],
          ].map(([n, t, d]) => (
            <li key={n} className="flex items-start gap-3 rounded-2xl bg-slate-50 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-mint-500 font-black text-white">{n}</span>
              <span>
                <span className="block font-extrabold">{t}</span>
                <span className="block text-sm text-ink-soft">{d}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-5 md:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="mb-3 text-lg font-extrabold">안전 약속</div>
          <ul className="grid gap-2 text-ink-soft sm:grid-cols-2">
            <li>· 화면을 향해 치지 않고 허공에 동작해요</li>
            <li>· 태블릿 앞 표시 자리에서만 움직여요</li>
            <li>· 친구와 팔 길이 이상 떨어져요</li>
            <li>· 스텝은 좌우로만 (태블릿을 밟지 않게)</li>
          </ul>
        </div>
        <div className="flex items-start gap-3 rounded-2xl bg-mint-50 p-6">
          <Lock className="mt-0.5 h-6 w-6 shrink-0 text-mint-600" />
          <p className="text-mint-700">
            <b>영상은 저장하지 않아요.</b> AI 자세 인식은 이 태블릿 안에서만 작동하고, 기록도 이 태블릿에만 남아요.
          </p>
        </div>
      </section>
    </div>
  );
}
