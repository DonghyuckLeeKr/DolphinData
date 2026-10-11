# DolphinData 개발 자동화 (이 PC에서 시작)

## 흐름

1. 사용자: 앱 설정 → 문제 진단 리포트 → 기록 시작 → USB 재연결 등 문제 동작 → 기록 종료 및 내용 확인 → JSON 다운로드.
2. 관리자: 이 PC의 관리자 화면에서 JSON 가져오기. 디스코드 봇을 연결한 경우 지정 채널의 `/dolphin-report file:`로도 접수할 수 있습니다.
3. 관리자 계정: 자동 수정 요청. 이 PC의 Codex가 별도 복제본에서 수정합니다. 로그인된 ChatGPT 사용량을 사용하며 계정 한도가 적용됩니다.
4. 수정 범위 검사 → 검토용 GitHub 브랜치 및 draft PR → GitHub Windows 검사 및 설치파일 생성. 자동 수정 프로세스에는 GitHub·디스코드·업데이트 서명 환경변수를 전달하지 않습니다.
5. 관리자: PR 변경 내용과 검사 설치파일을 실제 장치에서 확인 → **수정 검토 완료 · 승인**. 검사한 커밋을 main에 fast-forward로 반영합니다. Git의 원자적인 기준 커밋 확인으로 승인 중 main이 바뀌어도 덮어쓰지 않습니다. main이 바뀌었다면 새 기록 요청으로 다시 검사해야 합니다. 저장소에 추가 브랜치 보호 정책이 있으면 이 단계가 거절될 수 있습니다.
6. 관리자: **이 버전 배포 승인**. GitHub `production` 환경 승인을 처리한 후 서명된 자동 업데이트와 설치파일을 빌드·배포합니다. 이 단계의 빌드는 같은 코드에 대해 다시 수행하므로 검토용 설치파일과 파일 해시는 다를 수 있습니다.

승인하지 않은 수정본은 사용자에게 배포되지 않습니다. 디스코드 버튼은 서버 ID·채널 ID·본인 계정 ID가 모두 일치해야 동작합니다. 역할 이름이나 표시 이름을 승인 근거로 사용하지 않습니다. 승인 이력에 코드 커밋, 수정본 SHA256, 승인 계정과 시간을 남깁니다.

## 최초 운영 준비

- Node.js 22+, Git, GitHub CLI, Codex CLI가 필요합니다. `codex login`과 `gh auth login`을 먼저 완료합니다. Codex CLI는 `--ignore-user-config`, `--ignore-rules`, `--ephemeral` 옵션을 지원해야 합니다. 현재 PC의 CLI 0.162.0-alpha.17.2에서 확인했습니다.
- 이 변경을 main에 반영해야 GitHub `preview-windows.yml` 검사 작업이 등록됩니다. 이후 새 PR마다 해당 커밋의 Windows 검사가 자동 실행됩니다. 관리자 화면에 준비 상태가 표시됩니다.
- 저장소 Settings → Environments → `production`: required reviewers에 관리자를 지정하고, 혼자 운영하는 경우 본인 실행 승인 금지를 해제합니다. 관리자 화면과 봇은 승인자가 없는 환경에서는 코드 승인도 거절합니다.
- 기존 GitHub `TAURI_PRIVATE_KEY`, `TAURI_KEY_PASSWORD`가 업데이트 서명에 사용됩니다. 일반 Windows 실행파일의 인증서 서명과는 별개입니다.
- `automation/Start-Automation.cmd` 더블클릭. 처음에는 봇 라이브러리를 설치합니다. 표시된 로컬 주소를 브라우저에서 엽니다. 주소에는 임시 관리자 키가 있으므로 공유하지 않습니다. 새로고침 후 인증이 해제되면 실행 창의 원래 주소를 다시 엽니다.
- `npm run automation`으로 디스코드 없이 관리자 화면만 실행할 수도 있습니다.

파일과 수정본은 `%LOCALAPPDATA%\DolphinData\automation`에 보관합니다. 서버는 `127.0.0.1:4174`만 사용합니다. PC가 꺼져 있거나 도구가 종료되면 리포트 접수와 버튼 처리는 중단됩니다. GitHub 검사는 계속되며 재실행하면 결과를 확인합니다. 진행 중 로컬 수정이 중단되면 자동 재시도하지 않습니다.

## 디스코드 설정

1. [Discord Developer Portal](https://discord.com/developers/applications)에서 애플리케이션과 봇을 만들고 서버에 초대합니다. `bot`, `applications.commands` 범위를 사용합니다.
2. 설치 범위는 `bot`, `applications.commands`, 권한은 View Channel, Send Messages, Embed Links, Read Message History를 선택합니다. 비공개 승인 채널은 ‘멤버 또는 역할 추가’에서 봇 역할도 허용해야 합니다. 관리자 권한은 필요하지 않습니다. Guilds intent만 사용하며 Message Content 등 privileged intents는 필요하지 않습니다.
3. 디스코드 개발자 모드를 켜고 서버·리포트 채널·본인 계정 ID를 복사합니다. 리포트에는 사용자의 설명이 첨부파일로 포함될 수 있으므로 채널 접근 권한을 제한해주세요.
4. `automation/Set-Discord.cmd` 더블클릭. 토큰은 화면에 표시되지 않는 보안 입력으로 받고 Windows DPAPI로 암호화해 이 PC에 저장합니다. 토큰을 채팅·소스·GitHub 이슈에 붙여 넣지 않습니다.
5. `automation/Start-Automation.cmd` 더블클릭. 봇이 지정 서버의 `/dolphin-report` 명령을 등록합니다. 파일 접수, 자동 수정, 수정 승인, 배포 승인을 이 채널에서 진행합니다.

단순 Discord webhook은 알림만 지원합니다. 이 구현은 Gateway 봇 연결을 사용하므로 이 PC에 외부에서 접근하는 웹 서버 주소나 포트 개방이 필요하지 않습니다. 모바일 디스코드에서도 같은 버튼을 누를 수 있습니다.

## 데이터 범위 및 검증 한계

- 진단 기록은 기본으로 꺼져 있습니다. 기록 시작 이후 최대 240개 상태를 메모리에 수집합니다. 종료 또는 앱 종료 후 추가 수집하지 않습니다.
- 네트워크 이름, 장치 식별값, 어댑터 이름, 게이트웨이를 리포트별 별칭으로 대체합니다. 실제 사용량·요금제 이름·SIM 번호는 내보내지 않습니다. 기존 사용량·기준 사용량·일별 기록의 존재를 작은 고정값으로 표현합니다.
- Windows 버전·CPU 아키텍처와 설치된 USB 네트워크 드라이버의 버전·USB VID/PID(기종 식별용 공통값)를 포함합니다. 장치별 일련번호나 전체 PnP ID는 포함하지 않습니다. 권한·드라이버에 따라 수집에 실패하면 이 부분은 비어 있을 수 있습니다.
- 사용자가 입력한 설명의 일반적인 IP·MAC·이메일·SIM 형태 번호·Windows 사용자 경로를 가리지만 임의의 개인정보를 모두 찾을 수는 없습니다. 다운로드 전 내용을 확인해주세요. 설명은 AI 프롬프트·공개 PR 본문에 포함하지 않습니다.
- 기록 재생은 실제 앱의 네트워크 확인·분류 함수를 호출합니다. 익명화로 인한 정보 제한이 있으며 실제 USB 드라이버, SIM 교체, 부팅 자동 실행, ETW 권한을 재현하지 않습니다. 검사 성공만으로 해당 하드웨어 동작이 입증되지는 않습니다.
- 자동 수정이 허용되는 파일은 `src`의 JS/JSX/CSS, `src-tauri/src`의 Rust, `tests`의 JS 테스트입니다. 의존성·워크플로·자동화 코드 변경은 수동 개발 대상으로 남깁니다. 한 번에 최대 30개 파일, 512KB 변경을 허용합니다.
- 자동 수정은 20분 안에 끝나야 합니다. 근거가 부족하면 변경을 만들지 않습니다. 실패한 요청은 새로운 리포트로 재시도할 수 있으며 기존 검토용 PR은 수동으로 닫습니다.
- 관리자 로컬 프로세스와 Codex는 동일한 Windows 사용자로 실행됩니다. Windows sandbox는 실행 경계를 제공하지만 별도 운영체제/VM 격리는 아닙니다. 운영을 확대할 때는 전용 Windows 계정 또는 별도 워커로 분리하는 것이 좋습니다.

참고: [Codex 비대화형 실행](https://learn.chatgpt.com/docs/non-interactive-mode), [Discord interactions](https://github.com/discord/discord-api-docs/blob/main/developers/platform/interactions.mdx).
