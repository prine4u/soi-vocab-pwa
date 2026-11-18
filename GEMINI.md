# Soi Vocab (소이의 단어 암기장) — Project Context & Architecture Guide

## 1. Project Overview
- **App Name:** 소이의 단어 암기장 (`Soi Vocab - AI 영단어장`)
- **Target User:** 초등학생(이소이) 맞춤형 영어 단어 암기 및 망각곡선 복습 PWA
- **Core Capabilities:**
  1. **FSRS Spaced Repetition:** `ts-fsrs` 기반 개인별 망각곡선 복습 스케줄링 (`다시`, `어려움`, `보통`, `쉬움`)
  2. **AI Textbook OCR:** Gemini Vision API를 통한 단어장 다중 사진 스캔 및 큰 제목(Unit) 기준 자동 폴더 분류
  3. **Cross-Device Cloud Sync:** Synology NAS + n8n Webhook + Telegram Bot 연동을 통한 PC·iPhone·Android 실시간 양방향 동기화
  4. **Anki-Style Study Helpers:** 10단계 실행 취소(Undo), FSRS 일정 보존 자유 복습(벼락치기/Cram Mode), 별표(⭐)·취약 단어(🔥) 필터, PC 키보드 단축키

---

## 2. Tech Stack & Directory Structure
- **Framework:** React + TypeScript + Vite (PWA)
- **Spaced Repetition:** `ts-fsrs`
- **Icons:** `lucide-react`
- **Audio (TTS):** Browser Web Speech API (`window.speechSynthesis`)
- **Deployment & Backup:** Windows Batch (`deploy.bat`, `rollback.bat`) → GitHub → Vercel/Static Hosting

```text
├── index.html                 # PWA 메타태그, theme-color(#FFED00), /icon.svg, sw.js 등록
├── public/
│   ├── icon.svg               # 싸토리우스 옐로우(#FFED00) + 블랙(#0F172A) SOI 카드 아이콘
│   ├── manifest.json          # PWA 매니페스트 (short_name: "소이 단어장")
│   └── sw.js                  # Service Worker
├── src/
│   ├── types.ts               # VocabItem, VocabItemStats, StudyStats, CloudSyncState 등 타입 정의
│   ├── index.css              # 싸토리우스 브랜드 옐로우 & 파스텔 옐로우 카드 디자인 시스템
│   ├── App.tsx                # 메인 UI, FSRS 스케줄러, 학습 모드, 설정/폴더 모달, 단축키 핸들러
│   └── utils/
│       ├── storage.ts         # LocalStorage 관리, 품사 약어 풀네임 변환, 스펠링 스포일러 가림, 영어 예문 추출
│       ├── cloudSync.ts       # n8n Webhook 양방향 동기화 (GET pull / POST no-cors push)
│       └── ocr.ts             # 클라이언트 이미지 리사이징(2048px) 및 Gemini Vision 단어 추출
├── deploy.bat                 # tsc -b && vite build 검증 → _backups 스냅샷 저장 → Git 커밋/태그/푸시
├── rollback.bat               # _backups 목록 조회 → 선택 버전 복원 (직전 상태 자동 안전 백업)
└── _backups/                  # 버전별 자동 백업 폴더 (.gitignore에 _backups/ 등록 권장)