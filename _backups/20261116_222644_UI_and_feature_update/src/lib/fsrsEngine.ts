import {
    createEmptyCard,
    fsrs,
    generatorParameters,
    Rating,
    type Grade,
} from 'ts-fsrs';
import type { VocabCard } from '../types/vocab';

// 1. FSRS 파라미터 초기화 (커스터마이징 가능 영역)
const params = generatorParameters({
    request_retention: 0.9,   // 목표 기억 확률 90%
    maximum_interval: 365,    // 최대 복습 간격 1년 제한
    enable_fuzz: true,        // 같은 날 추가된 카드가 한꺼번에 몰리지 않도록 날짜 분산
    enable_short_term: true,  // 오늘 처음 보거나 틀린 단어를 세션 내 재확인
});

const scheduler = fsrs(params);

// 2. 새 단어 생성 헬퍼 (Gemini OCR 결과물을 앱 카드로 변환할 때 호출)
export function createVocabCard(
    id: string,
    word: string,
    meaning: string,
    example: string,
    exampleKo: string
): VocabCard {
    return {
        id,
        word,
        meaning,
        example,
        exampleKo,
        fsrsCard: createEmptyCard(new Date()),
    };
}

// 3. 버튼 위에 표시할 '다음 복습까지 남은 시간' 미리보기 텍스트 계산
export function getIntervalLabels(vocab: VocabCard, now = new Date()): Record<Grade, string> {
    const recordLog = scheduler.repeat(vocab.fsrsCard, now);
    const grades: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

    const labels = {} as Record<Grade, string>;
    for (const grade of grades) {
        const nextDue = recordLog[grade].card.due;
        const diffMinutes = Math.round((nextDue.getTime() - now.getTime()) / (1000 * 60));

        if (diffMinutes < 60) {
            labels[grade] = `${Math.max(1, diffMinutes)}분 뒤`;
        } else if (diffMinutes < 60 * 24) {
            labels[grade] = `${Math.round(diffMinutes / 60)}시간 뒤`;
        } else {
            labels[grade] = `${Math.round(diffMinutes / (60 * 24))}일 뒤`;
        }
    }
    return labels;
}

// 4. 학습자가 버튼을 눌렀을 때 FSRS 상태 업데이트
export function applyReview(vocab: VocabCard, grade: Grade, now = new Date()): VocabCard {
    const recordLog = scheduler.repeat(vocab.fsrsCard, now);
    return {
        ...vocab,
        fsrsCard: recordLog[grade].card,
    };
}