# 복싱 셀프코치

장비 없는 중학교 복싱 수업용 웹앱입니다. 학생이 각자 태블릿을 바닥에 세워 두고 혼자 활동합니다.
AI 자세 인식은 태블릿 안에서만 작동하고, 영상은 저장하거나 보내지 않습니다. 서버·API·데이터베이스가 없습니다.

| 기능 | 내용 |
|---|---|
| 가드 체크 (1차시) | 설치 확인 → 내 가드 등록(3초) → 미션 라운드(손·팔꿈치 실시간 판정, 1초 유예) → 유지율 결과 |
| 섀도 반응 콜러 (2차시부터) | 색·화살표·단어 신호(잽, 스트레이트, 원투, 슬립, 덕킹), 레벨 3단계, 라운드 타이머, 가드 복귀율 측정 |
| 내 기록 | 학번, 자기점검 5문항, 소감, AI 측정값 자동 입력, 차시별 변화, 결과 복사(구글 폼·클래스룸 제출용) |

**접속 주소: https://hghdhghd0-tech.github.io/boxing/**

## GitHub Pages로 배포하기 (처음 한 번)

1. GitHub에서 **공개(Public) 저장소**를 새로 만듭니다. 예: `boxing`
2. 이 폴더에서 아래 명령을 실행합니다. (`내아이디`를 바꿔 주세요)
   ```bash
   git init
   git add .
   git commit -m "복싱 셀프코치 첫 배포"
   git branch -M main
   git remote add origin https://github.com/내아이디/boxing.git
   git push -u origin main
   ```
   > 웹에서 파일을 끌어다 올릴 경우 `.github` 폴더(점으로 시작)가 빠지지 않았는지 꼭 확인하세요. 이 폴더가 있어야 자동 배포가 됩니다.
3. 저장소 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 바꿉니다.
4. **Actions** 탭에서 "GitHub Pages 배포"가 초록색 체크가 되면 끝입니다.
   주소: `https://내아이디.github.io/boxing/`
5. 이 주소를 QR 코드로 만들어 학생들에게 나눠 줍니다.

이후에는 코드를 고쳐 `git push`만 하면 자동으로 다시 배포됩니다.
저장소 이름이 달라도 그대로 동작합니다. (상대 경로 설정)

## 수업 전에 꼭 해 둘 일

- **태블릿마다 한 번 미리 열어 두기**: 앱을 열고 "가드 체크"까지 들어가면 자세 인식 파일(약 20MB)을 받아 저장합니다.
  그다음부터는 와이파이가 약해도, 오프라인이어도 동작합니다. 30대가 수업 시작에 동시에 받으면 느릴 수 있어요.
- **카메라 허용**: 처음 열 때 카메라 권한을 묻습니다. "허용"을 눌러야 합니다.
- **브라우저**: Edge 또는 Chrome을 권장합니다.
- **바닥 표시**: 태블릿에서 2.5~3m 떨어진 자리에 테이프나 콘으로 서는 자리를 표시합니다.

## 판정 기준값 바꾸기

체육관에서 실제로 테스트한 뒤 `src/config.ts`의 숫자만 바꾸면 됩니다. 모든 거리는 "어깨너비 = 1" 비율입니다.

| 이름 | 처음 값 | 뜻 |
|---|---|---|
| `GUARD.handDrop` | 0.3 | 내 가드보다 손이 이만큼 내려가면 무너짐 |
| `GUARD.elbowOut` | 0.25 | 내 가드보다 팔꿈치가 이만큼 벌어지면 무너짐 |
| `GUARD.graceMs` | 1000 | 이 시간(ms) 넘게 무너져야 경고 |
| `CALLER.returnWindowMs` | 1500 | 공격 신호 뒤 이 시간 안에 가드로 돌아오면 복귀 성공 |

오경보가 많으면 숫자를 조금 키우고, 무너졌는데 경고가 늦으면 조금 줄이세요.

## 내 컴퓨터에서 실행하기 (선택)

Node.js 22 이상이 필요합니다.

```bash
npm install
npm run dev      # 개발 서버 (카메라는 localhost에서만 허용됩니다)
npm test         # 가드 판정 로직 자동 테스트
npm run build    # 배포용 빌드 (dist 폴더)
```

`npm run dev`와 `npm run build`는 시작할 때 자세 인식 파일을 `public/` 폴더에 자동으로 준비합니다.
모델 파일은 Google 공식 주소에서 받습니다. 받지 못하면 앱이 실행될 때 같은 주소에서 직접 불러옵니다.

## 폴더 구성

```
src/
  config.ts          판정 기준값
  screens/           홈, 가드 체크, 섀도 반응 콜러, 내 기록 화면
  pose/              카메라, AI 자세 인식, 가드 판정 로직(guard.ts)
  caller/            콜러 신호 정의
  storage/           태블릿 안 기록 저장(localStorage), 결과 복사 글
  components/        버튼·카드, 카메라 화면, 안내 그림
tests/run-tests.ts   판정 로직 테스트
scripts/             자세 인식 파일 준비 스크립트
.github/workflows/   GitHub Pages 자동 배포
```

## 알아 둘 점

- AI 판정은 **참고용**입니다. 턱 들림처럼 정면·바닥 카메라로 잡기 어려운 부분은 교사 관찰로 보완해 주세요.
- 기록은 그 태블릿에만 남습니다. 태블릿을 초기화하면 지워지므로, 수업마다 "결과 복사"로 제출받으세요.
- 사용한 기술: React 19, Vite, TypeScript, Tailwind CSS 4, MediaPipe Pose Landmarker(lite), Pretendard 글꼴.
