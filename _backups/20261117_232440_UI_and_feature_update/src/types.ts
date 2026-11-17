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
    tag?: string;
    starred?: boolean;
    itemStats?: VocabItemStats;
    card: Card;
    createdAt: number;
}

export interface ExtractedVocabDraft {
    id: string;
    unit?: string;
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
}

export interface CloudSyncState {
    updatedAt: number;
    items: VocabItem[];
    categories: string[];
    stats: StudyStats | null;
}

export type StudyMode = 'flashcard' | 'spelling';
export type StudyFilter = 'all' | 'starred' | 'weak';
export type AppTab = 'study' | 'add' | 'list';