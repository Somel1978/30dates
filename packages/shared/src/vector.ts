import {
  FAMILY_GOALS,
  FINANCIAL_RHYTHMS,
  LIVING_ARCHITECTURES,
  MOBILITY_PROFILES,
  type LifeArchitectureGates,
} from './domain.js';
import { INTEREST_BY_KEY, TRAITS } from './interests.js';

/**
 * Deterministic 32-float psychometric vector:
 *   [0..2]   family_goal one-hot
 *   [3..5]   living_architecture one-hot
 *   [6..8]   mobility one-hot
 *   [9..11]  financial_rhythm one-hot
 *   [12..31] 20 lifestyle trait axes summed from behavioral interests
 * Each block is weighted, then the whole vector is L2-normalised so cosine distance
 * in pgvector is well-conditioned. No model, no randomness: same input → same vector.
 */
export const VECTOR_DIMENSIONS = 32;
export const VECTOR_VERSION = 1;

const GATE_DIM_WEIGHT = 0.35;
const TRAIT_BLOCK_WEIGHT = 1;
const TRAIT_OFFSET = 12;

export function buildPsychometricVector(gates: LifeArchitectureGates, interestKeys: readonly string[]): number[] {
  const v = new Array<number>(VECTOR_DIMENSIONS).fill(0);

  v[FAMILY_GOALS.indexOf(gates.family_goal)] = GATE_DIM_WEIGHT;
  v[3 + LIVING_ARCHITECTURES.indexOf(gates.living_architecture)] = GATE_DIM_WEIGHT;
  v[6 + MOBILITY_PROFILES.indexOf(gates.mobility)] = GATE_DIM_WEIGHT;
  v[9 + FINANCIAL_RHYTHMS.indexOf(gates.financial_rhythm)] = GATE_DIM_WEIGHT;

  const traits = new Array<number>(TRAITS.length).fill(0);
  for (const key of interestKeys) {
    const def = INTEREST_BY_KEY.get(key);
    if (!def) throw new Error(`unknown_interest:${key}`);
    TRAITS.forEach((trait, i) => {
      traits[i]! += def.traits[trait] ?? 0;
    });
  }
  const traitNorm = Math.hypot(...traits);
  if (traitNorm > 0) {
    traits.forEach((t, i) => {
      v[TRAIT_OFFSET + i] = (t / traitNorm) * TRAIT_BLOCK_WEIGHT;
    });
  }

  const norm = Math.hypot(...v);
  return v.map((x) => Number((x / norm).toFixed(6)));
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** pgvector text literal, e.g. "[0.1,0.2,...]". */
export function toPgVector(v: readonly number[]): string {
  return `[${v.join(',')}]`;
}
