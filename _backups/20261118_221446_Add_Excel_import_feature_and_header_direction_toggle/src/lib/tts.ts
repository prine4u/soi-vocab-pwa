export function speakEnglish(text: string, rate = 0.9) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    // 이전 발음이 재생 중이면 즉시 중단 후 새 발음 재생
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = rate; // 초등학생이 따라 읽기 좋은 약간 또박또박한 속도 (0.9)

    // iOS에서 사용 가능한 고품질 미국 영어 음성 우선 선택
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice =
        voices.find((v) => v.lang === 'en-US' && v.name.includes('Samantha')) ||
        voices.find((v) => v.lang === 'en-US');

    if (preferredVoice) {
        utterance.voice = preferredVoice;
    }

    window.speechSynthesis.speak(utterance);
}