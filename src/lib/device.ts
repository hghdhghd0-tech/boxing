// 화면 꺼짐 방지, 전체 화면, 효과음

type WakeLockLike = { release: () => Promise<void> };
let wakeLock: WakeLockLike | null = null;

/** 라운드 중에 태블릿 화면이 꺼지지 않게 합니다. */
export async function keepScreenOn(on: boolean) {
  try {
    if (on && !wakeLock) {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockLike> } };
      wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}

export async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    // 전체 화면을 지원하지 않는 환경
  }
}

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** 짧은 효과음 */
export function beep(freq = 880, ms = 120, volume = 0.15) {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, a.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + ms / 1000);
  osc.connect(gain).connect(a.destination);
  osc.start();
  osc.stop(a.currentTime + ms / 1000 + 0.02);
}

/** 라운드 시작·끝 종소리 */
export function bell() {
  beep(1320, 500, 0.2);
  setTimeout(() => beep(1320, 500, 0.2), 180);
}

/** 사용자가 버튼을 누를 때 소리를 켤 수 있게 미리 준비합니다. (브라우저 정책) */
export function unlockAudio() {
  audio();
}
