import type { Card } from 'ts-fsrs';

export interface VocabItem {
    id: string;
    word: string;
    phonetic?: string;
    meaning: string;
    example?: string;
    tag?: string;
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
}

export type StudyMode = 'flashcard' | 'spelling';
export type AppTab = 'study' | 'add' | 'list';