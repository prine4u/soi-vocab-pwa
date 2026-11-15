import { createEmptyCard, type Card } from 'ts-fsrs';
import type { VocabItem, StudyStats } from '../types';

const STORAGE_KEY = 'soi_vocab_items_v1';
const STATS_KEY = 'soi_vocab_stats_v1';

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

export function getDateKey(date: Date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function createNewVocabItem(
    word: string,
    meaning: string,
    example?: string,
    now: Date = new Date(),
    tag?: string
): VocabItem {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        word: word.trim(),
        meaning: meaning.trim(),
        example: example?.trim() || undefined,
        tag: tag?.trim() || undefined,
        card: createEmptyCard(now),
        createdAt: now.getTime(),
    };
}

function hydrateCard(raw?: Partial<Card>): Card {
    const base = createEmptyCard();
    if (!raw) return base;
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

export function loadStudyStats(): StudyStats {
    const today = getDateKey();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = getDateKey(yesterdayDate);

    try {
        const raw = localStorage.getItem(STATS_KEY);
        if (!raw) {
            return { streak: 0, lastStudyDate: null, todayDate: today, todayReviewed: 0 };
        }
        const parsed = JSON.parse(raw) as StudyStats;
        const isAliveStreak =
            parsed.lastStudyDate === today || parsed.lastStudyDate === yesterday;
        return {
            streak: isAliveStreak ? parsed.streak || 0 : 0,
            lastStudyDate: parsed.lastStudyDate ?? null,
            todayDate: today,
            todayReviewed: parsed.todayDate === today ? parsed.todayReviewed || 0 : 0,
        };
    } catch {
        return { streak: 0, lastStudyDate: null, todayDate: today, todayReviewed: 0 };
    }
}

export function saveStudyStats(stats: StudyStats): void {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

export function incrementTodayReview(prev: StudyStats): StudyStats {
    const today = getDateKey();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = getDateKey(yesterdayDate);

    const todayReviewed = (prev.todayDate === today ? prev.todayReviewed : 0) + 1;
    let streak = prev.streak;

    if (prev.lastStudyDate !== today) {
        streak = prev.lastStudyDate === yesterday ? prev.streak + 1 : 1;
    }

    return {
        streak,
        lastStudyDate: today,
        todayDate: today,
        todayReviewed,
    };
}

export function parseImportedVocab(jsonText: string): VocabItem[] {
    const parsed = JSON.parse(jsonText) as unknown;
    const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)
            ? (parsed as { items: unknown[] }).items
            : null;

    if (!list) {
        throw new Error('올바른 단어장 JSON 형식이 아닙니다.');
    }

    const now = Date.now();
    const result: VocabItem[] = [];

    list.forEach((entry, idx) => {
        if (!entry || typeof entry !== 'object') return;
        const obj = entry as Partial<VocabItem>;
        if (typeof obj.word !== 'string' || typeof obj.meaning !== 'string') return;
        const word = obj.word.trim();
        const meaning = obj.meaning.trim();
        if (!word || !meaning) return;

        result.push({
            id: typeof obj.id === 'string' && obj.id ? obj.id : `${now}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
            word,
            meaning,
            example: typeof obj.example === 'string' && obj.example.trim() ? obj.example.trim() : undefined,
            tag: typeof obj.tag === 'string' && obj.tag.trim() ? obj.tag.trim() : undefined,
            card: hydrateCard(obj.card),
            createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : now + idx,
        });
    });

    return result;
}