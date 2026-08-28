import React from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  User,
  Clock,
  Check,
  HelpCircle
} from 'lucide-react';
import { ActivityDetailMatch } from '../../services/activity-detail/activity-detail.types.js';

export interface ActivityReviewContextProps {
  matches: ActivityDetailMatch[];
}

export function ActivityReviewContext({
  matches
}: ActivityReviewContextProps): React.JSX.Element {
  if (!matches || matches.length === 0) {
    return (
      <div className="activity-matches-card empty">
        <div className="matches-header">
          <div className="matches-title-group">
            <ShieldCheck size={18} color="var(--accent-blue)" />
            <h3 className="matches-section-title">MATCH & REVIEW CONTEXT</h3>
          </div>
        </div>
        <div className="empty-matches-state">
          <ShieldCheck size={24} color="var(--text-muted)" />
          <p className="empty-text">No AI matches are associated with this activity.</p>
        </div>
      </div>
    );
  }

  const confirmedMatches = matches.filter((m) => m.status === 'confirmed');
  const suggestedMatches = matches.filter(
    (m) => m.status === 'suggested' && m.reviewState !== 'unresolved'
  );
  const unresolvedMatches = matches.filter(
    (m) => m.status === 'suggested' && m.reviewState === 'unresolved'
  );
  const rejectedMatches = matches.filter((m) => m.status === 'rejected');

  const getTierClass = (tier: string | null) => {
    switch (tier?.toLowerCase()) {
      case 'high':
        return 'tier-high';
      case 'medium':
        return 'tier-medium';
      case 'low':
      default:
        return 'tier-low';
    }
  };

  return (
    <div className="activity-matches-card">
      <div className="matches-header">
        <div className="matches-title-group">
          <ShieldCheck size={18} color="var(--accent-blue)" />
          <h3 className="matches-section-title">MATCH & REVIEW CONTEXT</h3>
          <span className="matches-count-badge">
            {matches.length} {matches.length === 1 ? 'Match Record' : 'Match Records'}
          </span>
        </div>
      </div>

      <div className="canonical-protection-banner" style={{ margin: '0.75rem 1.25rem 1rem' }}>
        <CheckCircle2 size={16} color="var(--accent-emerald)" style={{ flexShrink: 0 }} />
        <span>
          <strong>Canonical Truth Protection:</strong> Only confirmed matches are eligible to produce canonical progress observations. Suggested or rejected matches do not alter project truth.
        </span>
      </div>

      <div className="matches-groups-container">
        {/* 1. Confirmed Matches */}
        {confirmedMatches.length > 0 && (
          <div className="match-review-subgroup">
            <div className="subgroup-header confirmed">
              <CheckCircle2 size={14} />
              <span>Confirmed Matches ({confirmedMatches.length})</span>
            </div>
            <div className="match-cards-grid">
              {confirmedMatches.map((m) => (
                <div key={m.matchId} className="detail-match-card confirmed">
                  <div className="match-card-top-row">
                    <div className="match-method-tag">{m.matchMethod.replace('_', ' ').toUpperCase()}</div>
                    <div className="match-pills-row">
                      <span className={`tier-badge ${getTierClass(m.confidenceTier)}`}>
                        {(m.confidenceTier || 'HIGH').toUpperCase()} &bull; {Math.round(m.confidenceScore * 100)}%
                      </span>
                      <span className="status-badge-confirmed">
                        <Check size={11} />
                        <span>Confirmed</span>
                      </span>
                    </div>
                  </div>

                  {m.matchedText && (
                    <div className="matched-text-box">
                      <span className="matched-label">Matched Text:</span>
                      <span className="matched-content">"{m.matchedText}"</span>
                    </div>
                  )}

                  {m.rationale && <p className="match-rationale-text">{m.rationale}</p>}

                  <div className="match-card-bottom-row">
                    <div className="reviewer-meta">
                      <User size={12} />
                      <span>{m.reviewedBy || 'System'}</span>
                      {m.reviewedAt && (
                        <>
                          <span>&bull;</span>
                          <Clock size={11} />
                          <span>{new Date(m.reviewedAt).toLocaleDateString()}</span>
                        </>
                      )}
                    </div>
                    <span className="canonical-truth-pill eligible">
                      ✓ Canonical Progress Eligible
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 2. Suggested / Needs Review Matches */}
        {suggestedMatches.length > 0 && (
          <div className="match-review-subgroup">
            <div className="subgroup-header suggested">
              <AlertTriangle size={14} />
              <span>Suggested / Awaiting Review ({suggestedMatches.length})</span>
            </div>
            <div className="match-cards-grid">
              {suggestedMatches.map((m) => (
                <div key={m.matchId} className="detail-match-card suggested">
                  <div className="match-card-top-row">
                    <div className="match-method-tag">{m.matchMethod.replace('_', ' ').toUpperCase()}</div>
                    <div className="match-pills-row">
                      <span className={`tier-badge ${getTierClass(m.confidenceTier)}`}>
                        {(m.confidenceTier || 'MED').toUpperCase()} &bull; {Math.round(m.confidenceScore * 100)}%
                      </span>
                      <span className="status-badge-suggested">Suggested</span>
                    </div>
                  </div>

                  {m.matchedText && (
                    <div className="matched-text-box">
                      <span className="matched-label">Matched Text:</span>
                      <span className="matched-content">"{m.matchedText}"</span>
                    </div>
                  )}

                  {m.rationale && <p className="match-rationale-text">{m.rationale}</p>}

                  <div className="match-card-bottom-row">
                    <span className="reviewer-meta">Awaiting Human Review</span>
                    <span className="canonical-truth-pill not-canonical">
                      Not Canonical Truth
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. Unresolved Matches */}
        {unresolvedMatches.length > 0 && (
          <div className="match-review-subgroup">
            <div className="subgroup-header unresolved">
              <HelpCircle size={14} />
              <span>Unresolved Candidates ({unresolvedMatches.length})</span>
            </div>
            <div className="match-cards-grid">
              {unresolvedMatches.map((m) => (
                <div key={m.matchId} className="detail-match-card unresolved">
                  <div className="match-card-top-row">
                    <div className="match-method-tag">{m.matchMethod.replace('_', ' ').toUpperCase()}</div>
                    <span className="status-badge-unresolved">Unresolved</span>
                  </div>
                  {m.matchedText && (
                    <div className="matched-text-box">
                      <span className="matched-label">Matched Text:</span>
                      <span className="matched-content">"{m.matchedText}"</span>
                    </div>
                  )}
                  <div className="match-card-bottom-row">
                    <span className="reviewer-meta">Requires Assignment</span>
                    <span className="canonical-truth-pill not-canonical">
                      Not Canonical Truth
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4. Rejected Matches */}
        {rejectedMatches.length > 0 && (
          <div className="match-review-subgroup">
            <div className="subgroup-header rejected">
              <XCircle size={14} />
              <span>Rejected Candidates ({rejectedMatches.length})</span>
            </div>
            <div className="match-cards-grid">
              {rejectedMatches.map((m) => (
                <div key={m.matchId} className="detail-match-card rejected">
                  <div className="match-card-top-row">
                    <div className="match-method-tag">{m.matchMethod.replace('_', ' ').toUpperCase()}</div>
                    <span className="status-badge-rejected">Rejected</span>
                  </div>
                  {m.rationale && <p className="match-rationale-text">{m.rationale}</p>}
                  <div className="match-card-bottom-row">
                    <div className="reviewer-meta">
                      <User size={12} />
                      <span>Rejected by {m.reviewedBy || 'Reviewer'}</span>
                    </div>
                    <span className="canonical-truth-pill not-canonical">
                      Not Canonical Truth
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
