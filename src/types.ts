import type { Card } from 'ts-fsrs';

export interface VocabItemStats {
    wins: number;
    losses: number;
    recentHistory: Array<'O' | 'X'>;
    totalTimeMs: number;
    lastSolvedAt?: number;
}

export interface VocabItem {
    id: string;
    word: string;
    phonetic?: string;
    meaning: string;
    example?: string;
    tag?: string; // 예: "Vocabulary/Unit 09" (상위폴더/하위폴더)
    customTags?: string[]; // 예: ["오답", "신기 방기", "억까"]
    itemStats?: VocabItemStats;
    card: Card;
    createdAt: number;
}

export interface ExtractedVocabDraft {
    id: string;
    word: string;
    phonetic: string;
    meaning: string;
    example: string;
    selected: boolean;
}

export interface StudyStats {
    streak: number;
    lastStudyDate: string | null;
    todayDate: string;
    todayReviewed: number;
    todayCorrect: number;
    todayWrong: number;
    currentAnswerStreak: number;
    todayBestStreak: number;
    allTimeBestStreak: number;
}

export type StudyMode = 'flashcard' | 'spelling';
export type AppTab = 'study' | 'add' | 'list';
export type SortOrder = 'order' | 'due' | 'wrong_rate' | 'random';