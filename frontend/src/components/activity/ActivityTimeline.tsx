import React from 'react';
import {
  Calendar,
  Clock,
  TrendingUp,
  FileText,
  Activity as ActivityIcon,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { ActivityDetailTimelineItem } from '../../services/activity-detail/activity-detail.types.js';

export interface ActivityTimelineProps {
  timeline: ActivityDetailTimelineItem[];
  unit: string | null;
}

export function ActivityTimeline({
  timeline,
  unit
}: ActivityTimelineProps): React.JSX.Element {
  if (!timeline || timeline.length === 0) {
    return (
      <div className="activity-timeline-card empty">
        <div className="timeline-header">
          <div className="timeline-title-group">
            <ActivityIcon size={18} color="var(--accent-blue)" />
            <h3 className="timeline-section-title">ACTIVITY PROGRESS TIMELINE</h3>
          </div>
        </div>
        <div className="empty-timeline-state">
          <Clock size={28} color="var(--text-muted)" />
          <p className="empty-text">No progress observations recorded yet.</p>
          <span className="empty-subtext">
            Observations will appear chronologically as progress reports are captured and confirmed.
          </span>
        </div>
      </div>
    );
  }

  // Reverse timeline for newest-at-top display while preserving the earliest-to-latest trendline
  const sortedChronological = [...timeline];
  const latestItem = sortedChronological[sortedChronological.length - 1];

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
    <div className="activity-timeline-card">
      <div className="timeline-header">
        <div className="timeline-title-group">
          <ActivityIcon size={18} color="var(--accent-blue)" />
          <h3 className="timeline-section-title">ACTIVITY PROGRESS TIMELINE</h3>
          <span className="timeline-count-badge">
            {timeline.length} {timeline.length === 1 ? 'Observation' : 'Observations'}
          </span>
        </div>
      </div>

      {/* Pure Historical Trend Visualization (No forecasting or predictions) */}
      {timeline.length > 1 && (
        <div className="timeline-historical-trend-strip">
          <div className="trend-strip-label">
            <TrendingUp size={13} />
            <span>Historical Progress Trajectory:</span>
          </div>
          <div className="trend-nodes-row">
            {timeline.map((item, idx) => (
              <React.Fragment key={item.progressId}>
                <div
                  className={`trend-node-pill ${
                    item.progressId === latestItem.progressId ? 'is-latest' : ''
                  }`}
                >
                  <span className="trend-node-date">{item.date}</span>
                  <span className="trend-node-percent">{item.actualPercent}%</span>
                </div>
                {idx < timeline.length - 1 && <span className="trend-node-arrow">&rarr;</span>}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Chronological Vertical Observation List */}
      <div className="timeline-items-list">
        {timeline.map((item, index) => {
          const isLatest = item.progressId === latestItem.progressId;

          return (
            <div
              key={item.progressId}
              className={`timeline-item-node ${isLatest ? 'is-latest-observation' : ''}`}
            >
              {/* Timeline marker column */}
              <div className="timeline-marker-col">
                <div className="timeline-marker-dot">
                  {isLatest ? <CheckCircle2 size={12} /> : <span>{index + 1}</span>}
                </div>
                {index < timeline.length - 1 && <div className="timeline-connector-line" />}
              </div>

              {/* Timeline content column */}
              <div className="timeline-content-bubble">
                <div className="timeline-bubble-header">
                  <div className="timeline-date-group">
                    <Calendar size={13} />
                    <span className="timeline-date-text">{item.date}</span>
                    {isLatest && <span className="latest-tag-pill">Latest Observation</span>}
                  </div>

                  <div className="timeline-badges-group">
                    <span className={`source-type-pill ${getSourceBadgeClass(item.source)}`}>
                      Source: {item.source.toUpperCase()}
                    </span>
                    <span className="timeline-status-pill">
                      {item.status.replace('_', ' ').toUpperCase()}
                    </span>
                  </div>
                </div>

                <div className="timeline-bubble-body">
                  <div className="timeline-progress-highlight">
                    <span className="timeline-percent-val">{item.actualPercent}%</span>
                    {item.actualQuantity !== null && (
                      <span className="timeline-quantity-val">
                        ({item.actualQuantity.toLocaleString()} {unit || 'units'})
                      </span>
                    )}
                  </div>

                  {item.notes && <p className="timeline-notes-text">{item.notes}</p>}
                </div>

                <div className="timeline-bubble-footer">
                  <div className="timeline-timestamp-info">
                    <Clock size={11} />
                    <span>Recorded: {new Date(item.createdAt).toLocaleString()}</span>
                  </div>
                  {item.progressUpdateId && (
                    <span className="timeline-update-ref-pill">
                      Update ID: {item.progressUpdateId.slice(0, 8)}...
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
