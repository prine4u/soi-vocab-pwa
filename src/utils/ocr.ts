import { formatFolderSegment } from './storage';

const GEMINI_KEY_STORAGE = 'soi_vocab_gemini_api_key_v1';
const PRIMARY_MODEL = 'gemini-4-hydrogen';
const FALLBACK_MODEL = 'gemini-3.8-flash';

const SYSTEM_INSTRUCTION = `당신은 완벽주의 영어 교재 및 단어장 데이터 추출 전문가입니다.
첨부된 단어장 이미지들을 **첨부된 사진 순서 그대로(1번 페이지부터 순서대로)** 분석하여 pages 배열로 반환하세요.

[1. 페이지별 큰 단원 제목(bigUnitHeader) 판별 규칙 — 가장 중요!]
- 각 이미지 상단에 "Unit 09", "Unit 10", "Unit 11", "Day 01"처럼 **새 단원이 시작되는 큰 제목 배너**가 적혀 있을 때만 bigUnitHeader에 그 단원명을 적으세요 (예: "Unit 09").
- 만약 해당 페이지에 큰 단원 제목 없이 "Intermediate 09-21", "Basic 01-08", 또는 페이지 번호("67", "68")만 적혀 있는 **이어지는 페이지(연속 페이지)**라면, 절대 단원명을 추측해서 적지 말고 bigUnitHeader를 반드시 빈 문자열("")로 비워두세요!

[2. 단어·발음기호·다중 뜻·예문·한글번역 완벽 추출 규칙]
- word (표제어): 문제 번호(01, 02 등)를 제외한 정확한 영어 단어 또는 숙어를 추출하세요. (하단 Self Check 체크박스 등 중복 항목은 제외)
- phonetic (발음기호): 단어 아래나 옆에 적힌 발음기호를 대괄호 포함 그대로 추출하세요 (예: "[ə́ːrli]", "[freʃ]"). 사진에 발음기호가 없으면 표준 IPA 발음기호를 생성해 채우세요.
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

function extractCleanUnitHeader(rawHeader?: string): string {
    if (!rawHeader) return '';
    const match = String(rawHeader).match(/\b(unit|day|part|chapter|lesson)\s*(\d+)\b/i);
    if (match) {
        return formatFolderSegment(`${match[1]} ${match[2]}`);
    }
    return '';
}

async function callGeminiVisionModel(
    modelName: string,
    images: Array<{ base64: string; mimeType: string }>,
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
                            bigUnitHeader: { type: 'STRING' },
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
                        required: ['pageIndex', 'bigUnitHeader', 'words'],
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
            text: `총 ${images.length}장의 연속된 단어장 페이지입니다. 사진 1번부터 ${images.length}번까지 순서대로 pages 배열에 담아 반환하세요. 큰 단원 제목(Unit XX 등)이 있는 페이지만 bigUnitHeader를 적고, 이어지는 페이지는 빈 문자열("")로 비워두세요.`,
        },
    ];

    images.forEach((img, idx) => {
        parts.push({ text: `[사진 ${idx + 1}번 페이지]` });
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

export async function extractVocabFromImages(
    images: Array<{ base64: string; mimeType: string }>,
    apiKey: string
): Promise<RawExtractedItem[]> {
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
        throw new Error('Gemini API 키가 설정되지 않았습니다. API 키를 먼저 저장해 주세요.');
    }

    let response = await callGeminiVisionModel(PRIMARY_MODEL, images, cleanKey, true);
    if (!response.ok && (response.status === 400 || response.status === 404)) {
        response = await callGeminiVisionModel(FALLBACK_MODEL, images, cleanKey, false);
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

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
        throw new Error('모델로부터 유효한 응답 텍스트를 받지 못했습니다.');
    }

    const cleanedJson = rawText
        .replace(/^```json\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

    const parsed = JSON.parse(cleanedJson) as {
        pages?: Array<{
            pageIndex?: number;
            bigUnitHeader?: string;
            words?: Array<Record<string, unknown>>;
        }>;
    };

    const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
    pages.sort((a, b) => (a.pageIndex || 0) - (b.pageIndex || 0));

    // 첫 번째 큰 제목 찾기
    let activeUnit = 'Unit 01';
    const firstWithHeader = pages.find((p) => extractCleanUnitHeader(p.bigUnitHeader));
    if (firstWithHeader) {
        activeUnit = extractCleanUnitHeader(firstWithHeader.bigUnitHeader);
    }

    const results: RawExtractedItem[] = [];

    for (const page of pages) {
        const header = extractCleanUnitHeader(page.bigUnitHeader);
        if (header) {
            // 새로운 큰 제목 페이지가 나타나면 그 페이지부터 새 유닛 적용
            activeUnit = header;
        }

        const words = Array.isArray(page.words) ? page.words : [];
        for (const item of words) {
            if (!item || typeof item !== 'object') continue;
            const word = typeof item.word === 'string' ? item.word.trim() : '';
            const meaning = typeof item.meaning === 'string' ? item.meaning.trim() : '';
            if (!word || !meaning) continue;

            results.push({
                unit: activeUnit,
                word,
                phonetic: typeof item.phonetic === 'string' ? item.phonetic.trim() : '',
                meaning,
                example: typeof item.example === 'string' ? item.example.trim() : '',
            });
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