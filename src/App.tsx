import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Home, type ScreenId } from './screens/Home.tsx';
import { GuardCheck } from './screens/GuardCheck.tsx';
import { Caller } from './screens/Caller.tsx';
import { RecordScreen } from './screens/Record.tsx';
import { setOnHome } from './lib/pwa.ts';

// 화면 전환은 주소(라우터) 대신 상태로 합니다. GitHub Pages에서 새로고침해도 404가 나지 않아요.
export default function App() {
  const [screen, setScreen] = useState<ScreenId>('home');
  const home = () => setScreen('home');

  // 새 버전은 홈 화면에 있을 때만 적용합니다.
  useEffect(() => setOnHome(screen === 'home'), [screen]);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={screen}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="h-full"
      >
        {screen === 'home' && <Home onOpen={setScreen} />}
        {screen === 'guard' && <GuardCheck onExit={home} onGoRecord={() => setScreen('record')} />}
        {screen === 'caller' && (
          <Caller onExit={home} onGoRecord={() => setScreen('record')} onGoGuard={() => setScreen('guard')} />
        )}
        {screen === 'record' && <RecordScreen onExit={home} onGoGuard={() => setScreen('guard')} />}
      </motion.div>
    </AnimatePresence>
  );
}
