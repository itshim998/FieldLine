import React from 'react';
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Calendar,
  AlertCircle,
  ShieldAlert,
  ShieldCheck
} from 'lucide-react';
import {
  ActivityDetailActivity,
  ActivityDetailCurrentState
} from '../../services/activity-detail/activity-detail.types.js';

export interface ActivityCurrentStateProps {
  activity: ActivityDetailActivity;
  current: ActivityDetailCurrentState;
}

export function ActivityCurrentState({
  activity,
  current
}: ActivityCurrentStateProps): React.JSX.Element {
  const isAhead = current.varianceState === 'ahead';
  const isBehind = current.varianceState === 'behind';

  const formatVariance = (v: number) => {
    if (v > 0) return `+${v.toFixed(1)}%`;
    if (v < 0) return `${v.toFixed(1)}%`;
    return '0.0%';
  };

  const getRiskBadgeClass = (risk: string) => {
    switch (risk) {
      case 'DELAYED':
        return 'risk-delayed';
      case 'AT_RISK':
        return 'risk-at-risk';
      case 'COMPLETED':
        return 'risk-completed';
      case 'AHEAD':
        return 'risk-ahead';
      case 'ON_TRACK':
      default:
        return 'risk-on-track';
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'completed':
        return 'status-completed';
      case 'in_progress':
      case 'started':
        return 'status-in-progress';
      case 'delayed':
        return 'status-delayed';
      case 'not_started':
      default:
        return 'status-not-started';
    }
  };

  return (
    <div className="activity-current-state-card">
      <div className="current-state-card-header">
        <div className="current-state-title-group">
          <ShieldCheck size={18} color="var(--accent-blue)" />
          <h3 className="current-state-section-title">CURRENT STATE</h3>
          <span className="as-of-badge">Evaluated as of {current.asOfDate}</span>
        </div>

        <div className="current-state-header-badges">
          {current.overdue && (
            <span className="overdue-pill">
              <AlertTriangle size={13} />
              <span>OVERDUE</span>
            </span>
          )}
          {current.flaggedForVerification && (
            <span className="verification-flag-pill">
              <AlertTriangle size={13} />
              <span>Last update flagged for supervisor verification</span>
            </span>
          )}
          <span className={`risk-classification-pill ${getRiskBadgeClass(current.riskClassification)}`}>
            {current.riskClassification.replace('_', ' ')}
          </span>
          <span className={`execution-status-pill ${getStatusBadgeClass(current.status)}`}>
            {current.status.replace('_', ' ').toUpperCase()}
          </span>
        </div>
      </div>

      <div className="current-state-metrics-grid">
        {/* Actual Progress Metric */}
        <div className="current-metric-block actual">
          <span className="metric-label">Actual Progress</span>
          <div className="metric-value-row">
            <span className="metric-value-huge">{current.actualProgress.toFixed(1)}%</span>
          </div>
          <div className="progress-bar-container">
            <div
              className="progress-bar-fill actual-fill"
              style={{ width: `${Math.min(100, Math.max(0, current.actualProgress))}%` }}
            />
          </div>
        </div>

        {/* Planned Progress Metric */}
        <div className="current-metric-block planned">
          <span className="metric-label">Planned Progress</span>
          <div className="metric-value-row">
            <span className="metric-value-huge">{current.plannedProgress.toFixed(1)}%</span>
          </div>
          <div className="progress-bar-container">
            <div
              className="progress-bar-fill planned-fill"
              style={{ width: `${Math.min(100, Math.max(0, current.plannedProgress))}%` }}
            />
          </div>
        </div>

        {/* Progress Variance Metric */}
        <div className={`current-metric-block variance ${current.varianceState}`}>
          <span className="metric-label">Progress Variance</span>
          <div className="metric-value-row">
            <span
              className="metric-value-huge"
              style={{
                color: isAhead
                  ? 'var(--accent-emerald)'
                  : isBehind
                  ? 'var(--accent-rose)'
                  : 'var(--accent-blue)'
              }}
            >
              {formatVariance(current.progressVariance)}
            </span>
          </div>
          <span className="variance-caption">
            {isAhead ? 'Ahead of Schedule' : isBehind ? 'Behind Schedule' : 'On Plan'}
          </span>
        </div>
      </div>

      {/* Planned & Actual Execution Schedule Dates */}
      <div className="current-dates-comparison-strip">
        <div className="dates-col planned-dates">
          <div className="dates-header">
            <Calendar size={13} />
            <span>Planned Dates</span>
          </div>
          <div className="dates-content">
            <span>
              {activity.plannedStart} &rarr; {activity.plannedFinish}
            </span>
          </div>
        </div>

        <div className="dates-col actual-dates">
          <div className="dates-header">
            <Clock size={13} />
            <span>Actual Execution Dates</span>
          </div>
          <div className="dates-content">
            <span>
              Start: <strong>{current.actualStart || 'Not Started'}</strong> &bull; Finish:{' '}
              <strong>{current.actualFinish || (current.status === 'completed' ? 'Completed' : 'In Progress')}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Risk Reasons if any exist */}
      {current.riskReasons && current.riskReasons.length > 0 && (
        <div className="current-risk-reasons-panel">
          <div className="risk-reasons-title">
            <AlertCircle size={14} color="var(--accent-amber)" />
            <span>Risk Analysis Signals & Deterministic Reasons:</span>
          </div>
          <div className="risk-reasons-list">
            {current.riskReasons.map((r: any, idx: number) => (
              <div key={idx} className="risk-reason-item">
                <span className="risk-reason-bullet">&bull;</span>
                <span className="risk-reason-text">{r.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
