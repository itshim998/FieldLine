/**
 * Common English stop words for construction and scheduling context.
 */
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'that',
  'the',
  'to',
  'was',
  'were',
  'will',
  'with'
]);

/**
 * Normalizes and tokenizes text into distinct lowercase words, removing stop words.
 */
export function tokenize(text: string, filterStopWords = true): string[] {
  if (!text) return [];
  const rawTokens = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 0);

  if (!filterStopWords) {
    return rawTokens;
  }

  const filtered = rawTokens.filter(t => !STOP_WORDS.has(t));
  return filtered.length > 0 ? filtered : rawTokens;
}

/**
 * Computes Jaccard similarity between two token arrays: |A ∩ B| / |A ∪ B|.
 */
export function jaccardSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 && tokensB.length === 0) return 1.0;
  if (tokensA.length === 0 || tokensB.length === 0) return 0.0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersection++;
    }
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Computes Overlap coefficient (Szymkiewicz-Simpson): |A ∩ B| / min(|A|, |B|).
 * Especially useful when a short reference matches part of a longer activity name.
 */
export function overlapCoefficient(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0.0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersection++;
    }
  }

  const minSize = Math.min(setA.size, setB.size);
  return minSize === 0 ? 0 : intersection / minSize;
}

/**
 * Computes the fraction of query tokens contained in target tokens.
 */
export function tokenContainmentScore(queryTokens: string[], targetTokens: string[]): number {
  if (queryTokens.length === 0) return 0.0;
  const targetSet = new Set(targetTokens);

  let matched = 0;
  for (const q of queryTokens) {
    if (targetSet.has(q)) {
      matched++;
    }
  }

  return matched / queryTokens.length;
}

/**
 * Levenshtein distance for fuzzy character matching on short strings/tokens.
 */
export function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[m][n];
}

/**
 * Normalized string similarity based on Levenshtein edit distance (0 to 1).
 */
export function editSimilarity(s1: string, s2: string): number {
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  const distance = levenshteinDistance(s1, s2);
  return Math.max(0, 1 - distance / maxLen);
}

/**
 * Computes comprehensive text similarity between two phrases.
 * Combines exact match, phrase containment, token containment, Jaccard, and overlap.
 */
export function computeTextSimilarity(source: string, target: string): number {
  const sNorm = source.trim().toLowerCase();
  const tNorm = target.trim().toLowerCase();

  if (!sNorm || !tNorm) return 0.0;
  if (sNorm === tNorm) return 1.0;

  // Substring containment
  const isSubstring = tNorm.includes(sNorm) || sNorm.includes(tNorm);
  const shorterLen = Math.min(sNorm.length, tNorm.length);
  const longerLen = Math.max(sNorm.length, tNorm.length);
  const lengthRatio = shorterLen / longerLen;

  const sTokens = tokenize(source);
  const tTokens = tokenize(target);

  if (sTokens.length === 0 || tTokens.length === 0) {
    return editSimilarity(sNorm, tNorm);
  }

  const jaccard = jaccardSimilarity(sTokens, tTokens);
  const overlap = overlapCoefficient(sTokens, tTokens);
  const containment = tokenContainmentScore(sTokens, tTokens);

  // If exact phrase is contained inside longer text
  if (isSubstring && lengthRatio > 0.3) {
    return Math.min(1.0, Math.max(0.85 * lengthRatio + 0.15, overlap * 0.9, containment * 0.9));
  }

  // Blended score: weighted combination of overlap, containment, and Jaccard
  const blended = 0.45 * overlap + 0.35 * containment + 0.20 * jaccard;
  return Math.min(1.0, Math.max(0.0, Math.round(blended * 1000) / 1000));
}
