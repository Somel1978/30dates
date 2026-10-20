/**
 * Voice Q&A prompt bank (Stage 3, the Mid-Week Drop). Each member of a mutual pair picks 2–3
 * of these for the other to answer by voice. The bank is organised in three vectors that follow
 * how closeness actually develops:
 *
 *  - rhythm (Vector A): practical rhythm and domestic friction. Murstein's Stimulus–Value–Role
 *    model: compatibility in everyday roles is what decides whether a relationship lasts.
 *  - repair (Vector B): self-awareness, conflict and vulnerability. The Pratfall Effect: admitted,
 *    owned imperfection makes a competent person more likeable, not less.
 *  - joy (Vector C): everyday joy, curiosity and relational value. Aron's closeness paradigm:
 *    escalating, reciprocal self-disclosure builds closeness between strangers.
 */
export type PromptVector = 'rhythm' | 'repair' | 'joy';

export const PROMPT_VECTORS: readonly PromptVector[] = ['rhythm', 'repair', 'joy'];

export const PROMPT_VECTOR_LABELS: Record<PromptVector, { title: string; subtitle: string }> = {
  rhythm: { title: 'Daily rhythm', subtitle: 'How you actually live, day to day' },
  repair: { title: 'Inner world', subtitle: 'Conflict, repair and vulnerability' },
  joy: { title: 'Joy & curiosity', subtitle: 'What lights you up' },
};

export interface VoicePrompt {
  key: string;
  vector: PromptVector;
  text: string;
}

export const VOICE_PROMPTS: readonly VoicePrompt[] = [
  { key: 'rhythm_01', vector: 'rhythm', text: "What is one domestic chore or routine you refuse to compromise on, and what is one you gladly let slide?" },
  { key: 'rhythm_02', vector: 'rhythm', text: "How do you personally handle an unexpected schedule change that upends your entire weekend plan?" },
  { key: 'rhythm_03', vector: 'rhythm', text: "When life gets intensely stressful, what does your immediate decompression rhythm look like—isolation or company?" },
  { key: 'rhythm_04', vector: 'rhythm', text: "Describe your relationship with punctuality and how you experience waiting for someone (or being late)." },
  { key: 'rhythm_05', vector: 'rhythm', text: "How do you prefer to divide household cognitive load and invisible labor in a shared space?" },
  { key: 'rhythm_06', vector: 'rhythm', text: "What is your absolute non-negotiable requirement for physical quiet time or personal space in a shared home?" },
  { key: 'rhythm_07', vector: 'rhythm', text: "How do you typically approach financial planning and spending decisions for leisure versus savings?" },
  { key: 'rhythm_08', vector: 'rhythm', text: "What does a balanced, healthy distribution of weekday responsibilities look like to you?" },
  { key: 'rhythm_09', vector: 'rhythm', text: "How do you handle hosting guests or managing social energy when you are already fatigued from the workweek?" },
  { key: 'rhythm_10', vector: 'rhythm', text: "What is your preferred rhythm for grocery shopping, cooking, and eating meals during a normal work week?" },
  { key: 'rhythm_11', vector: 'rhythm', text: "How do you manage household temperature, lighting, and ambient noise levels in your living environment?" },
  { key: 'rhythm_12', vector: 'rhythm', text: "What is your routine around waking up, starting the morning, and transitioning into the flow of the day?" },
  { key: 'rhythm_13', vector: 'rhythm', text: "How do you approach keeping shared physical spaces organized versus maintaining creative or operational clutter?" },
  { key: 'rhythm_14', vector: 'rhythm', text: "What role do pets or animals play in your domestic environment and daily spatial boundaries?" },
  { key: 'rhythm_15', vector: 'rhythm', text: "How do you handle travel planning, packing styles, and airport navigation versus spontaneous road trips?" },
  { key: 'rhythm_16', vector: 'rhythm', text: "What is your approach to vehicle maintenance, driving habits, and spatial navigation when traveling?" },
  { key: 'rhythm_17', vector: 'rhythm', text: "How do you manage your digital life, notifications, email zero-inboxes, and screen boundaries in the evening?" },
  { key: 'rhythm_18', vector: 'rhythm', text: "What does a restorative weekend look like when you have zero social obligations or external pressures?" },
  { key: 'rhythm_19', vector: 'rhythm', text: "How do you balance eating at home with dining out or exploring local food culture during a typical month?" },
  { key: 'rhythm_20', vector: 'rhythm', text: "What is your stance on home improvement projects, DIY repairs, and hiring professional help around the house?" },
  { key: 'rhythm_21', vector: 'rhythm', text: "How do you handle seasonal transitions, wardrobe swaps, and maintaining your physical living spaces throughout the year?" },
  { key: 'rhythm_22', vector: 'rhythm', text: "What is your approach to health routines, fitness scheduling, and sleep hygiene across a standard week?" },
  { key: 'rhythm_23', vector: 'rhythm', text: "How do you navigate family obligations, holiday scheduling, and extended family geographic distributions?" },
  { key: 'rhythm_24', vector: 'rhythm', text: "What is your communication preference for logistical coordination—text updates, calendar invites, or sitting down to talk?" },
  { key: 'rhythm_25', vector: 'rhythm', text: "How do you balance long-term career demands with sustaining a peaceful, grounded home life?" },
  { key: 'rhythm_26', vector: 'rhythm', text: "What does your ideal neighborhood environment look like in terms of noise, density, and access to nature?" },
  { key: 'rhythm_27', vector: 'rhythm', text: "How do you approach personal boundaries regarding sharing items, spaces, and professional tools?" },
  { key: 'rhythm_28', vector: 'rhythm', text: "What is your rhythm for handling administrative tasks like taxes, bills, and household maintenance renewals?" },
  { key: 'rhythm_29', vector: 'rhythm', text: "How do you manage energy allocation when balancing multiple creative or intellectual passion projects?" },
  { key: 'rhythm_30', vector: 'rhythm', text: "What is your philosophy on rest, taking sick days, and allowing your body to slow down when fatigued?" },
  { key: 'repair_01', vector: 'repair', text: "What is a minor operational flaw of yours that you’ve learned to laugh at rather than desperately try to fix?" },
  { key: 'repair_02', vector: 'repair', text: "What is something you used to believe firmly in your 20s that you’ve completely unlearned in your 40s?" },
  { key: 'repair_03', vector: 'repair', text: "When you disagree with someone close to you, do you need to resolve it immediately, or do you require 24 hours of silence first?" },
  { key: 'repair_04', vector: 'repair', text: "What is a recurring blind spot in your communication style that people who know you well have pointed out?" },
  { key: 'repair_05', vector: 'repair', text: "How do you process receiving constructive feedback when you are already feeling emotionally tender?" },
  { key: 'repair_06', vector: 'repair', text: "What does taking accountability look like for you when you realize you've made a mistake in an argument?" },
  { key: 'repair_07', vector: 'repair', text: "What is an emotional trigger or boundary of yours that requires patience from the people in your life?" },
  { key: 'repair_08', vector: 'repair', text: "How do you differentiate between needing reassurance and needing space when you feel anxious?" },
  { key: 'repair_09', vector: 'repair', text: "What is the hardest lesson compromise has taught you over the years?" },
  { key: 'repair_10', vector: 'repair', text: "When apologies are exchanged, what actions or gestures make an apology feel genuinely complete to you?" },
  { key: 'repair_11', vector: 'repair', text: "How do you handle feelings of jealousy or insecurity when they occasionally surface in close connections?" },
  { key: 'repair_12', vector: 'repair', text: "What is a habit or defense mechanism you deploy when you feel emotionally overwhelmed or cornered?" },
  { key: 'repair_13', vector: 'repair', text: "How do you process feeling misunderstood, and what helps you recalibrate back to clarity?" },
  { key: 'repair_14', vector: 'repair', text: "What does patience look like for you when supporting someone through a prolonged personal crisis?" },
  { key: 'repair_15', vector: 'repair', text: "How do you balance standing your ground in your convictions with yielding to someone else's better perspective?" },
  { key: 'repair_16', vector: 'repair', text: "What is a past failure or mistake that taught you more about yourself than any success ever did?" },
  { key: 'repair_17', vector: 'repair', text: "How do you manage disappointment when expectations in a personal or professional setting fall short?" },
  { key: 'repair_18', vector: 'repair', text: "What is your relationship with asking for help when you are struggling to handle things independently?" },
  { key: 'repair_19', vector: 'repair', text: "How do you express anger or frustration in a way that remains constructive rather than destructive?" },
  { key: 'repair_20', vector: 'repair', text: "What does emotional safety mean to you in practical, daily interactions?" },
  { key: 'repair_21', vector: 'repair', text: "How do you handle transitions when shifting from a high-stress professional mindset to a personal relationship space?" },
  { key: 'repair_22', vector: 'repair', text: "What is a deeply ingrained personal standard you hold yourself to that you secretly wish you could relax?" },
  { key: 'repair_23', vector: 'repair', text: "How do you navigate letting go of control when circumstances require trusting someone else entirely?" },
  { key: 'repair_24', vector: 'repair', text: "What is your internal indicator that tells you you're burning out, and how do you communicate it?" },
  { key: 'repair_25', vector: 'repair', text: "How do you view vulnerability—as a steady practice, a calculated risk, or a last resort?" },
  { key: 'repair_26', vector: 'repair', text: "What helps you forgive yourself when you realize you've reacted out of character or exhaustion?" },
  { key: 'repair_27', vector: 'repair', text: "How do you handle power dynamics or asymmetrical emotional labor within interpersonal relationships?" },
  { key: 'repair_28', vector: 'repair', text: "What is your approach to holding space for someone else's grief or anger without trying to \"fix\" it?" },
  { key: 'repair_29', vector: 'repair', text: "How do you recognize the difference between healthy intuition and anxiety-driven assumptions?" },
  { key: 'repair_30', vector: 'repair', text: "What is a core boundary you've had to learn to set firmly to protect your peace of mind?" },
  { key: 'joy_01', vector: 'joy', text: "What is a small, specific sensory detail in your daily life that genuinely brings you quiet joy?" },
  { key: 'joy_02', vector: 'joy', text: "What is a skill, craft, or obscure topic you’ve spent an absurd amount of time learning just for your own amusement?" },
  { key: 'joy_03', vector: 'joy', text: "Describe your ideal slow Sunday morning from the moment you wake up to noon." },
  { key: 'joy_04', vector: 'joy', text: "What is a book, film, or album that fundamentally shifted how you look at human relationships?" },
  { key: 'joy_05', vector: 'joy', text: "If you had an unexpected free afternoon with zero obligations or screens, how would you spend it?" },
  { key: 'joy_06', vector: 'joy', text: "What is something you are deeply curious about right now that you haven't yet explored fully?" },
  { key: 'joy_07', vector: 'joy', text: "What kind of humor or comedic timing makes you laugh instantly without fail?" },
  { key: 'joy_08', vector: 'joy', text: "What is a cherished memory or tradition from your past that you try to keep alive in your present life?" },
  { key: 'joy_09', vector: 'joy', text: "When do you feel most like your authentic, unedited self in a room of people?" },
  { key: 'joy_10', vector: 'joy', text: "What is a simple, everyday act of kindness or consideration that instantly makes you feel seen and valued?" },
  { key: 'joy_11', vector: 'joy', text: "What is a place in nature or an architectural environment that instantly resets your nervous system?" },
  { key: 'joy_12', vector: 'joy', text: "What is the most memorable meal or culinary experience you've ever had, and why did it stick with you?" },
  { key: 'joy_13', vector: 'joy', text: "If you could master any musical instrument or artistic medium overnight, what would you choose?" },
  { key: 'joy_14', vector: 'joy', text: "What is a documentary, podcast episode, or long-form essay that completely captured your imagination recently?" },
  { key: 'joy_15', vector: 'joy', text: "What is a tradition or ritual you enjoy creating when welcoming friends or family into your space?" },
  { key: 'joy_16', vector: 'joy', text: "What kind of stories, genres, or narrative formats do you find yourself returning to again and again?" },
  { key: 'joy_17', vector: 'joy', text: "What is a physical activity or movement practice that makes you feel most alive in your body?" },
  { key: 'joy_18', vector: 'joy', text: "What is a piece of advice or perspective shared with you years ago that still guides your decisions today?" },
  { key: 'joy_19', vector: 'joy', text: "How do you celebrate small personal milestones or quiet victories in your life?" },
  { key: 'joy_20', vector: 'joy', text: "What is an aesthetic, texture, or design element that you are naturally drawn to in your physical surroundings?" },
  { key: 'joy_21', vector: 'joy', text: "What is a fascinating historical period or scientific concept you love falling down rabbit holes about?" },
  { key: 'joy_22', vector: 'joy', text: "What is a simple pleasure you refuse to outgrow, no matter how old you get?" },
  { key: 'joy_23', vector: 'joy', text: "How do you cultivate a sense of playfulness and levity in an otherwise serious adult life?" },
  { key: 'joy_24', vector: 'joy', text: "What is a collaborative project or shared adventure you've always wanted to tackle with a partner?" },
  { key: 'joy_25', vector: 'joy', text: "What is a quality in other people that instantly disarms you and makes you want to know them better?" },
  { key: 'joy_26', vector: 'joy', text: "What is a city, landscape, or culture you've visited that changed your internal map of the world?" },
  { key: 'joy_27', vector: 'joy', text: "What is a soundscape or ambient background audio environment that helps you focus or relax?" },
  { key: 'joy_28', vector: 'joy', text: "What is a question you wish people asked you more often instead of standard small talk?" },
  { key: 'joy_29', vector: 'joy', text: "What does a truly generous listening presence look like and feel like to you?" },
  { key: 'joy_30', vector: 'joy', text: "What is a quiet, unassuming moment from this past week that you wish you could bottle up and keep?" },
];

export const VOICE_PROMPT_BY_KEY: ReadonlyMap<string, VoicePrompt> = new Map(VOICE_PROMPTS.map((p) => [p.key, p]));

export const MIN_PROMPTS_PER_PICK = 2;
export const MAX_PROMPTS_PER_PICK = 3;
/** Longest single voice answer, enforced by the recorder; the server caps file size. */
export const MAX_ANSWER_SECONDS = 90;
export const MAX_ANSWER_BYTES = 4 * 1024 * 1024;
