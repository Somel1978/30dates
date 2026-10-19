/**
 * Voice Q&A prompt bank (Stage 3). Each member of a mutual pair picks 2–3 of these for the other
 * to answer by voice. Prompts invite reciprocal, gradually deepening self-disclosure about
 * everyday rhythm, repair and values rather than résumé facts, so the exchange reveals how
 * someone thinks and sounds before anyone sees a face.
 */
export interface VoicePrompt {
  key: string;
  text: string;
}

export const VOICE_PROMPTS: readonly VoicePrompt[] = [
  { key: 'ordinary_sunday', text: 'Walk me through an ordinary Sunday you’d happily repeat.' },
  { key: 'recharge', text: 'How do you recharge after a draining week?' },
  { key: 'reliably_laugh', text: 'What reliably makes you laugh?' },
  { key: 'home_feel', text: 'What makes a place feel like home to you?' },
  { key: 'quietly_proud', text: 'Tell me about something you’re quietly proud of that wouldn’t show up on a CV.' },
  { key: 'changed_mind', text: 'What’s something you’ve changed your mind about in the last few years?' },
  { key: 'looked_after', text: 'What’s a small thing someone did that made you feel genuinely looked after?' },
  { key: 'after_disagreement', text: 'After a disagreement with someone close, what do you usually do first?' },
  { key: 'good_apology', text: 'What does a good apology sound like to you?' },
  { key: 'stubborn_about', text: 'What would your oldest friend say you’re stubborn about?' },
  { key: 'learned_late', text: 'What did you learn about relationships later than you’d have liked?' },
  { key: 'spend_never', text: 'What will you always spend money on, and what never?' },
  { key: 'scared_a_little', text: 'What’s the last thing you did that scared you a little?' },
  { key: 'more_of', text: 'What do you want more of in the next five years?' },
];

export const VOICE_PROMPT_BY_KEY: ReadonlyMap<string, VoicePrompt> = new Map(VOICE_PROMPTS.map((p) => [p.key, p]));

export const MIN_PROMPTS_PER_PICK = 2;
export const MAX_PROMPTS_PER_PICK = 3;
/** Longest single voice answer, enforced by the recorder; the server caps file size. */
export const MAX_ANSWER_SECONDS = 90;
export const MAX_ANSWER_BYTES = 4 * 1024 * 1024;
