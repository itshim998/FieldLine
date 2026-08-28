import React from 'react';
import {
  CheckCircle2,
  TrendingUp,
  AlertTriangle,
  AlertOctagon,
  CheckCheck,
  Layers,
  ChevronRight
} from 'lucide-react';

export interface ActivityStatusCounts {
  totalActivities: number;
  onTrack: number;
  ahead: number;
  atRisk: number;
  delayed: number;
  completed: number;
  overdueCount?: number;
}

export interface ActivityStatusSummaryProps {
  counts: ActivityStatusCounts;
  onSelectStatusFilter?: (status: string) => void;
}

export function ActivityStatusSummary({
  counts,
  onSelectStatusFilter
}: ActivityStatusSummaryProps): React.JSX.Element {
  const total = counts.totalActivities || 1; // avoid division by 0

  const pctCompleted = ((counts.completed / total) * 100);
  const pctOnTrack = ((counts.onTrack / total) * 100);
  const pctAhead = ((counts.ahead / total) * 100);
  const pctAtRisk = ((counts.atRisk / total) * 100);
  const pctDelayed = ((counts.delayed / total) * 100);

  return (
    <div className="activity-status-summary-card">
      <div className="status-summary-header">
        <div className="status-summary-title-group">
          <Layers size={18} color="var(--accent-cyan)" />
          <h3 className="section-title">Activity Execution Breakdown</h3>
        </div>
        <span className="total-activities-badge">
          {counts.totalActivities} Total Work Items
        </span>
      </div>

      {/* Proportional Distribution Bar */}
      {counts.totalActivities > 0 ? (
        <div className="distribution-bar-wrapper">
          <div className="distribution-bar">
            {counts.completed > 0 && (
              <div
                className="dist-segment completed"
                style={{ width: `${pctCompleted}%` }}
                title={`Completed: ${counts.completed} (${pctCompleted.toFixed(0)}%)`}
              />
            )}
            {counts.ahead > 0 && (
              <div
                className="dist-segment ahead"
                style={{ width: `${pctAhead}%` }}
                title={`Ahead: ${counts.ahead} (${pctAhead.toFixed(0)}%)`}
              />
            )}
            {counts.onTrack > 0 && (
              <div
                className="dist-segment on-track"
                style={{ width: `${pctOnTrack}%` }}
                title={`On Track: ${counts.onTrack} (${pctOnTrack.toFixed(0)}%)`}
              />
            )}
            {counts.atRisk > 0 && (
              <div
                className="dist-segment at-risk"
                style={{ width: `${pctAtRisk}%` }}
                title={`At Risk: ${counts.atRisk} (${pctAtRisk.toFixed(0)}%)`}
              />
            )}
            {counts.delayed > 0 && (
              <div
                className="dist-segment delayed"
                style={{ width: `${pctDelayed}%` }}
                title={`Delayed: ${counts.delayed} (${pctDelayed.toFixed(0)}%)`}
              />
            )}
          </div>
        </div>
      ) : null}

      {/* 5 Status Cards Grid */}
      <div className="status-cards-grid">
        {/* 1. On Track */}
        <button
          type="button"
          className="status-count-card on-track"
          onClick={() => onSelectStatusFilter && onSelectStatusFilter('ON_TRACK')}
        >
          <div className="status-card-top">
            <CheckCircle2 size={16} />
            <span className="status-card-label">ON TRACK</span>
          </div>
          <div className="status-card-count">{counts.onTrack}</div>
          <div className="status-card-footer">
            <span>Pacing with plan</span>
            <ChevronRight size={14} />
          </div>
        </button>

        {/* 2. Ahead */}
        <button
          type="button"
          className="status-count-card ahead"
          onClick={() => onSelectStatusFilter && onSelectStatusFilter('AHEAD')}
        >
          <div className="status-card-top">
            <TrendingUp size={16} />
            <span className="status-card-label">AHEAD</span>
          </div>
          <div className="status-card-count">{counts.ahead}</div>
          <div className="status-card-footer">
            <span>Leading plan</span>
            <ChevronRight size={14} />
          </div>
        </button>

        {/* 3. At Risk */}
        <button
          type="button"
          className="status-count-card at-risk"
          onClick={() => onSelectStatusFilter && onSelectStatusFilter('AT_RISK')}
        >
          <div className="status-card-top">
            <AlertTriangle size={16} />
            <span className="status-card-label">AT RISK</span>
          </div>
          <div className="status-card-count">{counts.atRisk}</div>
          <div className="status-card-footer">
            <span>Variance warning</span>
            <ChevronRight size={14} />
          </div>
        </button>

        {/* 4. Delayed */}
        <button
          type="button"
          className="status-count-card delayed"
          onClick={() => onSelectStatusFilter && onSelectStatusFilter('DELAYED')}
        >
          <div className="status-card-top">
            <AlertOctagon size={16} />
            <span className="status-card-label">DELAYED</span>
          </div>
          <div className="status-card-count">{counts.delayed}</div>
          <div className="status-card-footer">
            <span>Past finish date</span>
            <ChevronRight size={14} />
          </div>
        </button>

        {/* 5. Completed */}
        <button
          type="button"
          className="status-count-card completed"
          onClick={() => onSelectStatusFilter && onSelectStatusFilter('COMPLETED')}
        >
          <div className="status-card-top">
            <CheckCheck size={16} />
            <span className="status-card-label">COMPLETED</span>
          </div>
          <div className="status-card-count">{counts.completed}</div>
          <div className="status-card-footer">
            <span>100% finished</span>
            <ChevronRight size={14} />
          </div>
        </button>
      </div>
    </div>
  );
}
