import { createEmptyCard, type Card } from 'ts-fsrs';
import type { VocabItem, StudyStats, VocabItemStats } from '../types';

const STORAGE_KEY = 'soi_vocab_items_v1';
const STATS_KEY = 'soi_vocab_stats_v1';
const CATEGORIES_KEY = 'soi_vocab_categories_v1';
const UPDATED_AT_KEY = 'soi_vocab_updated_at_v1';

export const DEFAULT_CATEGORY = 'Vocabulary Engine/Unit 01';

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
    const m = String(datePad(d.getMonth() + 1));
    const day = String(datePad(d.getDate()));
    const hh = String(datePad(d.getHours()));
    const mm = String(datePad(d.getMinutes()));
    return `${y}-${m}-${day} ${hh}:${mm}`;
}

function datePad(n: number): string {
    return String(n).padStart(2, '0');
}

export function loadLocalUpdatedAt(): number {
    return Number(localStorage.getItem(UPDATED_AT_KEY)) || 0;
}

export function saveLocalUpdatedAt(ts: number = Date.now()): number {
    localStorage.setItem(UPDATED_AT_KEY, String(ts));
    return ts;
}

/**
 * 예문 텍스트에서 한글 해석과 A:/B: 기호를 제거하고 영어 문장만 추출
 */
// [변경 후: 위 구간을 아래 코드로 교체]
/**
 * 품사 및 단어 관계 약어를 풀네임으로 변환
 * 예: (형)->(형용사), [형]->[형용사], [반]->[반대어], [파]->[파생어], [부]->[부사], [영]->[영영풀이]
 */
export function expandMeaningAbbreviations(text?: string): string {
    if (!text) return '';
    const map: Array<[RegExp, string]> = [
        [/\(\s*형\s*\)/g, '(형용사)'],
        [/\[\s*형\s*\]/g, '[형용사]'],
        [/\(\s*명\s*\)/g, '(명사)'],
        [/\[\s*명\s*\]/g, '[명사]'],
        [/\(\s*동\s*\)/g, '(동사)'],
        [/\[\s*동\s*\]/g, '[동사]'],
        [/\(\s*부\s*\)/g, '(부사)'],
        [/\[\s*부\s*\]/g, '[부사]'],
        [/\(\s*대\s*\)/g, '(대명사)'],
        [/\[\s*대\s*\]/g, '[대명사]'],
        [/\(\s*전\s*\)/g, '(전치사)'],
        [/\[\s*전\s*\]/g, '[전치사]'],
        [/\(\s*접\s*\)/g, '(접속사)'],
        [/\[\s*접\s*\]/g, '[접속사]'],
        [/\(\s*감\s*\)/g, '(감탄사)'],
        [/\[\s*감\s*\]/g, '[감탄사]'],
        [/\(\s*(?:반|반의어)\s*\)/g, '(반대어)'],
        [/\[\s*(?:반|반의어)\s*\]/g, '[반대어]'],
        [/\(\s*파\s*\)/g, '(파생어)'],
        [/\[\s*파\s*\]/g, '[파생어]'],
        [/\(\s*(?:유|동의어)\s*\)/g, '(유의어)'],
        [/\[\s*(?:유|동의어)\s*\]/g, '[유의어]'],
        [/\(\s*관\s*\)/g, '(관련어)'],
        [/\[\s*관\s*\]/g, '[관련어]'],
        [/\(\s*(?:영|영영)\s*\)/g, '(영영풀이)'],
        [/\[\s*(?:영|영영)\s*\]/g, '[영영풀이]'],
        [/\(\s*숙\s*\)/g, '(숙어)'],
        [/\[\s*숙\s*\]/g, '[숙어]'],
    ];

    let result = text.trim();
    for (const [regex, replacement] of map) {
        result = result.replace(regex, replacement);
    }
    return result;
}

/**
 * 스펠링 테스트 문제 출제 시 [파]/[파생어] 줄을 숨기고, 뜻 안에 포함된 정답 영단어를 가림
 */
export function getSpellingPromptMeaning(meaning: string, targetWord?: string): string {
    const expanded = expandMeaningAbbreviations(meaning);
    const lines = expanded.split('\n');

    const filtered = lines.filter(
        (line) => !/^\s*[[(]\s*(?:파|파생어)\s*[\])]/.test(line.trim())
    );

    const baseLines = filtered.length > 0 ? filtered : lines;
    let result = baseLines.join('\n');

    if (targetWord && targetWord.trim().length >= 3) {
        const escaped = targetWord.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escaped, 'gi'), '_____');
    }
    return result;
}

/**
 * 예문 텍스트에서 한글 해석, A:/B: 기호, + 숙어 설명 줄을 제외하고 순수 영어 예문만 추출
 */
export function extractEnglishOnly(rawExample?: string): string {
    if (!rawExample) return '';
    const lines = rawExample
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !/^[+*•※]/.test(l))
        .map((line) => {
            let cleaned = line.replace(/^[A-Za-z]\s*:\s*/g, '');
            cleaned = cleaned.replace(/[ㄱ-ㅎㅏ-ㅣ가-힣]+/g, ' ');
            cleaned = cleaned.replace(/[~:]/g, ' ');
            cleaned = cleaned.replace(/\(\s*\)/g, ' ');
            cleaned = cleaned.replace(/\s+/g, ' ').trim();
            return cleaned;
        })
        .filter((line) => /[A-Za-z]{2,}/.test(line));

    return lines.join(' ');
}

export function formatFolderSegment(raw: string): string {
    let s = raw.trim();
    if (!s) return '';
    s = s.replace(/([A-Za-z가-힣])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z가-힣])/g, '$1 $2');
    s = s.replace(/\s+/g, ' ');
    s = s.replace(/[A-Za-z]+/g, (word) => {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
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

// [변경 후: 위 구간을 아래 코드로 교체]
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
        meaning: expandMeaningAbbreviations(meaning),
        example: example?.trim() || undefined,
        tag: normalizeCategory(tag),
        itemStats: createEmptyItemStats(),
        card: createEmptyCard(now),
        createdAt: now.getTime(),
    };
}

export function hydrateCard(raw?: Partial<Card>): Card {
    const base = createEmptyCard();
    if (!raw) return base;
    return {
        ...base,
        ...raw,
        due: raw.due ? new Date(raw.due) : new Date(),
        last_review: raw.last_review ? new Date(raw.last_review) : undefined,
    };
}

export function hydrateVocabItems(list: unknown[]): VocabItem[] {
    return list
        .filter((item): item is VocabItem => !!item && typeof item === 'object')
        .map((item) => ({
            ...item,
            phonetic: item.phonetic?.trim() || undefined,
            meaning: expandMeaningAbbreviations(item.meaning),
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
}

export function loadVocabItems(): VocabItem[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return hydrateVocabItems(parsed);
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
        const result: string[] = [];
        parsed.forEach((c) => {
            if (typeof c === 'string' && c.trim() && c.trim() !== '기본 학습장') {
                const norm = normalizeCategory(c);
                if (!result.includes(norm)) result.push(norm);
            }
        });
        return result;
    } catch {
        return [];
    }
}

export function saveCustomCategories(categories: string[]): void {
    const result: string[] = [];
    categories.forEach((c) => {
        if (c.trim() && c.trim() !== '기본 학습장') {
            const norm = normalizeCategory(c);
            if (!result.includes(norm)) result.push(norm);
        }
    });
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(result));
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

    return hydrateVocabItems(list);
}