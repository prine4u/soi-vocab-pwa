const GEMINI_KEY_STORAGE = 'soi_vocab_gemini_api_key_v1';

// 1순위: Gemini 4 Hydrogen (고정밀 멀티모달 추론) / 2순위 폴백: Gemini 3.8 Flash
const PRIMARY_MODEL = 'gemini-4-hydrogen';
const FALLBACK_MODEL = 'gemini-3.8-flash';

const SYSTEM_INSTRUCTION = `당신은 완벽주의 영어 교육 데이터 검수 전문가입니다.
첨부된 교과서, 프린트, 노트 이미지에서 학습할 영어 단어와 숙어를 빠짐없이 추출하세요.

[무수정 완성을 위한 엄격 규칙]
1. OCR 오탈자 자동 보정: 사진이 흐리거나 손글씨여서 철자가 애매한 경우, 문맥과 실제 영어 사전을 기준으로 100% 정확한 철자로 교정하세요.
2. 표제어 정규화: 동사의 과거형/분사형이나 명사의 복수형으로 적혀 있더라도 원형(예: studied -> study, apples -> apple)으로 통일해 추출하세요. (단, 숙어나 관용구는 원형 유지)
3. 한국어 뜻 정제: 뜻이 여러 개 적혀 있으면 핵심 뜻 1~3개를 품사 표기와 함께 쉼표(,)로 깔끔하게 정리하세요. (예: v. 분석하다, n. 분석)
4. 예문 누락 방지: 이미지에 예문이 함께 찍혀 있으면 그 예문을 정확히 추출하고, 단어와 뜻만 있는 프린트라면 해당 단어의 의미에 맞는 자연스러운 영어 예문 1문장을 직접 작성해 채우세요. (빈 문자열 금지)
5. 중복 제거: 같은 페이지에 동일 단어가 여러 번 나오면 하나의 항목으로 통합하세요.
6. 잡음 제외: 페이지 번호, 날짜, 이름, 출판사 로고, 단순 문제 번호 등 학습 단어가 아닌 텍스트는 제외하세요.`;

/**
 * 브라우저 localStorage에서 저장된 Gemini API 키를 불러옵니다.
 */
export function loadGeminiApiKey(): string {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(GEMINI_KEY_STORAGE) || '';
}

/**
 * 브라우저 localStorage에 Gemini API 키를 저장하거나(빈 값일 경우 삭제) 업데이트합니다.
 */
export function saveGeminiApiKey(key: string): void {
    if (typeof window === 'undefined') return;
    const trimmed = key.trim();
    if (trimmed) {
        window.localStorage.setItem(GEMINI_KEY_STORAGE, trimmed);
    } else {
        window.localStorage.removeItem(GEMINI_KEY_STORAGE);
    }
}

/**
 * 아이폰 카메라 등의 고해상도 원본 이미지를 최대 2048px 고화질 JPEG로 변환하여
 * 작은 인쇄 글씨와 손글씨 디테일을 보존합니다.
 */
export async function resizeImageToBase64(
    file: File,
    maxDimension: number = 2048
): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
    // App.tsx에서 1280 등 낮은 값을 넘기더라도 OCR 정확도를 위해 최소 2048px 해상도를 보장합니다.
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

        // 투명 PNG 등이 JPEG로 변환될 때 검은 배경이 되지 않도록 흰색 배경 채우기
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
    word: string;
    meaning: string;
    example?: string;
}

async function callGeminiVisionModel(
    modelName: string,
    base64: string,
    mimeType: string,
    apiKey: string,
    useThinkingConfig: boolean
): Promise<Response> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

    const generationConfig: Record<string, unknown> = {
        responseMimeType: 'application/json',
        responseSchema: {
            type: 'ARRAY',
            description: '이미지에서 추출 및 철자 교정이 완료된 영어 단어 목록',
            items: {
                type: 'OBJECT',
                properties: {
                    word: {
                        type: 'STRING',
                        description: '오탈자가 교정된 정확한 영어 단어 또는 숙어 (표제어 원형 기준)',
                    },
                    meaning: {
                        type: 'STRING',
                        description: '한국어 뜻 (품사 표기 포함, 예: v. 분석하다, n. 분석)',
                    },
                    example: {
                        type: 'STRING',
                        description:
                            '이미지 속 예문. 이미지에 예문이 없으면 해당 단어와 뜻에 맞는 자연스러운 영어 예문 1문장 생성',
                    },
                },
                required: ['word', 'meaning', 'example'],
            },
        },
    };

    if (useThinkingConfig) {
        generationConfig.thinkingConfig = {
            thinkingLevel: 'HIGH',
        };
    } else {
        generationConfig.temperature = 0.1;
    }

    const requestBody = {
        systemInstruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }],
        },
        contents: [
            {
                role: 'user',
                parts: [
                    {
                        text: '이 이미지에서 영어 단어와 숙어를 추출하고, 철자·뜻·예문을 검수하여 지정된 JSON 스키마로 반환해주세요.',
                    },
                    {
                        inlineData: {
                            mimeType,
                            data: base64,
                        },
                    },
                ],
            },
        ],
        generationConfig,
    };

    return fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(requestBody),
    });
}

/**
 * Gemini 4 Hydrogen 모델을 우선 호출하여 고정밀 OCR 및 단어 검수를 수행합니다.
 */
export async function extractVocabFromImage(
    base64: string,
    mimeType: string,
    apiKey: string
): Promise<RawExtractedItem[]> {
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
        throw new Error('Gemini API 키가 설정되지 않았습니다. API 키를 먼저 저장해 주세요.');
    }

    // 1차 시도: Gemini 4 Hydrogen + HIGH Thinking
    let response = await callGeminiVisionModel(
        PRIMARY_MODEL,
        base64,
        mimeType,
        cleanKey,
        true
    );

    // 만약 API 키 티어나 모델 권한 문제로 400/404 발생 시 Gemini 3.8 Flash로 자동 폴백
    if (!response.ok && (response.status === 400 || response.status === 404)) {
        response = await callGeminiVisionModel(
            FALLBACK_MODEL,
            base64,
            mimeType,
            cleanKey,
            false
        );
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const apiMessage = errorData?.error?.message || response.statusText;

        if (response.status === 400) {
            throw new Error(`잘못된 요청입니다 (${apiMessage})`);
        }
        if (response.status === 401 || response.status === 403) {
            throw new Error('API 키가 유효하지 않거나 권한이 없습니다. 키를 다시 확인해 주세요.');
        }
        if (response.status === 429) {
            throw new Error('API 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.');
        }
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

    let parsed: unknown;
    try {
        parsed = JSON.parse(cleanedJson);
    } catch {
        throw new Error('모델 응답을 JSON으로 파싱하는 데 실패했습니다.');
    }

    if (!Array.isArray(parsed)) {
        throw new Error('예상된 단어 배열 형식이 반환되지 않았습니다.');
    }

    return parsed
        .filter(
            (item): item is Record<string, unknown> =>
                typeof item === 'object' && item !== null
        )
        .map((item) => ({
            word: typeof item.word === 'string' ? item.word.trim() : '',
            meaning: typeof item.meaning === 'string' ? item.meaning.trim() : '',
            example: typeof item.example === 'string' ? item.example.trim() : '',
        }))
        .filter((item) => item.word.length > 0 && item.meaning.length > 0);
}