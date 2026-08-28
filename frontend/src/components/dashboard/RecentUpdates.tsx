import React from 'react';
import {
  Activity,
  Calendar,
  Clock,
  User,
  FileSpreadsheet,
  FileText,
  Image,
  Mic,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  X,
  ExternalLink,
  ChevronRight,
  Paperclip,
  Check
} from 'lucide-react';

export interface DashboardMatch {
  id: string;
  activityId: string;
  activityExternalId: string;
  activityName: string;
  confidenceScore: number;
  status: 'suggested' | 'confirmed' | 'rejected';
  confidenceTier: string | null;
  reviewState: string | null;
  matchMethod: string;
  rationale: string | null;
  evidenceId: string | null;
}

export interface DashboardObservation {
  id: string;
  activityId: string;
  activityExternalId: string;
  activityName: string;
  actualPercent: number;
  actualStart: string | null;
  actualFinish: string | null;
  status: string;
  asOfDate: string;
}

export interface DashboardEvidence {
  id: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number | null;
  uploadedAt: string;
}

export interface DashboardUpdateItem {
  id: string;
  reportDate: string;
  createdAt: string;
  reporterName: string | null;
  reporterRole: string | null;
  sourceType: string;
  rawText: string;
  status: string;
  matches: DashboardMatch[];
  canonicalObservations: DashboardObservation[];
  evidenceList: DashboardEvidence[];
}

export interface RecentUpdatesProps {
  updates: DashboardUpdateItem[];
  onSelectUpdateReview?: (updateId: string) => void;
  onTraceEvidence?: (evidenceId?: string) => void;
  onViewAllUpdates?: () => void;
}

export function RecentUpdates({
  updates,
  onSelectUpdateReview,
  onTraceEvidence,
  onViewAllUpdates
}: RecentUpdatesProps): React.JSX.Element {
  const getSourceBadge = (sourceType: string) => {
    switch (sourceType.toLowerCase()) {
      case 'xlsx':
      case 'csv':
        return (
          <span className="source-badge xlsx">
            <FileSpreadsheet size={12} />
            <span>EXCEL</span>
          </span>
        );
      case 'pdf':
        return (
          <span className="source-badge pdf">
            <FileText size={12} />
            <span>PDF REPORT</span>
          </span>
        );
      case 'image':
        return (
          <span className="source-badge image">
            <Image size={12} />
            <span>SITE PHOTO</span>
          </span>
        );
      case 'voice':
        return (
          <span className="source-badge voice">
            <Mic size={12} />
            <span>VOICE LOG</span>
          </span>
        );
      default:
        return (
          <span className="source-badge manual">
            <FileText size={12} />
            <span>{sourceType.toUpperCase()}</span>
          </span>
        );
    }
  };

  return (
    <div className="recent-updates-dashboard-card">
      <div className="recent-updates-header">
        <div className="recent-updates-title-group">
          <Clock size={18} color="var(--accent-blue)" />
          <h3 className="section-title">Chronological Field Updates</h3>
          <span className="recent-count-tag">{updates.length} Recent Records</span>
        </div>
        {onViewAllUpdates && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onViewAllUpdates}
          >
            <span>View All in History</span>
            <ChevronRight size={14} />
          </button>
        )}
      </div>

      {updates.length === 0 ? (
        <div className="empty-state-card" style={{ padding: '2.5rem 1rem' }}>
          <div className="empty-icon-wrapper">
            <Activity size={28} />
          </div>
          <h4 className="empty-title">No Field Reports Captured Yet</h4>
          <p className="empty-desc">
            Record manual shift reports or upload structured daily site logs in the <strong>Progress Updates</strong> tab to populate project history.
          </p>
        </div>
      ) : (
        <div className="dashboard-updates-list">
          {updates.map((upd) => (
            <div key={upd.id} className="dashboard-update-item">
              <div className="dashboard-update-top">
                <div className="update-meta-left">
                  <div className="update-date-badge">
                    <Calendar size={13} />
                    <span>{upd.reportDate}</span>
                  </div>
                  {upd.reporterName ? (
                    <div className="update-reporter-tag">
                      <User size={12} />
                      <span>{upd.reporterName}</span>
                      {upd.reporterRole && (
                        <span className="reporter-role">({upd.reporterRole})</span>
                      )}
                    </div>
                  ) : (
                    <div className="update-reporter-tag muted">
                      <User size={12} />
                      <span>Anonymous Reporter</span>
                    </div>
                  )}
                </div>

                <div className="update-meta-right">
                  {getSourceBadge(upd.sourceType)}
                  <span className="update-time-text">
                    <Clock size={11} />
                    {new Date(upd.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>

              {/* Narrative Content */}
              <div className="dashboard-update-body">
                <p className="update-narrative-text">{upd.rawText}</p>
              </div>

              {/* Verified Canonical Progress Observations */}
              {upd.canonicalObservations.length > 0 && (
                <div className="update-observations-bar">
                  <div className="obs-header-label">
                    <CheckCircle2 size={13} color="var(--accent-emerald)" />
                    <span>Canonical Progress Recorded:</span>
                  </div>
                  <div className="obs-chips-list">
                    {upd.canonicalObservations.map((obs) => (
                      <span key={obs.id} className="obs-progress-chip">
                        <strong>[{obs.activityExternalId}]</strong> {obs.activityName} &bull;{' '}
                        <span className="obs-pct">{obs.actualPercent}%</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Associated Activity Match Reviews (Section 14/15) */}
              {upd.matches.length > 0 && (
                <div className="update-matches-summary-row">
                  <div className="matches-summary-label">
                    <ShieldCheck size={13} color="var(--accent-cyan)" />
                    <span>Matched Activities:</span>
                  </div>
                  <div className="matches-pills-row">
                    {upd.matches.map((m) => {
                      const isConfirmed = m.status === 'confirmed';
                      const isSuggested = m.status === 'suggested' && m.reviewState !== 'unresolved';
                      const isUnresolved = m.status === 'suggested' && m.reviewState === 'unresolved';
                      const isRejected = m.status === 'rejected';

                      return (
                        <div
                          key={m.id}
                          className={`match-mini-pill ${m.status} ${m.reviewState || ''}`}
                          title={m.rationale || undefined}
                        >
                          <span className="match-mini-ext-id">[{m.activityExternalId}]</span>
                          <span className="match-mini-name">{m.activityName}</span>
                          {isConfirmed && (
                            <span className="match-state-tag confirmed">
                              <Check size={11} />
                              Confirmed
                            </span>
                          )}
                          {isSuggested && (
                            <span className="match-state-tag suggested">
                              <AlertTriangle size={11} />
                              Suggested
                            </span>
                          )}
                          {isUnresolved && (
                            <span className="match-state-tag unresolved">
                              <HelpCircle size={11} />
                              Unresolved
                            </span>
                          )}
                          {isRejected && (
                            <span className="match-state-tag rejected">
                              <X size={11} />
                              Rejected
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Bottom Actions: Evidence Provenance & Match Review */}
              <div className="dashboard-update-footer">
                <div className="footer-left">
                  {upd.evidenceList.length > 0 && (
                    <div className="update-evidence-list">
                      {upd.evidenceList.map((ev) => (
                        <button
                          key={ev.id}
                          type="button"
                          className="btn-evidence-trace"
                          onClick={() => onTraceEvidence && onTraceEvidence(ev.id)}
                          title={`Trace Provenance: ${ev.fileName}`}
                        >
                          <Paperclip size={12} />
                          <span>Evidence: {ev.fileName}</span>
                          <ExternalLink size={11} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="footer-right">
                  <button
                    type="button"
                    className="btn-update-review-link"
                    onClick={() => onSelectUpdateReview && onSelectUpdateReview(upd.id)}
                  >
                    <span>Review in Progress Feed</span>
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
