// 소리 켜기, 앞손 설정 같은 작은 설정 (이 태블릿에서만 기억)
import type { Stance } from '../caller/actionJudge.ts';

function getRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function setRaw(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // 무시
  }
}
function get(key: string, fallback: boolean) {
  const v = getRaw(key);
  return v === null ? fallback : v === '1';
}
const set = (key: string, v: boolean) => setRaw(key, v ? '1' : '0');

export const prefs = {
  guardSound: () => get('bsc.pref.guardSound', false),
  setGuardSound: (v: boolean) => set('bsc.pref.guardSound', v),
  callerSound: () => get('bsc.pref.callerSound', false),
  setCallerSound: (v: boolean) => set('bsc.pref.callerSound', v),
  hideWords: () => get('bsc.pref.hideWords', false),
  setHideWords: (v: boolean) => set('bsc.pref.hideWords', v),
  /** 섀도 반응 콜러: 카메라로 동작 판정 (기본 켜짐) */
  callerCamera: () => get('bsc.pref.callerCamera', true),
  setCallerCamera: (v: boolean) => set('bsc.pref.callerCamera', v),
  /** 앞손 설정. 처음 쓰는 태블릿이면 null (학생이 직접 고르게) */
  stance: (): Stance | null => {
    const v = getRaw('bsc.pref.stance');
    return v === 'orthodox' || v === 'southpaw' ? v : null;
  },
  setStance: (v: Stance) => setRaw('bsc.pref.stance', v),
};
