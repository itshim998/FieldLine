import { FieldLineProgress } from '../ui/FieldLine.js';
import React from 'react';
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  RefreshCw,
  TrendingDown,
  TrendingUp
} from 'lucide-react';

export interface ProjectHealthProps {
  actualProgress: number;
  plannedProgress: number;
  variance: number;
  varianceState: 'ahead' | 'on_plan' | 'behind';
  riskClassification: 'ON_TRACK' | 'AHEAD' | 'AT_RISK' | 'DELAYED' | 'COMPLETED';
  asOfDate: string;
  projectName: string;
  projectCode: string;
  onRefresh?: () => void;
  isLoading?: boolean;
}

export function ProjectHealth({
  actualProgress,
  plannedProgress,
  variance,
  varianceState,
  riskClassification,
  asOfDate,
  projectName,
  projectCode,
  onRefresh,
  isLoading
}: ProjectHealthProps): React.JSX.Element {
  const getRiskBadge = (classification: string) => {
    switch (classification) {
      case 'COMPLETED':
        return (
          <span className="health-classification-badge completed">
            <CheckCircle2 size={16} />
            <span>COMPLETED</span>
          </span>
        );
      case 'AHEAD':
        return (
          <span className="health-classification-badge ahead">
            <TrendingUp size={16} />
            <span>AHEAD OF SCHEDULE</span>
          </span>
        );
      case 'ON_TRACK':
        return (
          <span className="health-classification-badge on-track">
            <CheckCircle2 size={16} />
            <span>ON TRACK</span>
          </span>
        );
      case 'AT_RISK':
        return (
          <span className="health-classification-badge at-risk">
            <AlertTriangle size={16} />
            <span>AT RISK</span>
          </span>
        );
      case 'DELAYED':
        return (
          <span className="health-classification-badge delayed">
            <AlertTriangle size={16} />
            <span>DELAYED</span>
          </span>
        );
      default:
        return (
          <span className="health-classification-badge">
            <Activity size={16} />
            <span>{classification}</span>
          </span>
        );
    }
  };

  const getVarianceColor = () => {
    if (varianceState === 'ahead') return 'var(--accent-emerald)';
    if (varianceState === 'behind') return 'var(--accent-rose)';
    return 'var(--accent-cyan)';
  };

  return (
    <div className="project-health-hero-card">
      <div className="health-hero-top">
        <div className="health-project-identity">
          <div className="health-title-row">
            <h2 className="health-project-name">{projectName}</h2>
            <span className="health-code-pill mono">{projectCode}</span>
          </div>
          <div className="health-as-of-row">
            <Calendar size={14} color="var(--accent-blue)" />
            <span className="health-as-of-text">
              As of <strong>{asOfDate}</strong>
            </span>
          </div>
        </div>

        <div className="health-actions-group">
          {getRiskBadge(riskClassification)}
          {onRefresh && (
            <button
              type="button"
              className="health-refresh-btn"
              onClick={onRefresh}
              disabled={isLoading}
              title="Refresh project dashboard snapshot"
              aria-label="Refresh project dashboard snapshot"
            >
              <RefreshCw size={15} className={isLoading ? 'spinning' : ''} />
            </button>
          )}
        </div>
      </div>

      {/* Main KPI Quad Grid */}
      <div className="health-variance-instrument">
        <h3>Planned vs actual</h3>
        <FieldLineProgress planned={plannedProgress} actual={actualProgress} />
        <div className="fl-variance-legend">
          <span className="fl-variance-legend__planned">Planned <strong>{plannedProgress.toFixed(1)}%</strong></span>
          <span className="fl-variance-legend__actual">Actual <strong>{actualProgress.toFixed(1)}%</strong></span>
          <span>Difference <strong>{variance > 0 ? '+' : ''}{variance.toFixed(1)} pts</strong></span>
        </div>
      </div>
      <div className="health-kpi-grid">
        <div className="health-kpi-card actual">
          <span className="health-kpi-label">
            <Activity size={14} color="var(--accent-emerald)" />
            Actual progress
          </span>
          <div className="health-kpi-value-row">
            <span className="health-kpi-value">{actualProgress.toFixed(1)}%</span>
            <span className="health-kpi-subtext">Reported progress</span>
          </div>
          <div className="health-progress-track">
            <div
              className="health-progress-fill actual"
              style={{ width: `${Math.min(100, Math.max(0, actualProgress))}%` }}
            />
          </div>
        </div>

        <div className="health-kpi-card planned">
          <span className="health-kpi-label">
            <Clock size={14} color="var(--accent-blue)" />
            Planned progress
          </span>
          <div className="health-kpi-value-row">
            <span className="health-kpi-value">{plannedProgress.toFixed(1)}%</span>
            <span className="health-kpi-subtext">Planned by this date</span>
          </div>
          <div className="health-progress-track">
            <div
              className="health-progress-fill planned"
              style={{ width: `${Math.min(100, Math.max(0, plannedProgress))}%` }}
            />
          </div>
        </div>

        <div className="health-kpi-card variance">
          <span className="health-kpi-label">
            {varianceState === 'behind' ? (
              <TrendingDown size={14} color="var(--accent-rose)" />
            ) : (
              <TrendingUp size={14} color="var(--accent-emerald)" />
            )}
            Difference from plan
          </span>
          <div className="health-kpi-value-row">
            <span
              className="health-kpi-value"
              style={{ color: getVarianceColor() }}
            >
              {variance > 0 ? `+${variance.toFixed(1)}` : variance.toFixed(1)} pts
            </span>
            <span className="health-kpi-subtext">
              {varianceState === 'behind'
                ? 'Lagging behind plan'
                : varianceState === 'ahead'
                ? 'Ahead of schedule'
                : 'Pacing on plan'}
            </span>
          </div>
          <div className="variance-indicator-bar">
            <div
              className={`variance-status-tag ${varianceState}`}
            >
              {varianceState.toUpperCase()}
            </div>
          </div>
        </div>

        <div className="health-kpi-card status">
          <span className="health-kpi-label">
            <Activity size={14} color="var(--accent-purple)" />
            Schedule status
          </span>
          <div className="health-kpi-value-row">
            <span className="health-kpi-value status-text">{riskClassification}</span>
            <span className="health-kpi-subtext"></span>
          </div>
          <div className="canonical-guarantee-tag" aria-hidden="true">
            
          </div>
        </div>
      </div>
    </div>
  );
}
