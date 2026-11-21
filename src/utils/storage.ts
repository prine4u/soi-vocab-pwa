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
 * 텍스트에서 첫 번째 문장 또는 단어만 추출 (문장 부호 . ? ! 또는 줄바꿈 기준)
 */
export function getFirstSentence(text?: string): string {
    if (!text) return '';
    const trimmed = text.trim();
    if (!trimmed) return '';

    // 첫 번째 줄만 분리
    const firstLine = trimmed.split(/[\r\n]+/)[0]?.trim() || '';
    if (!firstLine) return '';

    // 마침표(.), 물음표(?), 느낌표(!) 기준으로 첫 번째 문장만 추출
    const match = firstLine.match(/^([^.!?]+[.!?]?)/);
    if (match && match[1]?.trim()) {
        return match[1].trim();
    }
    return firstLine;
}

/**
 * TTS 음성 읽기를 위해 한글 뜻에서 대괄호 품사 태그, 기호 등을 정돈
 */
export function cleanKoreanForTts(text?: string): string {
    if (!text) return '';
    return text
        .replace(/\[[^\]]*\]/g, ' ')   // [명사], [동사] 등 품사 태그 제거
        .replace(/[()]/g, ' ')         // 괄호 기호만 제거하고 안의 설명어는 유지 (예: (액체를) 붓다 -> 액체를 붓다)
        .replace(/[0-9]+\.\s*/g, ' ')  // 1. 2. 번호 기호 제거
        .replace(/[~•※*+]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
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

const IRREGULAR_VERBS: Record<string, string[]> = {
    be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'],
    see: ['saw', 'seen', 'seeing', 'sees'],
    go: ['went', 'gone', 'going', 'goes'],
    do: ['did', 'done', 'doing', 'does'],
    have: ['has', 'had', 'having'],
    take: ['took', 'taken', 'taking', 'takes'],
    make: ['made', 'making', 'makes'],
    get: ['got', 'gotten', 'getting', 'gets'],
    give: ['gave', 'given', 'giving', 'gives'],
    find: ['found', 'finding', 'finds'],
    think: ['thought', 'thinking', 'thinks'],
    tell: ['told', 'telling', 'tells'],
    say: ['said', 'saying', 'says'],
    buy: ['bought', 'buying', 'buys'],
    come: ['came', 'coming', 'comes'],
    run: ['ran', 'running', 'runs'],
    know: ['knew', 'known', 'knowing', 'knows'],
    write: ['wrote', 'written', 'writing', 'writes'],
    speak: ['spoke', 'spoken', 'speaking', 'speaks'],
    drive: ['drove', 'driven', 'driving', 'drives'],
    eat: ['ate', 'eaten', 'eating', 'eats'],
    drink: ['drank', 'drunk', 'drinking', 'drinks'],
    sing: ['sang', 'sung', 'singing', 'sings'],
    break: ['broke', 'broken', 'breaking', 'breaks'],
    meet: ['met', 'meeting', 'meets'],
    send: ['sent', 'sending', 'sends'],
    leave: ['left', 'leaving', 'leaves'],
    keep: ['kept', 'keeping', 'keeps'],
    feel: ['felt', 'feeling', 'feels'],
    bring: ['brought', 'bringing', 'brings'],
    build: ['built', 'building', 'builds'],
    catch: ['caught', 'catching', 'catches'],
    choose: ['chose', 'chosen', 'choosing', 'chooses'],
    draw: ['drew', 'drawn', 'drawing', 'draws'],
    fall: ['fell', 'fallen', 'falling', 'falls'],
    fly: ['flew', 'flown', 'flying', 'flies'],
    grow: ['grew', 'grown', 'growing', 'grows'],
    hear: ['heard', 'hearing', 'hears'],
    hide: ['hid', 'hidden', 'hiding', 'hides'],
    hold: ['held', 'holding', 'holds'],
    lose: ['lost', 'losing', 'loses'],
    pay: ['paid', 'paying', 'pays'],
    read: ['read', 'reading', 'reads'],
    ride: ['rode', 'ridden', 'riding', 'rides'],
    ring: ['rang', 'rung', 'ringing', 'rings'],
    rise: ['rose', 'risen', 'rising', 'rises'],
    sell: ['sold', 'selling', 'sells'],
    sit: ['sat', 'sitting', 'sits'],
    sleep: ['slept', 'sleeping', 'sleeps'],
    spend: ['spent', 'spending', 'spends'],
    stand: ['stood', 'standing', 'stands'],
    swim: ['swam', 'swum', 'swimming', 'swims'],
    teach: ['taught', 'teaching', 'teaches'],
    throw: ['threw', 'thrown', 'throwing', 'throws'],
    understand: ['understood', 'understanding', 'understands'],
    wear: ['wore', 'worn', 'wearing', 'wears'],
    win: ['won', 'winning', 'wins'],
};

export interface ClozeData {
    hasExample: boolean;
    clozeSentence: string;
    fullSentence: string;
    targetWord: string;
    matchedWord: string;
    koreanTranslation: string;
    prefix: string;
    suffix: string;
}

/**
 * 예문에서 핵심 단어를 찾아 [ _____ ] 빈칸으로 뚫고 문맥 정보와 번역을 추출하는 Anki Cloze 생성기
 */
export function generateClozeData(
    word: string,
    meaning: string,
    rawExample?: string
): ClozeData {
    const cleanWord = word.trim().replace(/\s*\([^)]*\)/g, '').trim();
    const cleanMeaning = expandMeaningAbbreviations(meaning);

    if (!rawExample || !rawExample.trim()) {
        return {
            hasExample: false,
            clozeSentence: '[ _____ ]',
            fullSentence: cleanWord,
            targetWord: cleanWord,
            matchedWord: cleanWord,
            koreanTranslation: cleanMeaning,
            prefix: '',
            suffix: '',
        };
    }

    const rawLines = rawExample
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !/^[+*•※]/.test(l));

    const escapeRegex = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const wordLower = cleanWord.toLowerCase();
    const searchVariants = new Set<string>();
    searchVariants.add(escapeRegex(cleanWord));

    if (IRREGULAR_VERBS[wordLower]) {
        IRREGULAR_VERBS[wordLower].forEach((v) => searchVariants.add(escapeRegex(v)));
    }

    const baseStem = cleanWord.endsWith('e')
        ? cleanWord.slice(0, -1)
        : cleanWord.endsWith('y')
        ? cleanWord.slice(0, -1)
        : cleanWord;
    searchVariants.add(`${escapeRegex(cleanWord)}(?:s|es|d|ed|ing|ly)?`);
    if (baseStem !== cleanWord) {
        searchVariants.add(`${escapeRegex(baseStem)}(?:e|es|ed|ing|ied|ies|y)?`);
    }

    const patternString = `\\b(${Array.from(searchVariants).join('|')})\\b`;
    const regex = new RegExp(patternString, 'i');

    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        const koreanCharCount = (line.match(/[ㄱ-ㅎㅏ-ㅣ가-힣]/g) || []).length;
        const englishCharCount = (line.match(/[a-zA-Z]/g) || []).length;

        if (englishCharCount >= 3) {
            const cleanedEng = line.replace(/^[A-Za-z]\s*:\s*/g, '').trim();
            const match = cleanedEng.match(regex);

            if (match && typeof match.index === 'number') {
                const matchedWord = match[0];
                const prefix = cleanedEng.slice(0, match.index);
                const suffix = cleanedEng.slice(match.index + matchedWord.length);

                let translation = '';
                if (i + 1 < rawLines.length) {
                    const nextLine = rawLines[i + 1].trim();
                    if (/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(nextLine)) {
                        translation = nextLine.replace(/^[A-Za-z]\s*:\s*/g, '').trim();
                    }
                }
                if (!translation && koreanCharCount > 0) {
                    translation = line.replace(/[a-zA-Z0-9.,?!'"~:;-]/g, ' ').replace(/\s+/g, ' ').trim();
                }
                if (!translation) {
                    translation = cleanMeaning;
                }

                return {
                    hasExample: true,
                    clozeSentence: `${prefix}[ _____ ]${suffix}`,
                    fullSentence: cleanedEng,
                    targetWord: cleanWord,
                    matchedWord,
                    koreanTranslation: translation,
                    prefix,
                    suffix,
                };
            }
        }
    }

    // 예문에서 직접 일치하는 단어를 못 찾은 경우 첫 번째 영어 문장과 한글 번역 사용
    const firstEngLine = rawLines.find((l) => /[a-zA-Z]{3,}/.test(l)) || rawLines[0];
    const firstKoLine = rawLines.find((l) => /[ㄱ-ㅎㅏ-ㅣ가-힣]{2,}/.test(l)) || cleanMeaning;

    return {
        hasExample: true,
        clozeSentence: `[ _____ ] : ${firstEngLine}`,
        fullSentence: `${cleanWord} : ${firstEngLine}`,
        targetWord: cleanWord,
        matchedWord: cleanWord,
        koreanTranslation: firstKoLine,
        prefix: '',
        suffix: ` : ${firstEngLine}`,
    };
}

export function formatFolderSegment(raw: string): string {
    let s = raw.trim();
    if (!s) return '';
    // 영문과 숫자 사이 띄어쓰기 정규화 (예: Unit1 -> Unit 1, Lesson2 -> Lesson 2)
    s = s.replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2');
    s = s.replace(/\s+/g, ' ');
    // 영문 단어 첫 글자 대문자화
    s = s.replace(/[A-Za-z]+/g, (word) => {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
    // 영문 유닛 넘버링 2자리 정규화 (Unit 1 -> Unit 01)
    s = s.replace(
        /\b(Unit|Day|Part|Chapter|Lesson)\s+(\d)\b/gi,
        (_, prefix: string, digit: string) =>
            `${prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase()} 0${digit}`
    );
    // 한글 레슨/유닛/단원 넘버링 정규화 (레슨1 -> 레슨 01, 유닛01 -> 유닛 01)
    s = s.replace(
        /(레슨|유닛|단원|파트|챕터)\s*(\d)\b/g,
        (_, prefix: string, digit: string) => `${prefix} 0${digit}`
    );
    s = s.replace(
        /(레슨|유닛|단원|파트|챕터)\s*(\d{2,})\b/g,
        (_, prefix: string, digit: string) => `${prefix} ${digit}`
    );
    // 제1강 / 제01강 정규화 (제 1 강 -> 제01강)
    s = s.replace(/제\s*(\d)\s*강/g, '제0$1강');
    s = s.replace(/제\s*(\d{2,})\s*강/g, '제$1강');
    // 1강 -> 1강, 01강 -> 01강 (공백 정리)
    s = s.replace(/(\d+)\s*강/g, '$1강');
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

// [변경 후: 위 구간을 아래 코드로 교체]
export function hydrateVocabItems(list: unknown[]): VocabItem[] {
    return list
        .filter((item): item is VocabItem => !!item && typeof item === 'object')
        .map((item) => ({
            ...item,
            phonetic: item.phonetic?.trim() || undefined,
            meaning: expandMeaningAbbreviations(item.meaning),
            tag: normalizeCategory(item.tag),
            starred: Boolean(item.starred),
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