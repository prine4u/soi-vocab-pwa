import type { Card } from 'ts-fsrs';

export interface VocabCard {
  id: string;
  word: string;          // 영어 단어 (예: "curious")
  meaning: string;       // 한국어 핵심 뜻 (예: "호기심이 많은")
  example: string;       // 초등 눈높이 영어 예문
  exampleKo: string;     // 예문 해석
  fsrsCard: Card;        // ts-fsrs가 관리하는 기억 안정성·난이도·다음 복습일 객체
}