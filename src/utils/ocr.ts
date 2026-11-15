import { formatFolderSegment } from './storage';

const GEMINI_KEY_STORAGE = 'soi_vocab_gemini_api_key_v1';
const PRIMARY_MODEL = 'gemini-4-hydrogen';
const FALLBACK_MODEL = 'gemini-3.8-flash';

const SYSTEM_INSTRUCTION = `당신은 완벽주의 영어 교재 및 단어장 데이터 추출 전문가입니다.
첨부된 1장의 단어장 페이지 이미지를 분석하여 페이지 메타데이터와 단어 목록을 JSON으로 반환하세요.

[1. 페이지 메타데이터 추출 규칙 — 유닛 분류 핵심!]
- pageNumber: 페이지 좌우 하단 모서리에 적힌 책 쪽수(예: 66, 67, 68)를 정수로 적으세요. 안 보이면 0으로 적으세요.
- bigUnitHeader: 페이지 맨 위에 "Unit 09", "Unit 10", "Unit 11", "Day 01"처럼 **새 단원이 시작되는 큰 제목 배너**가 적혀 있을 때만 그 단원명을 적으세요 (예: "Unit 11"). 만약 해당 페이지에 큰 단원 제목 없이 "Intermediate 09-21", "Basic 01-08", 또는 표만 이어지는 **연속 페이지**라면 절대 추측하지 말고 반드시 빈 문자열("")로 비워두세요!
- firstWordNumber: 이 페이지 본문 표의 맨 첫 번째 단어 왼쪽에 적힌 번호(예: "01"이면 1, "09"이면 9, "22"이면 22)를 정수로 적으세요.

[2. 단어·발음기호·다중 뜻·예문·한글번역 완벽 추출 규칙]
- word (표제어): 문제 번호(01, 02 등)를 제외한 정확한 영어 단어 또는 숙어를 추출하세요. (하단 Self Check 체크박스나 보충 단어 상자는 제외하고 본문 번호 단어만 모두 추출)
- phonetic (발음기호): 단어 아래나 옆에 적힌 발음기호를 대괄호 포함 그대로 추출하세요 (예: "[ə́ːrli]", "[freʃ]"). 사진에 없으면 표준 IPA 발음기호를 생성해 채우세요.
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

interface SinglePageResult {
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

async function callSinglePageGemini(
    modelName: string,
    image: { base64: string; mimeType: string },
    pageIndex: number,
    totalCount: number,
    apiKey: string,
    useThinkingConfig: boolean
): Promise<Response> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

    const generationConfig: Record<string, unknown> = {
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema: {
            type: 'OBJECT',
            properties: {
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
            required: ['pageNumber', 'bigUnitHeader', 'firstWordNumber', 'words'],
        },
    };

    if (useThinkingConfig) {
        generationConfig.thinkingConfig = { thinkingLevel: 'HIGH' };
    } else {
        generationConfig.temperature = 0.1;
    }

    const parts: Array<Record<string, unknown>> = [
        {
            text: `전체 ${totalCount}장 중 ${pageIndex}번째 단어장 페이지입니다. 상단 큰 단원 제목(bigUnitHeader), 첫 단어 번호(firstWordNumber), 하단 쪽수(pageNumber)와 본문 표의 모든 단어를 빠짐없이 추출하세요.`,
        },
        {
            inlineData: {
                mimeType: image.mimeType,
                data: image.base64,
            },
        },
    ];

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

async function analyzeSinglePage(
    image: { base64: string; mimeType: string },
    pageIndex: number,
    totalCount: number,
    apiKey: string
): Promise<SinglePageResult> {
    let response = await callSinglePageGemini(
        PRIMARY_MODEL,
        image,
        pageIndex,
        totalCount,
        apiKey,
        true
    );

    if (!response.ok && (response.status === 400 || response.status === 404)) {
        response = await callSinglePageGemini(
            FALLBACK_MODEL,
            image,
            pageIndex,
            totalCount,
            apiKey,
            false
        );
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const apiMessage = errorData?.error?.message || response.statusText;
        throw new Error(`Gemini API 오류 (${response.status}): ${apiMessage}`);
    }

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
        pageNumber?: number;
        bigUnitHeader?: string;
        firstWordNumber?: number;
        words?: Array<Record<string, unknown>>;
    };

    const rawWords = Array.isArray(parsed.words) ? parsed.words : [];
    const words = rawWords
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .map((item) => ({
            word: typeof item.word === 'string' ? item.word.trim() : '',
            phonetic: typeof item.phonetic === 'string' ? item.phonetic.trim() : '',
            meaning: typeof item.meaning === 'string' ? item.meaning.trim() : '',
            example: typeof item.example === 'string' ? item.example.trim() : '',
        }))
        .filter((item) => item.word.length > 0 && item.meaning.length > 0);

    return {
        pageIndex,
        pageNumber: Number(parsed.pageNumber) || 0,
        bigUnitHeader: typeof parsed.bigUnitHeader === 'string' ? parsed.bigUnitHeader : '',
        firstWordNumber: Number(parsed.firstWordNumber) || 0,
        words,
    };
}

export async function extractVocabFromImages(
    images: Array<{ base64: string; mimeType: string }>,
    apiKey: string
): Promise<RawExtractedItem[]> {
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
        throw new Error('Gemini API 키가 설정되지 않았습니다. API 키를 먼저 저장해 주세요.');
    }

    // 10장 이상도 토큰 잘림이나 유닛 누락이 없도록 각 페이지를 개별 정밀 분석
    const pages: SinglePageResult[] = [];
    for (let i = 0; i < images.length; i += 1) {
        const pageResult = await analyzeSinglePage(images[i], i + 1, images.length, cleanKey);
        pages.push(pageResult);
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
            // 1순위: 큰 단원 제목(Unit 09, Unit 10, Unit 11)이 감지되면 새 유닛으로 전환
            activeUnit = detectedHeader;
            hasSeenWordsInCurrentUnit = false;
        } else if (firstNum === 1 && hasSeenWordsInCurrentUnit) {
            // 2순위: 큰 제목이 사진에서 잘렸더라도 첫 단어 번호가 01번으로 리셋되면 다음 유닛으로 +1 전환
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