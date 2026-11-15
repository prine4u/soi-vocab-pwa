import { createEmptyCard, type Card } from 'ts-fsrs';
import type { VocabItem, StudyStats } from '../types';

const STORAGE_KEY = 'soi_vocab_items_v1';
const STATS_KEY = 'soi_vocab_stats_v1';
const CATEGORIES_KEY = 'soi_vocab_categories_v1';

export const DEFAULT_CATEGORY = '기본 학습장';

const INITIAL_SAMPLES: Array<{
    word: string;
    phonetic?: string;
    meaning: string;
    example?: string;
}> = [
    {
        word: 'adventure',
        phonetic: '[ədvéntʃər]',
        meaning: '(명) 모험',
        example: 'Reading books is a great adventure.\n책을 읽는 것은 멋진 모험이다.',
    },
    {
        word: 'brave',
        phonetic: '[breiv]',
        meaning: '(형) 용감한',
        example: 'The brave knight protected the village.\n그 용감한 기사는 마을을 지켰다.',
    },
    {
        word: 'curious',
        phonetic: '[kjúəriəs]',
        meaning: '(형) 호기심 많은',
        example: 'She is curious about how stars shine.\n그녀는 별이 어떻게 빛나는지 궁금해한다.',
    },
    {
        word: 'discover',
        phonetic: '[diskʌ́vər]',
        meaning: '(동) 발견하다',
        example: 'Scientists discover new things every day.\n과학자들은 매일 새로운 것들을 발견한다.',
    },
    {
        word: 'environment',
        phonetic: '[inváiərənmənt]',
        meaning: '(명) 환경',
        example: 'We must protect our environment.\n우리는 환경을 보호해야 한다.',
    },
    {
        word: 'favorite',
        phonetic: '[féivərit]',
        meaning: '(형) 가장 좋아하는\n(명) 특히 좋아하는 것',
        example: 'What is your favorite season?\n네가 가장 좋아하는 계절은 무엇이니?',
    },
    {
        word: 'imagine',
        phonetic: '[imǽdʒin]',
        meaning: '(동) 상상하다',
        example: 'Close your eyes and imagine flying.\n눈을 감고 하늘을 나는 것을 상상해 봐.',
    },
    {
        word: 'knowledge',
        phonetic: '[nɑ́lidʒ]',
        meaning: '(명) 지식',
        example: 'Knowledge comes from reading and practice.\n지식은 독서와 연습에서 온다.',
    },
    {
        word: 'precious',
        phonetic: '[préʃəs]',
        meaning: '(형) 소중한, 귀중한',
        example: 'Time with family is very precious.\n가족과 함께하는 시간은 매우 소중하다.',
    },
    {
        word: 'strategy',
        phonetic: '[strǽtədʒi]',
        meaning: '(명) 전략, 작전',
        example: 'We need a good strategy to win the game.\n경기에 이기려면 좋은 전략이 필요하다.',
    },
];

export function getDateKey(date: Date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function normalizeCategory(tag?: string): string {
    const trimmed = tag?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_CATEGORY;
}

export function createNewVocabItem(
    word: string,
    meaning: string,
    example?: string,
    now: Date = new Date(),
    tag?: string,
    phonetic?: string
): VocabItem {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        word: word.trim(),
        phonetic: phonetic?.trim() || undefined,
        meaning: meaning.trim(),
        example: example?.trim() || undefined,
        tag: normalizeCategory(tag),
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
                createNewVocabItem(
                    item.word,
                    item.meaning,
                    item.example,
                    new Date(Date.now() + idx),
                    DEFAULT_CATEGORY,
                    item.phonetic
                )
            );
            saveVocabItems(seeded);
            return seeded;
        }
        const parsed = JSON.parse(raw) as VocabItem[];
        if (!Array.isArray(parsed)) return [];
        return parsed.map((item) => ({
            ...item,
            phonetic: item.phonetic?.trim() || undefined,
            tag: normalizeCategory(item.tag),
            card: hydrateCard(item.card),
        }));
    } catch {
        return [];
    }
}

export function saveVocabItems(items: VocabItem[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function loadCustomCategories(): string[] {
    try {
        const raw = localStorage.getItem(CATEGORIES_KEY);
        if (!raw) return [DEFAULT_CATEGORY];
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [DEFAULT_CATEGORY];
        const set = new Set<string>([DEFAULT_CATEGORY]);
        parsed.forEach((c) => {
            if (typeof c === 'string' && c.trim()) set.add(c.trim());
        });
        return Array.from(set);
    } catch {
        return [DEFAULT_CATEGORY];
    }
}

export function saveCustomCategories(categories: string[]): void {
    const set = new Set<string>([DEFAULT_CATEGORY]);
    categories.forEach((c) => {
        if (c.trim()) set.add(c.trim());
    });
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(Array.from(set)));
}

export function getSampleItems(): VocabItem[] {
    const now = Date.now();
    return INITIAL_SAMPLES.map((item, idx) =>
        createNewVocabItem(
            item.word,
            item.meaning,
            item.example,
            new Date(now + idx),
            DEFAULT_CATEGORY,
            item.phonetic
        )
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
            id:
                typeof obj.id === 'string' && obj.id
                    ? obj.id
                    : `${now}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
            word,
            phonetic:
                typeof obj.phonetic === 'string' && obj.phonetic.trim()
                    ? obj.phonetic.trim()
                    : undefined,
            meaning,
            example:
                typeof obj.example === 'string' && obj.example.trim() ? obj.example.trim() : undefined,
            tag: normalizeCategory(typeof obj.tag === 'string' ? obj.tag : undefined),
            card: hydrateCard(obj.card),
            createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : now + idx,
        });
    });

    return result;
}