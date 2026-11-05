// 새 버전 자동 적용
// - 앱을 열 때와 다시 볼 때마다 새 버전이 있는지 확인합니다.
// - 새 버전이 준비되면 홈 화면에 있을 때만 새로고침합니다. (라운드 중에는 절대 끊지 않아요)
import { registerSW } from 'virtual:pwa-register';

let pendingReload = false;
let onHome = true;

function reloadIfSafe() {
  if (pendingReload && onHome) window.location.reload();
}

/** 지금 홈 화면인지 알려 줍니다. 홈으로 돌아올 때 기다리던 새 버전을 적용합니다. */
export function setOnHome(v: boolean) {
  onHome = v;
  reloadIfSafe();
}

export function setupAutoUpdate() {
  if (import.meta.env.DEV) return;
  registerSW({
    immediate: true,
    onNeedReload() {
      pendingReload = true;
      reloadIfSafe();
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => void reg.update().catch(() => undefined);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.setInterval(check, 20 * 60 * 1000);
    },
  });
}

/** 배포 시각 (홈 화면 아래에 작게 표시: 어떤 버전인지 확인용) */
export const BUILD_ID: string = __BUILD_ID__;
