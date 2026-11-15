import type { Card } from 'ts-fsrs';

export interface VocabItem {
    id: string;
    word: string;
    meaning: string;
    example?: string;
    card: Card;
    createdAt: number;
}

export type StudyMode = 'flashcard' | 'spelling';
export type AppTab = 'study' | 'add' | 'list';