import { createEmptyCard, type Card } from 'ts-fsrs';
import type { VocabItem } from '../types';

const STORAGE_KEY = 'soi_vocab_items_v1';

const INITIAL_SAMPLES: Array<{ word: string; meaning: string; example?: string }> = [
    { word: 'adventure', meaning: '모험', example: 'Reading books is a great adventure.' },
    { word: 'brave', meaning: '용감한', example: 'The brave knight protected the village.' },
    { word: 'curious', meaning: '호기심 많은', example: 'She is curious about how stars shine.' },
    { word: 'discover', meaning: '발견하다', example: 'Scientists discover new things every day.' },
    { word: 'environment', meaning: '환경', example: 'We must protect our environment.' },
    { word: 'favorite', meaning: '가장 좋아하는', example: 'What is your favorite season?' },
    { word: 'imagine', meaning: '상상하다', example: 'Close your eyes and imagine flying.' },
    { word: 'knowledge', meaning: '지식', example: 'Knowledge comes from reading and practice.' },
    { word: 'precious', meaning: '소중한', example: 'Time with family is very precious.' },
    { word: 'strategy', meaning: '전략', example: 'We need a good strategy to win the game.' },
];

export function createNewVocabItem(
    word: string,
    meaning: string,
    example?: string,
    now: Date = new Date()
): VocabItem {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        word: word.trim(),
        meaning: meaning.trim(),
        example: example?.trim() || undefined,
        card: createEmptyCard(now),
        createdAt: now.getTime(),
    };
}

function hydrateCard(raw: Card): Card {
    const base = createEmptyCard();
    return {
        ...base,
        ...raw,
        due: raw.due ? new Date(raw.due) : new Date(),
        last_review: raw.last_review ? new Date(raw.last_review) : undefined,
    };
}

export function loadVocabItems(): VocabItem[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            const seeded = INITIAL_SAMPLES.map((item, idx) =>
                createNewVocabItem(item.word, item.meaning, item.example, new Date(Date.now() + idx))
            );
            saveVocabItems(seeded);
            return seeded;
        }
        const parsed = JSON.parse(raw) as VocabItem[];
        if (!Array.isArray(parsed)) return [];
        return parsed.map((item) => ({
            ...item,
            card: hydrateCard(item.card),
        }));
    } catch {
        return [];
    }
}

export function saveVocabItems(items: VocabItem[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function getSampleItems(): VocabItem[] {
    const now = Date.now();
    return INITIAL_SAMPLES.map((item, idx) =>
        createNewVocabItem(item.word, item.meaning, item.example, new Date(now + idx))
    );
}