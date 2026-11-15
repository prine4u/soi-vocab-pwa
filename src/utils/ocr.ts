import { formatFolderSegment } from './storage';

const GEMINI_KEY_STORAGE = 'soi_vocab_gemini_api_key_v1';
const PRIMARY_MODEL = 'gemini-4-hydrogen';
const FALLBACK_MODEL = 'gemini-3.8-flash';

const SYSTEM_INSTRUCTION = `당신은 완벽주의 영어 교재 및 단어장 데이터 추출 전문가입니다.
첨부된 단어장 페이지 이미지들을 순서대로 분석하여 pages 배열로 반환하세요.

[1. 페이지 메타데이터 추출 규칙 — 유닛 분류 핵심!]
- pageNumber: 각 페이지 좌우 하단 모서리에 적힌 책 쪽수(예: 66, 67, 68)를 정수로 적으세요. 안 보이면 0으로 적으세요.
- bigUnitHeader: 페이지 맨 위에 "Unit 09", "Unit 10", "Unit 11", "Day 01"처럼 **새 단원이 시작되는 큰 제목 배너**가 적혀 있을 때만 그 단원명을 적으세요 (예: "Unit 11"). 큰 단원 제목 없이 "Intermediate 09-21"이나 표만 이어지는 연속 페이지라면 반드시 빈 문자열("")로 비워두세요!
- firstWordNumber: 각 페이지 본문 표의 맨 첫 번째 단어 왼쪽에 적힌 번호(예: "01"이면 1, "09"이면 9, "22"이면 22)를 정수로 적으세요.

[2. 단어·발음기호·다중 뜻·예문·한글번역 완벽 추출 규칙]
- word (표제어): 문제 번호(01, 02 등)를 제외한 정확한 영어 단어 또는 숙어를 추출하세요. (하단 Self Check 체크박스나 보충 단어 상자는 제외)
- phonetic (발음기호): 단어 아래나 옆에 적힌 발음기호를 대괄호 포함 그대로 추출하세요 (예: "[ə́ːrli]", "[freʃ]"). 없으면 표준 IPA 발음기호를 생성하세요.
- meaning (다중 품사·뜻·반의어·파생어·영영풀이 전체):
  사진 가운데 칸에 적힌 모든 품사와 뜻, 반의어([반]), 유의어([유]), 파생어([파]), 영영풀이([영영])를 자르지 말고 줄바꿈(\\n)으로 구분해 모두 적으세요.
- example (모든 예문 + 한글 번역):
  오른쪽 칸에 예문이 2개 이상이거나 대화문(A/B)이면 모든 예문을 빠짐없이 추출하고, 각 영어 예문 바로 아랫줄에 한글 번역을 함께 적으세요.`;

export function loadGeminiApiKey(): string {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(GEMINI_KEY_STORAGE) || '';
}

export function saveGeminiApiKey(key: string): void {
    if (typeof window === 'undefined') return;
    const trimmed = key.trim();
    if (trimmed) {
        window.localStorage.setItem(GEMINI_KEY_STORAGE, trimmed);
    } else {
        window.localStorage.removeItem(GEMINI_KEY_STORAGE);
    }
}

export async function resizeImageToBase64(
    file: File,
    maxDimension: number = 2048
): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
    const targetMaxDim = Math.max(maxDimension, 2048);
    const objectUrl = URL.createObjectURL(file);

    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('이미지를 불러오는 데 실패했습니다.'));
            image.src = objectUrl;
        });

        let { naturalWidth: width, naturalHeight: height } = img;

        if (width > targetMaxDim || height > targetMaxDim) {
            if (width >= height) {
                height = Math.round((height * targetMaxDim) / width);
                width = targetMaxDim;
            } else {
                width = Math.round((width * targetMaxDim) / height);
                height = targetMaxDim;
            }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('브라우저 캔버스 컨텍스트를 초기화할 수 없습니다.');
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.88);
        const base64 = compressedDataUrl.split(',')[1];

        if (!base64) {
            throw new Error('이미지 Base64 인코딩에 실패했습니다.');
        }

        return {
            base64,
            mimeType: 'image/jpeg',
            previewUrl: compressedDataUrl,
        };
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

export interface RawExtractedItem {
    unit?: string;
    word: string;
    phonetic?: string;
    meaning: string;
    example?: string;
}

interface PageAnalysisResult {
    pageIndex: number;
    pageNumber: number;
    bigUnitHeader: string;
    firstWordNumber: number;
    words: Array<{
        word: string;
        phonetic: string;
        meaning: string;
        example: string;
    }>;
}

function extractCleanUnitHeader(rawHeader?: string): string {
    if (!rawHeader) return '';
    const match = String(rawHeader).match(/\b(unit|day|part|chapter|lesson)\s*(\d+)\b/i);
    if (match) {
        return formatFolderSegment(`${match[1]} ${match[2]}`);
    }
    return '';
}

function incrementUnitName(unitStr: string): string {
    const match = String(unitStr).match(/^(.*?\b(?:Unit|Day|Part|Chapter|Lesson)\s+)(\d+)$/i);
    if (match) {
        const nextNum = parseInt(match[2], 10) + 1;
        const padded = nextNum < 10 ? `0${nextNum}` : `${nextNum}`;
        return `${match[1]}${padded}`;
    }
    return unitStr;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function callChunkGemini(
    modelName: string,
    chunk: Array<{ base64: string; mimeType: string }>,
    startPageIndex: number,
    apiKey: string,
    useThinkingConfig: boolean
): Promise<Response> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

    const generationConfig: Record<string, unknown> = {
        maxOutputTokens: 16384,
        responseMimeType: 'application/json',
        responseSchema: {
            type: 'OBJECT',
            properties: {
                pages: {
                    type: 'ARRAY',
                    items: {
                        type: 'OBJECT',
                        properties: {
                            pageIndex: { type: 'INTEGER' },
                            pageNumber: { type: 'INTEGER' },
                            bigUnitHeader: { type: 'STRING' },
                            firstWordNumber: { type: 'INTEGER' },
                            words: {
                                type: 'ARRAY',
                                items: {
                                    type: 'OBJECT',
                                    properties: {
                                        word: { type: 'STRING' },
                                        phonetic: { type: 'STRING' },
                                        meaning: { type: 'STRING' },
                                        example: { type: 'STRING' },
                                    },
                                    required: ['word', 'phonetic', 'meaning', 'example'],
                                },
                            },
                        },
                        required: ['pageIndex', 'pageNumber', 'bigUnitHeader', 'firstWordNumber', 'words'],
                    },
                },
            },
            required: ['pages'],
        },
    };

    if (useThinkingConfig) {
        generationConfig.thinkingConfig = { thinkingLevel: 'HIGH' };
    } else {
        generationConfig.temperature = 0.1;
    }

    const parts: Array<Record<string, unknown>> = [
        {
            text: `총 ${chunk.length}장의 단어장 페이지입니다. 각 페이지의 큰 단원 제목(bigUnitHeader), 첫 단어 번호(firstWordNumber), 하단 쪽수(pageNumber)와 모든 단어를 빠짐없이 pages 배열로 반환하세요.`,
        },
    ];

    chunk.forEach((img, idx) => {
        parts.push({ text: `[페이지 순서 번호(pageIndex): ${startPageIndex + idx}]` });
        parts.push({
            inlineData: {
                mimeType: img.mimeType,
                data: img.base64,
            },
        });
    });

    return fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
            contents: [{ role: 'user', parts }],
            generationConfig,
        }),
    });
}

async function analyzeChunkWithRetry(
    chunk: Array<{ base64: string; mimeType: string }>,
    startPageIndex: number,
    apiKey: string
): Promise<PageAnalysisResult[]> {
    let lastError = '알 수 없는 오류';

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        let response = await callChunkGemini(
            PRIMARY_MODEL,
            chunk,
            startPageIndex,
            apiKey,
            true
        );

        // 404/400 이거나 무료 분당 횟수 제한(429) 도달 시 보조 모델(gemini-3.8-flash)로 즉시 전환 시도
        if (
            !response.ok &&
            (response.status === 400 || response.status === 404 || response.status === 429)
        ) {
            response = await callChunkGemini(
                FALLBACK_MODEL,
                chunk,
                startPageIndex,
                apiKey,
                false
            );
        }

        if (response.ok) {
            const data = (await response.json()) as {
                candidates?: Array<{
                    content?: {
                        parts?: Array<{ text?: string }>;
                    };
                }>;
            };

            const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
            const cleanedJson = rawText
                .replace(/^```json\s*/i, '')
                .replace(/```\s*$/i, '')
                .trim();

            const parsed = JSON.parse(cleanedJson) as {
                pages?: Array<{
                    pageIndex?: number;
                    pageNumber?: number;
                    bigUnitHeader?: string;
                    firstWordNumber?: number;
                    words?: Array<Record<string, unknown>>;
                }>;
            };

            const chunkPages = Array.isArray(parsed.pages) ? parsed.pages : [];
            return chunkPages.map((p, idx) => {
                const rawWords = Array.isArray(p.words) ? p.words : [];
                const words = rawWords
                    .filter(
                        (item): item is Record<string, unknown> =>
                            typeof item === 'object' && item !== null
                    )
                    .map((item) => ({
                        word: typeof item.word === 'string' ? item.word.trim() : '',
                        phonetic: typeof item.phonetic === 'string' ? item.phonetic.trim() : '',
                        meaning: typeof item.meaning === 'string' ? item.meaning.trim() : '',
                        example: typeof item.example === 'string' ? item.example.trim() : '',
                    }))
                    .filter((item) => item.word.length > 0 && item.meaning.length > 0);

                return {
                    pageIndex: Number(p.pageIndex) || startPageIndex + idx,
                    pageNumber: Number(p.pageNumber) || 0,
                    bigUnitHeader: typeof p.bigUnitHeader === 'string' ? p.bigUnitHeader : '',
                    firstWordNumber: Number(p.firstWordNumber) || 0,
                    words,
                };
            });
        }

        const errorData = await response.json().catch(() => null);
        lastError = errorData?.error?.message || response.statusText;

        // 429 Quota Exceeded 발생 시 10초 대기 후 재시도
        if (response.status === 429 && attempt < 3) {
            await delay(10000);
            continue;
        }
        break;
    }

    throw new Error(`Gemini API 오류: ${lastError}`);
}

export async function extractVocabFromImages(
    images: Array<{ base64: string; mimeType: string }>,
    apiKey: string
): Promise<RawExtractedItem[]> {
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
        throw new Error('Gemini API 키가 설정되지 않았습니다. API 키를 먼저 저장해 주세요.');
    }

    // 분당 5회 제한(5 RPM)을 피하기 위해 3장씩 묶어서 처리
    const CHUNK_SIZE = 3;
    const pages: PageAnalysisResult[] = [];

    for (let i = 0; i < images.length; i += CHUNK_SIZE) {
        if (i > 0) {
            // 연속 청크 호출 시 3.5초 간격 두기
            await delay(3500);
        }
        const chunk = images.slice(i, i + CHUNK_SIZE);
        const chunkResults = await analyzeChunkWithRetry(chunk, i + 1, cleanKey);
        pages.push(...chunkResults);
    }

    // 하단 쪽수(pageNumber)가 인식된 경우 교재 쪽수 순으로 정렬, 없으면 업로드 순서 유지
    pages.sort((a, b) => {
        if (a.pageNumber > 0 && b.pageNumber > 0 && a.pageNumber !== b.pageNumber) {
            return a.pageNumber - b.pageNumber;
        }
        return a.pageIndex - b.pageIndex;
    });

    let activeUnit = 'Unit 01';
    const firstWithHeader = pages.find((p) => extractCleanUnitHeader(p.bigUnitHeader));
    if (firstWithHeader) {
        activeUnit = extractCleanUnitHeader(firstWithHeader.bigUnitHeader);
    }

    const results: RawExtractedItem[] = [];
    let hasSeenWordsInCurrentUnit = false;

    for (const page of pages) {
        const detectedHeader = extractCleanUnitHeader(page.bigUnitHeader);
        const firstNum = page.firstWordNumber;

        if (detectedHeader && (firstNum <= 1 || !hasSeenWordsInCurrentUnit)) {
            activeUnit = detectedHeader;
            hasSeenWordsInCurrentUnit = false;
        } else if (firstNum === 1 && hasSeenWordsInCurrentUnit) {
            activeUnit = detectedHeader || incrementUnitName(activeUnit);
            hasSeenWordsInCurrentUnit = false;
        }

        for (const item of page.words) {
            results.push({
                unit: activeUnit,
                word: item.word,
                phonetic: item.phonetic,
                meaning: item.meaning,
                example: item.example,
            });
            hasSeenWordsInCurrentUnit = true;
        }
    }

    return results;
}

export async function extractVocabFromImage(
    base64: string,
    mimeType: string,
    apiKey: string
): Promise<RawExtractedItem[]> {
    return extractVocabFromImages([{ base64, mimeType }], apiKey);
}