import React from 'react';
import { FileText, User, Calendar, Clock, CheckCircle2 } from 'lucide-react';
import { ActivityDetailProgressUpdateItem } from '../../services/activity-detail/activity-detail.types.js';

export interface ActivityProgressSourcesProps {
  progressUpdates: ActivityDetailProgressUpdateItem[];
  onSelectUpdate?: (updateId: string) => void;
}

export function ActivityProgressSources({
  progressUpdates,
  onSelectUpdate
}: ActivityProgressSourcesProps): React.JSX.Element {
  if (!progressUpdates || progressUpdates.length === 0) {
    return (
      <div className="activity-sources-card empty">
        <div className="sources-header">
          <div className="sources-title-group">
            <FileText size={18} color="var(--accent-blue)" />
            <h3 className="sources-section-title">ORIGINATING PROGRESS REPORTS</h3>
          </div>
        </div>
        <div className="empty-sources-state">
          <FileText size={24} color="var(--text-muted)" />
          <p className="empty-text">No progress reports associated with this activity yet.</p>
        </div>
      </div>
    );
  }

  const getSourceBadgeClass = (source: string) => {
    switch (source.toLowerCase()) {
      case 'pdf':
        return 'source-pdf';
      case 'xlsx':
        return 'source-xlsx';
      case 'image':
        return 'source-image';
      case 'voice':
        return 'source-voice';
      case 'manual':
      default:
        return 'source-manual';
    }
  };

  return (
    <div className="activity-sources-card">
      <div className="sources-header">
        <div className="sources-title-group">
          <FileText size={18} color="var(--accent-blue)" />
          <h3 className="sources-section-title">ORIGINATING PROGRESS REPORTS</h3>
          <span className="sources-count-badge">
            {progressUpdates.length} {progressUpdates.length === 1 ? 'Report' : 'Reports'}
          </span>
        </div>
      </div>

      <div className="sources-items-grid">
        {progressUpdates.map((update) => (
          <div key={update.progressUpdateId} className="source-report-card">
            <div className="source-report-top">
              <div className="source-report-date-user">
                <div className="report-date-badge">
                  <Calendar size={12} />
                  <span>{update.reportDate}</span>
                </div>

                <div className="report-reporter-info">
                  <User size={12} />
                  <span>{update.reporterName || 'Anonymous Reporter'}</span>
                  {update.reporterRole && (
                    <span className="reporter-role-tag">({update.reporterRole})</span>
                  )}
                </div>
              </div>

              <span className={`source-type-pill ${getSourceBadgeClass(update.sourceType)}`}>
                {update.sourceType.toUpperCase()}
              </span>
            </div>

            {update.rawText && (
              <p className="source-report-raw-text">{update.rawText}</p>
            )}

            <div className="source-report-footer">
              <span className="source-report-id">ID: {update.progressUpdateId.slice(0, 8)}...</span>
              <span className="source-report-status">{update.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
