import { createEmptyCard } from 'ts-fsrs';
import type { VocabItem } from '../types';
import { normalizeCategory } from './storage';

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
): Promise<{ newItems: VocabItem[]; newCategories: string[] }> {
    const webhookUrl = (customWebhookUrl ?? loadNasWebhookUrl()).trim();
    if (!webhookUrl) {
        return { newItems: [], newCategories: [] };
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

    const syncedIds = loadSyncedIds();
    const existingKeys = new Set(
        existingItems.map(
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
    };
}