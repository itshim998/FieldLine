import { Activity } from '../../models/domain.types.js';

/**
 * Architectural seam for semantic / embedding-based activity matching.
 * Kept strictly decoupled from core deterministic scoring.
 */
export interface SemanticActivityMatcher {
  score(reference: string, activity: Activity): Promise<number>;
}

/**
 * Default local/deterministic semantic matcher implementation.
 * Returns 0.0 without external vector database or embedding dependencies.
 */
export class DefaultSemanticMatcher implements SemanticActivityMatcher {
  async score(_reference: string, _activity: Activity): Promise<number> {
    // Isolated architectural placeholder. Future passes can plug in local or remote embeddings.
    return 0.0;
  }
}

export const defaultSemanticMatcher: SemanticActivityMatcher = new DefaultSemanticMatcher();
