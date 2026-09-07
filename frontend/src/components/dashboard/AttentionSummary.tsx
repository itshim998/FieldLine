import React from 'react';
import {
  AlertTriangle,
  AlertCircle,
  Clock,
  ShieldCheck,
  ChevronRight,
  HelpCircle,
  Sparkles,
  CheckCircle2,
  Calendar
} from 'lucide-react';

export interface DelayedFact {
  activityId: string;
  externalId: string;
  name: string;
  plannedFinish: string;
  actualProgress: number;
  progressVariance: number;
  reasons?: Array<{ code: string; message: string }>;
}

export interface AtRiskFact {
  activityId: string;
  externalId: string;
  name: string;
  plannedFinish: string;
  actualProgress: number;
  progressVariance: number;
  reasons?: Array<{ code: string; message: string }>;
}

export interface StaleFact {
  activityId: string;
  externalId: string;
  name: string;
  latestUpdateDate: string | null;
  daysSinceUpdate: number | null;
  hasAnyUpdate: boolean;
}

export interface UnresolvedMatchFact {
  matchId: string;
  progressUpdateId: string;
  activityId: string;
  activityExternalId: string;
  activityName: string;
  reportDate: string;
  reporterName: string | null;
  confidenceScore: number;
  confidenceTier: string | null;
  reviewState: string | null;
  rationale: string | null;
}

export interface BlockerFact {
  id: string;
  activityId: string | null;
  activityExternalId: string | null;
  activityName: string;
  category: string;
  description: string;
  reporterName: string;
  createdAt: string;
}

export interface AttentionSummaryProps {
  delayedCount: number;
  delayed: DelayedFact[];
  atRiskCount: number;
  atRisk: AtRiskFact[];
  staleCount: number;
  stale: StaleFact[];
  unresolvedMatchesCount: number;
  unresolvedMatches: UnresolvedMatchFact[];
  activeBlockersCount?: number;
  activeBlockers?: BlockerFact[];
  blockersByRootCause?: Record<string, number>;
  onResolveBlocker?: (blockerId: string) => void;
  onNavigateToIntelligence?: () => void;
  onNavigateToProgressReview?: (updateId?: string) => void;
  onNavigateToActivities?: (activityId?: string) => void;
}

export function AttentionSummary({
  delayedCount,
  delayed,
  atRiskCount,
  atRisk,
  staleCount,
  stale,
  unresolvedMatchesCount,
  unresolvedMatches,
  activeBlockersCount,
  activeBlockers,
  blockersByRootCause,
  onResolveBlocker,
  onNavigateToIntelligence,
  onNavigateToProgressReview,
  onNavigateToActivities
}: AttentionSummaryProps): React.JSX.Element {
  const blockersCount = activeBlockersCount ?? (activeBlockers?.length ?? 0);
  const totalAttentionItems =
    delayedCount + atRiskCount + staleCount + unresolvedMatchesCount + blockersCount;

  return (
    <div className="attention-summary-card">
      <div className="attention-header">
        <div className="attention-title-group">
          <AlertCircle size={18} color="var(--accent-amber)" />
          <h3 className="section-title">Items Requiring Attention</h3>
        </div>
        <span
          className={`attention-total-badge ${totalAttentionItems > 0 ? 'warning' : 'success'}`}
        >
          {totalAttentionItems === 0
            ? '✓ All Healthy'
            : `${totalAttentionItems} Action ${totalAttentionItems === 1 ? 'Item' : 'Items'}`}
        </span>
      </div>

      {totalAttentionItems === 0 ? (
        <div className="attention-empty-state">
          <div className="empty-state-icon-circle success">
            <CheckCircle2 size={24} color="var(--accent-emerald)" />
          </div>
          <h4 className="attention-empty-title">Zero Operational Blockers</h4>
          <p className="attention-empty-desc">
            No activities are delayed, at risk, or stale, and all AI matches have been confirmed into canonical truth.
          </p>
        </div>
      ) : (
        <div className="attention-sections-list">
          {/* 0. Active Operational Blockers (Pass 33) */}
          {blockersCount > 0 && (
            <div className="attention-block blockers" data-testid="attention-blockers-section">
              <div className="attention-block-header">
                <div className="attention-block-title-group">
                  <AlertTriangle size={15} color="#f59e0b" />
                  <span className="attention-block-title">
                    Active Operational Blockers ({blockersCount})
                  </span>
                </div>
                {blockersByRootCause && (
                  <div className="blocker-root-cause-tags">
                    {Object.entries(blockersByRootCause)
                      .filter(([_, count]) => count > 0)
                      .map(([cat, count]) => (
                        <span key={cat} className="root-cause-pill" data-testid={`root-cause-${cat}`}>
                          {cat}: <strong>{count}</strong>
                        </span>
                      ))}
                  </div>
                )}
              </div>

              <div className="attention-items-sublist">
                {(activeBlockers || []).slice(0, 4).map((b) => (
                  <div key={b.id} className="attention-row-card blocker-row" data-testid={`blocker-item-${b.id}`}>
                    <div className="attention-row-main">
                      <div className="attention-pill-group">
                        <span className="code-pill amber">{b.category.toUpperCase()}</span>
                        {b.activityExternalId && (
                          <span className="code-pill blue">{b.activityExternalId}</span>
                        )}
                        <span className="attention-reporter-sub">By {b.reporterName}</span>
                      </div>
                      <div className="attention-row-name">{b.description}</div>
                      {b.activityName && b.activityName !== 'General Site' && (
                        <div className="attention-row-subtext">Target: {b.activityName}</div>
                      )}
                    </div>
                    {onResolveBlocker && (
                      <button
                        type="button"
                        data-testid={`resolve-blocker-btn-${b.id}`}
                        className="btn btn-outline btn-xs resolve-blocker-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onResolveBlocker(b.id);
                        }}
                        title="Mark blocker as resolved"
                      >
                        <CheckCircle2 size={12} color="var(--accent-emerald)" />
                        <span>Resolve</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 1. Unresolved AI Matches (Section 15 Review Uncertainty) */}
          {unresolvedMatchesCount > 0 && (
            <div className="attention-block unresolved">
              <div className="attention-block-header">
                <div className="attention-block-title-group">
                  <HelpCircle size={15} color="#c084fc" />
                  <span className="attention-block-title">
                    Unresolved Match Reviews ({unresolvedMatchesCount})
                  </span>
                </div>
                <button
                  type="button"
                  className="attention-action-link purple"
                  onClick={() => onNavigateToProgressReview && onNavigateToProgressReview()}
                >
                  <span>Open Review Queue</span>
                  <ChevronRight size={13} />
                </button>
              </div>

              <div className="attention-items-sublist">
                {unresolvedMatches.slice(0, 3).map((item) => (
                  <div
                    key={item.matchId}
                    className="attention-row-card unresolved-match-row"
                    onClick={() =>
                      onNavigateToProgressReview && onNavigateToProgressReview(item.progressUpdateId)
                    }
                  >
                    <div className="attention-row-main">
                      <div className="attention-pill-group">
                        <span className="code-pill purple">{item.activityExternalId}</span>
                        <span className="attention-tier-badge">
                          {(item.confidenceTier || 'LOW').toUpperCase()} &bull; {Math.round(item.confidenceScore * 100)}%
                        </span>
                      </div>
                      <div className="attention-row-name">{item.activityName}</div>
                      {item.rationale && (
                        <div className="attention-row-subtext">{item.rationale}</div>
                      )}
                    </div>
                    <div className="attention-row-action">
                      <span className="btn-review-mini">Review</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 2. Delayed Activities */}
          {delayedCount > 0 && (
            <div className="attention-block delayed">
              <div className="attention-block-header">
                <div className="attention-block-title-group">
                  <AlertTriangle size={15} color="var(--accent-rose)" />
                  <span className="attention-block-title">
                    Delayed Activities ({delayedCount})
                  </span>
                </div>
                <button
                  type="button"
                  className="attention-action-link rose"
                  onClick={() => onNavigateToIntelligence && onNavigateToIntelligence()}
                >
                  <span>View Details</span>
                  <ChevronRight size={13} />
                </button>
              </div>

              <div className="attention-items-sublist">
                {delayed.slice(0, 3).map((item) => (
                  <div
                    key={item.activityId}
                    className="attention-row-card delayed-row"
                    onClick={() => onNavigateToActivities && onNavigateToActivities(item.activityId)}
                  >
                    <div className="attention-row-main">
                      <div className="attention-pill-group">
                        <span className="code-pill rose">{item.externalId}</span>
                        <span className="attention-date-tag">
                          Finish: {item.plannedFinish}
                        </span>
                      </div>
                      <div className="attention-row-name">{item.name}</div>
                      <div className="attention-variance-warning">
                        {item.actualProgress}% actual ({item.progressVariance > 0 ? `+${item.progressVariance}` : item.progressVariance} pts)
                      </div>
                    </div>
                    <ChevronRight size={14} color="var(--text-muted)" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. At Risk Activities */}
          {atRiskCount > 0 && (
            <div className="attention-block at-risk">
              <div className="attention-block-header">
                <div className="attention-block-title-group">
                  <AlertTriangle size={15} color="var(--accent-amber)" />
                  <span className="attention-block-title">
                    At-Risk Activities ({atRiskCount})
                  </span>
                </div>
                <button
                  type="button"
                  className="attention-action-link amber"
                  onClick={() => onNavigateToIntelligence && onNavigateToIntelligence()}
                >
                  <span>Inspect Risk</span>
                  <ChevronRight size={13} />
                </button>
              </div>

              <div className="attention-items-sublist">
                {atRisk.slice(0, 3).map((item) => (
                  <div
                    key={item.activityId}
                    className="attention-row-card at-risk-row"
                    onClick={() => onNavigateToActivities && onNavigateToActivities(item.activityId)}
                  >
                    <div className="attention-row-main">
                      <div className="attention-pill-group">
                        <span className="code-pill amber">{item.externalId}</span>
                        <span className="attention-variance-warning" style={{ color: 'var(--accent-amber)' }}>
                          {item.progressVariance} pts variance
                        </span>
                      </div>
                      <div className="attention-row-name">{item.name}</div>
                      {item.reasons && item.reasons[0] && (
                        <div className="attention-row-subtext">{item.reasons[0].message}</div>
                      )}
                    </div>
                    <ChevronRight size={14} color="var(--text-muted)" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4. Stale Activities */}
          {staleCount > 0 && (
            <div className="attention-block stale">
              <div className="attention-block-header">
                <div className="attention-block-title-group">
                  <Clock size={15} color="var(--accent-indigo)" />
                  <span className="attention-block-title">
                    Stale Field Updates ({staleCount})
                  </span>
                </div>
                <button
                  type="button"
                  className="attention-action-link indigo"
                  onClick={() => onNavigateToIntelligence && onNavigateToIntelligence()}
                >
                  <span>View Stale Feed</span>
                  <ChevronRight size={13} />
                </button>
              </div>

              <div className="attention-items-sublist">
                {stale.slice(0, 2).map((item) => (
                  <div
                    key={item.activityId}
                    className="attention-row-card stale-row"
                    onClick={() => onNavigateToActivities && onNavigateToActivities(item.activityId)}
                  >
                    <div className="attention-row-main">
                      <div className="attention-pill-group">
                        <span className="code-pill indigo">{item.externalId}</span>
                        <span className="stale-days-badge">
                          {item.hasAnyUpdate
                            ? `${item.daysSinceUpdate}d without report`
                            : 'Never reported'}
                        </span>
                      </div>
                      <div className="attention-row-name">{item.name}</div>
                    </div>
                    <ChevronRight size={14} color="var(--text-muted)" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
