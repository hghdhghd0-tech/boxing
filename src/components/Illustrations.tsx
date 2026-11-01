// 직접 그린 안내 그림 (원본 일러스트)

/** 바른 가드 자세: 손은 얼굴 옆, 팔꿈치는 옆구리 */
export function GuardFigure({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 240" className={className} role="img" aria-label="바른 가드 자세 그림">
      <ellipse cx="100" cy="228" rx="62" ry="8" fill="#E2E8F0" />
      {/* 다리 */}
      <path d="M86 150 L72 222 M114 150 L132 222" stroke="#0F172A" strokeWidth="14" strokeLinecap="round" fill="none" />
      {/* 몸통 */}
      <path d="M70 92 Q100 82 130 92 L122 156 Q100 162 78 156 Z" fill="#0F172A" />
      {/* 팔: 어깨 → 팔꿈치(옆구리) → 주먹(턱 옆) */}
      <path d="M72 96 L76 142 L86 74" stroke="#0F172A" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M128 96 L124 142 L114 74" stroke="#0F172A" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* 머리 */}
      <circle cx="100" cy="52" r="24" fill="#0F172A" />
      {/* 주먹 */}
      <circle cx="86" cy="70" r="13" fill="#10B981" stroke="#FFFFFF" strokeWidth="3" />
      <circle cx="114" cy="70" r="13" fill="#10B981" stroke="#FFFFFF" strokeWidth="3" />
      {/* 팔꿈치 표시 */}
      <circle cx="76" cy="142" r="7" fill="#6EE7B7" />
      <circle cx="124" cy="142" r="7" fill="#6EE7B7" />
    </svg>
  );
}

/** 설치 방법: 바닥에 세운 태블릿과 2.5~3m 떨어진 표시 자리 */
export function SetupGuide({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 360 170" className={className} role="img" aria-label="태블릿 설치 방법 그림">
      <line x1="10" y1="150" x2="350" y2="150" stroke="#CBD5E1" strokeWidth="3" strokeLinecap="round" />
      {/* 태블릿 (살짝 위를 보게) */}
      <g transform="rotate(-14 52 128)">
        <rect x="36" y="96" width="34" height="52" rx="5" fill="#0F172A" />
        <rect x="40" y="101" width="26" height="40" rx="2" fill="#10B981" />
        <circle cx="53" cy="99" r="1.8" fill="#A7F3D0" />
      </g>
      <path d="M40 150 L66 150 L60 136 Z" fill="#475569" />
      {/* 거리 화살표 */}
      <line x1="84" y1="160" x2="252" y2="160" stroke="#10B981" strokeWidth="3" strokeDasharray="6 6" />
      <path d="M252 160 l-9 -5 v10 z M84 160 l9 -5 v10 z" fill="#10B981" />
      <rect x="136" y="148" width="66" height="22" rx="11" fill="#ECFDF5" />
      <text x="169" y="163" textAnchor="middle" fontSize="13" fontWeight="800" fill="#047857">2.5~3m</text>
      {/* 표시 자리 */}
      <path d="M262 152 l26 -6 M262 146 l26 6" stroke="#F5A524" strokeWidth="5" strokeLinecap="round" />
      {/* 사람 */}
      <circle cx="276" cy="34" r="12" fill="#0F172A" />
      <path d="M262 56 Q276 50 290 56 L286 96 Q276 99 266 96 Z" fill="#0F172A" />
      <path d="M264 58 L266 86 L270 42 M288 58 L286 86 L282 42" stroke="#0F172A" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="270" cy="40" r="6" fill="#10B981" />
      <circle cx="282" cy="40" r="6" fill="#10B981" />
      <path d="M270 96 L264 146 M282 96 L290 146" stroke="#0F172A" strokeWidth="8" strokeLinecap="round" />
      {/* 카메라 시야 */}
      <path d="M66 112 L250 20 M66 124 L250 150" stroke="#10B981" strokeOpacity="0.35" strokeWidth="2" strokeDasharray="4 6" />
    </svg>
  );
}
