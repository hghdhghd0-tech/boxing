// 소리 켜기 같은 작은 설정 (이 태블릿에서만 기억)
function get(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function set(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    // 무시
  }
}

export const prefs = {
  guardSound: () => get('bsc.pref.guardSound', false),
  setGuardSound: (v: boolean) => set('bsc.pref.guardSound', v),
  callerSound: () => get('bsc.pref.callerSound', false),
  setCallerSound: (v: boolean) => set('bsc.pref.callerSound', v),
  hideWords: () => get('bsc.pref.hideWords', false),
  setHideWords: (v: boolean) => set('bsc.pref.hideWords', v),
};
