import { createEmptyCard } from 'ts-fsrs';
import type { VocabItem, StudyStats, CloudSyncState } from '../types';
import { normalizeCategory, hydrateVocabItems } from './storage';

const NAS_WEBHOOK_STORAGE_KEY = 'soi_vocab_nas_webhook_url_v1';
const SYNCED_IDS_KEY = 'soi_vocab_synced_n8n_ids_v1';
const DEFAULT_NAS_WEBHOOK_URL = 'https://prine4u.myds.me:8443/webhook/soi-vocab-inbox';

export interface NasVocabRow {
    id: string;
    word: string;
    phonetic?: string | null;
    meaning: string;
    example?: string | null;
    tag: string;
    created_at?: number;
}

export function loadNasWebhookUrl(): string {
    const envUrl = import.meta.env.VITE_NAS_WEBHOOK_URL as string | undefined;
    return (
        localStorage.getItem(NAS_WEBHOOK_STORAGE_KEY) ||
        envUrl ||
        DEFAULT_NAS_WEBHOOK_URL
    );
}

export function saveNasWebhookUrl(url: string): void {
    const trimmed = url.trim();
    if (trimmed) {
        localStorage.setItem(NAS_WEBHOOK_STORAGE_KEY, trimmed);
    } else {
        localStorage.removeItem(NAS_WEBHOOK_STORAGE_KEY);
    }
}

function getDbWebhookUrl(inboxWebhookUrl?: string): string {
    const base = (inboxWebhookUrl ?? loadNasWebhookUrl()).trim();
    if (!base) return '';
    return base.replace(/\/soi-vocab-inbox(\?.*)?$/, '/soi-vocab-db');
}

export function resetNasSyncHistory(): void {
    localStorage.removeItem(SYNCED_IDS_KEY);
}

export async function clearNasRemoteDb(customWebhookUrl?: string): Promise<void> {
    const webhookUrl = (customWebhookUrl ?? loadNasWebhookUrl()).trim();
    if (!webhookUrl) return;
    const separator = webhookUrl.includes('?') ? '&' : '?';
    await fetch(`${webhookUrl}${separator}clear=1`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
    });
    resetNasSyncHistory();
}

/**
 * 현재 기기(PC/아이폰/안드로이드)의 단어장·폴더순서·학습진도를 NAS 서버에 업로드
 * mode: 'no-cors'를 사용하여 n8n CORS 헤더 설정 없이도 브라우저 차단 없이 즉시 전송
 */
export async function pushStateToNas(
    state: CloudSyncState,
    customWebhookUrl?: string
): Promise<void> {
    const dbUrl = getDbWebhookUrl(customWebhookUrl);
    if (!dbUrl) return;

    try {
        await fetch(dbUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
                'Content-Type': 'text/plain;charset=UTF-8',
            },
            body: JSON.stringify({
                action: 'sync_push',
                updatedAt: state.updatedAt,
                items: state.items,
                categories: state.categories,
                stats: state.stats,
            }),
        });
    } catch {
        // 업로드 실패 시에도 앱 학습 흐름이 중단되지 않도록 무시
    }
}

function loadSyncedIds(): Set<string> {
    try {
        const raw = localStorage.getItem(SYNCED_IDS_KEY);
        if (!raw) return new Set<string>();
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? new Set<string>(parsed) : new Set<string>();
    } catch {
        return new Set<string>();
    }
}

function saveSyncedIds(ids: Set<string>): void {
    localStorage.setItem(SYNCED_IDS_KEY, JSON.stringify(Array.from(ids)));
}

export async function fetchNewNasVocab(
    existingItems: VocabItem[],
    customWebhookUrl?: string,
    forceResync: boolean = false
): Promise<{
    newItems: VocabItem[];
    newCategories: string[];
    remoteCloudState: CloudSyncState | null;
}> {
    const webhookUrl = (customWebhookUrl ?? loadNasWebhookUrl()).trim();
    if (!webhookUrl) {
        return { newItems: [], newCategories: [], remoteCloudState: null };
    }

    if (forceResync) {
        resetNasSyncHistory();
    }

    const response = await fetch(webhookUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
        throw new Error(`NAS n8n 서버 응답 오류 (${response.status})`);
    }

    const data = (await response.json()) as unknown;
    const rows: NasVocabRow[] = Array.isArray(data)
        ? (data as NasVocabRow[])
        : data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)
            ? ((data as { items: NasVocabRow[] }).items)
            : [];

    let remoteCloudState: CloudSyncState | null = null;
    if (
        data &&
        typeof data === 'object' &&
        (data as { cloudState?: unknown }).cloudState &&
        typeof (data as { cloudState?: unknown }).cloudState === 'object'
    ) {
        const rawCloud = (data as {
            cloudState: {
                updatedAt?: number;
                items?: unknown[];
                categories?: unknown[];
                stats?: StudyStats | null;
            };
        }).cloudState;

        if (Array.isArray(rawCloud.items) && (rawCloud.updatedAt || 0) > 0) {
            remoteCloudState = {
                updatedAt: Number(rawCloud.updatedAt) || 0,
                items: hydrateVocabItems(rawCloud.items),
                categories: Array.isArray(rawCloud.categories)
                    ? rawCloud.categories
                        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
                        .map((c) => normalizeCategory(c))
                    : [],
                stats: rawCloud.stats || null,
            };
        }
    }

    const syncedIds = loadSyncedIds();
    const basePool =
        remoteCloudState && remoteCloudState.items.length > existingItems.length
            ? remoteCloudState.items
            : existingItems;

    const existingKeys = new Set(
        basePool.map(
            (item) => `${normalizeCategory(item.tag).toLowerCase()}::${item.word.toLowerCase()}`
        )
    );

    const newItems: VocabItem[] = [];
    const newCategorySet = new Set<string>();
    const now = new Date();

    rows.forEach((row, idx) => {
        if (!row || typeof row !== 'object' || !row.word || !row.meaning) return;
        const rowId = row.id || `nas-${row.word}-${row.tag || ''}`;
        if (!forceResync && syncedIds.has(rowId)) return;
        syncedIds.add(rowId);

        const tag = normalizeCategory(row.tag);
        const dedupeKey = `${tag.toLowerCase()}::${row.word.trim().toLowerCase()}`;
        if (existingKeys.has(dedupeKey)) return;

        existingKeys.add(dedupeKey);
        newCategorySet.add(tag);

        newItems.push({
            id: rowId,
            word: row.word.trim(),
            phonetic: row.phonetic?.trim() || undefined,
            meaning: row.meaning.trim(),
            example: row.example?.trim() || undefined,
            tag,
            card: createEmptyCard(new Date(now.getTime() + idx)),
            createdAt: row.created_at || now.getTime() + idx,
        });
    });

    saveSyncedIds(syncedIds);
    return {
        newItems,
        newCategories: Array.from(newCategorySet),
        remoteCloudState,
    };
}