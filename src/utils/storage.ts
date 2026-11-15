import { createEmptyCard, type Card } from 'ts-fsrs';
import type { VocabItem, StudyStats, VocabItemStats } from '../types';

const STORAGE_KEY = 'soi_vocab_items_v1';
const STATS_KEY = 'soi_vocab_stats_v1';
const CATEGORIES_KEY = 'soi_vocab_categories_v1';

export const DEFAULT_CATEGORY = 'Vocabulary/Unit 01';

export function getDateKey(date: Date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function formatDateTime(ts?: number): string {
    if (!ts) return '-';
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${hh}:${mm}`;
}

/**
 * 단어마다 첫 글자 대문자 + 그다음 소문자 + 숫자 앞 한 칸 띄어쓰기 + 한 자리 유닛 번호 0 채우기
 * 예: "unit9" -> "Unit 09", "vocabulary engine" -> "Vocabulary Engine"
 */
export function formatFolderSegment(raw: string): string {
    let s = raw.trim();
    if (!s) return '';
    // 영문/한글과 숫자 사이 공백 한 칸 자동 삽입
    s = s.replace(/([A-Za-z가-힣])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z가-힣])/g, '$1 $2');
    s = s.replace(/\s+/g, ' ');
    // 영어 단어 Title Case 변환
    s = s.replace(/[A-Za-z]+/g, (word) => {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
    // Unit 9 -> Unit 09 형태 보정
    s = s.replace(
        /\b(Unit|Day|Part|Chapter|Lesson)\s+(\d)\b/gi,
        (_, prefix: string, digit: string) =>
            `${prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase()} 0${digit}`
    );
    return s.trim();
}

export function normalizeCategory(tag?: string): string {
    const trimmed = tag?.trim().replace(/^\/+|\/+$/g, '');
    if (!trimmed) return DEFAULT_CATEGORY;
    const formatted = trimmed
        .split('/')
        .map((part) => formatFolderSegment(part))
        .filter(Boolean)
        .join('/');
    return formatted || DEFAULT_CATEGORY;
}

export function createEmptyItemStats(): VocabItemStats {
    return {
        wins: 0,
        losses: 0,
        recentHistory: [],
        totalTimeMs: 0,
    };
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
        itemStats: createEmptyItemStats(),
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
        if (!raw) return [];
        const parsed = JSON.parse(raw) as VocabItem[];
        if (!Array.isArray(parsed)) return [];
        return parsed.map((item) => ({
            ...item,
            phonetic: item.phonetic?.trim() || undefined,
            tag: normalizeCategory(item.tag),
            itemStats: item.itemStats
                ? {
                    wins: item.itemStats.wins || 0,
                    losses: item.itemStats.losses || 0,
                    recentHistory: Array.isArray(item.itemStats.recentHistory)
                        ? item.itemStats.recentHistory.slice(-10)
                        : [],
                    totalTimeMs: item.itemStats.totalTimeMs || 0,
                    lastSolvedAt: item.itemStats.lastSolvedAt,
                }
                : createEmptyItemStats(),
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
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        const set = new Set<string>();
        parsed.forEach((c) => {
            if (typeof c === 'string' && c.trim() && c.trim() !== '기본 학습장') {
                set.add(normalizeCategory(c));
            }
        });
        return Array.from(set);
    } catch {
        return [];
    }
}

export function saveCustomCategories(categories: string[]): void {
    const set = new Set<string>();
    categories.forEach((c) => {
        if (c.trim() && c.trim() !== '기본 학습장') {
            set.add(normalizeCategory(c));
        }
    });
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(Array.from(set)));
}

export function loadStudyStats(): StudyStats {
    const today = getDateKey();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = getDateKey(yesterdayDate);

    try {
        const raw = localStorage.getItem(STATS_KEY);
        if (!raw) {
            return {
                streak: 0,
                lastStudyDate: null,
                todayDate: today,
                todayReviewed: 0,
                todayCorrect: 0,
                todayWrong: 0,
            };
        }
        const parsed = JSON.parse(raw) as Partial<StudyStats>;
        const isAliveStreak =
            parsed.lastStudyDate === today || parsed.lastStudyDate === yesterday;
        const isToday = parsed.todayDate === today;

        return {
            streak: isAliveStreak ? parsed.streak || 0 : 0,
            lastStudyDate: parsed.lastStudyDate ?? null,
            todayDate: today,
            todayReviewed: isToday ? parsed.todayReviewed || 0 : 0,
            todayCorrect: isToday ? parsed.todayCorrect || 0 : 0,
            todayWrong: isToday ? parsed.todayWrong || 0 : 0,
        };
    } catch {
        return {
            streak: 0,
            lastStudyDate: null,
            todayDate: today,
            todayReviewed: 0,
            todayCorrect: 0,
            todayWrong: 0,
        };
    }
}

export function saveStudyStats(stats: StudyStats): void {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

export function recordAnswerStats(prev: StudyStats, isCorrect: boolean): StudyStats {
    const today = getDateKey();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = getDateKey(yesterdayDate);

    const isSameDay = prev.todayDate === today;
    const todayReviewed = (isSameDay ? prev.todayReviewed : 0) + 1;
    const todayCorrect = (isSameDay ? prev.todayCorrect : 0) + (isCorrect ? 1 : 0);
    const todayWrong = (isSameDay ? prev.todayWrong : 0) + (isCorrect ? 0 : 1);

    let streak = prev.streak;
    if (prev.lastStudyDate !== today) {
        streak = prev.lastStudyDate === yesterday ? prev.streak + 1 : 1;
    }

    return {
        streak,
        lastStudyDate: today,
        todayDate: today,
        todayReviewed,
        todayCorrect,
        todayWrong,
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
            itemStats: obj.itemStats ?? createEmptyItemStats(),
            card: hydrateCard(obj.card),
            createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : now + idx,
        });
    });

    return result;
}