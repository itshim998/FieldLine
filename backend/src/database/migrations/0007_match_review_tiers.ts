import { Database as DatabaseType } from 'better-sqlite3';

export const name = '0007_match_review_tiers';

function tableExists(db: DatabaseType, tableName: string): boolean {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
  return row !== undefined;
}

function columnExists(db: DatabaseType, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((col) => col.name === columnName);
}

/**
 * Migration 0007: Adds confidence_tier and review_state columns to activity_matches
 * to support Pass 19 deterministic confidence tiers and human review workflow.
 */
export function up(db: DatabaseType): void {
  if (tableExists(db, 'activity_matches')) {
    if (!columnExists(db, 'activity_matches', 'confidence_tier')) {
      db.exec(`
        ALTER TABLE activity_matches ADD COLUMN confidence_tier TEXT CHECK (confidence_tier IS NULL OR confidence_tier IN ('high', 'medium', 'low'));
      `);
    }

    if (!columnExists(db, 'activity_matches', 'review_state')) {
      db.exec(`
        ALTER TABLE activity_matches ADD COLUMN review_state TEXT CHECK (review_state IS NULL OR review_state IN ('unresolved', 'awaiting_review', 'resolved'));
      `);
    }

    // Create index on review_state for efficient queue queries
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_activity_matches_review_state 
        ON activity_matches(project_id, review_state);
      CREATE INDEX IF NOT EXISTS idx_activity_matches_confidence_tier 
        ON activity_matches(project_id, confidence_tier);
    `);

    // Backfill legacy rows if any exist with NULL tiers/states
    db.exec(`
      UPDATE activity_matches
      SET 
        confidence_tier = CASE 
          WHEN confidence_tier IS NOT NULL THEN confidence_tier
          WHEN confidence_score >= 0.90 THEN 'high'
          WHEN confidence_score >= 0.60 THEN 'medium'
          ELSE 'low'
        END,
        review_state = CASE
          WHEN review_state IS NOT NULL THEN review_state
          WHEN status IN ('confirmed', 'rejected') THEN 'resolved'
          WHEN confidence_score < 0.60 THEN 'unresolved'
          ELSE 'awaiting_review'
        END
      WHERE confidence_tier IS NULL OR review_state IS NULL;
    `);
  }
}
