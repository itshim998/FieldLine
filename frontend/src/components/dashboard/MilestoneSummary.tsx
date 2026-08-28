import React from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  Flag,
  AlertTriangle,
  ChevronRight,
  Sparkles
} from 'lucide-react';

export interface MilestoneItem {
  activityId: string;
  externalId: string;
  name: string;
  milestoneDate: string;
  daysUntil: number;
  status: string;
  actualProgress: number;
  isCompleted: boolean;
  isOverdue: boolean;
  isLate: boolean;
}

export interface MilestoneSummaryProps {
  upcoming: MilestoneItem[];
  completed: MilestoneItem[];
  late: MilestoneItem[];
  onSelectMilestone?: (activityId: string) => void;
}

export function MilestoneSummary({
  upcoming,
  completed,
  late,
  onSelectMilestone
}: MilestoneSummaryProps): React.JSX.Element {
  const totalMilestones = upcoming.length + completed.length + late.length;

  return (
    <div className="milestone-summary-card">
      <div className="milestone-header">
        <div className="milestone-title-group">
          <Flag size={18} color="var(--accent-indigo)" />
          <h3 className="section-title">Key Project Milestones</h3>
        </div>
        <span className="milestone-invariant-tag" title="Zero-duration milestone invariant: plannedStart === plannedFinish">
          Duration: 0d
        </span>
      </div>

      {totalMilestones === 0 ? (
        <div className="attention-empty-state" style={{ padding: '2.5rem 1rem' }}>
          <div className="empty-state-icon-circle">
            <Flag size={22} color="var(--accent-indigo)" />
          </div>
          <h4 className="attention-empty-title">No Milestones Defined</h4>
          <p className="attention-empty-desc">
            Import a baseline schedule with zero-duration key delivery milestones to track upcoming and completed project deadlines.
          </p>
        </div>
      ) : (
        <div className="milestone-lists-wrapper">
          {/* 1. Late / Overdue Milestones */}
          {late.length > 0 && (
            <div className="milestone-group late">
              <div className="milestone-group-title">
                <AlertTriangle size={14} color="var(--accent-rose)" />
                <span>Overdue / Late Milestones ({late.length})</span>
              </div>
              <div className="milestone-items-list">
                {late.map((ms) => (
                  <div
                    key={ms.activityId}
                    className="milestone-item-row late"
                    onClick={() => onSelectMilestone && onSelectMilestone(ms.activityId)}
                  >
                    <div className="milestone-left">
                      <div className="milestone-pill-row">
                        <span className="code-pill rose">{ms.externalId}</span>
                        <span className="milestone-date-badge late">
                          <Calendar size={11} />
                          {ms.milestoneDate}
                        </span>
                      </div>
                      <div className="milestone-name">{ms.name}</div>
                    </div>
                    <div className="milestone-right">
                      <span className="milestone-status-tag late">
                        {Math.abs(ms.daysUntil)}d Overdue
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 2. Upcoming Milestones */}
          <div className="milestone-group upcoming">
            <div className="milestone-group-title">
              <Clock size={14} color="var(--accent-cyan)" />
              <span>Upcoming Milestones ({upcoming.length})</span>
            </div>
            {upcoming.length === 0 ? (
              <div className="milestone-empty-subtext">No upcoming milestones in next window.</div>
            ) : (
              <div className="milestone-items-list">
                {upcoming.map((ms) => (
                  <div
                    key={ms.activityId}
                    className="milestone-item-row upcoming"
                    onClick={() => onSelectMilestone && onSelectMilestone(ms.activityId)}
                  >
                    <div className="milestone-left">
                      <div className="milestone-pill-row">
                        <span className="code-pill cyan">{ms.externalId}</span>
                        <span className="milestone-date-badge">
                          <Calendar size={11} />
                          {ms.milestoneDate}
                        </span>
                      </div>
                      <div className="milestone-name">{ms.name}</div>
                    </div>
                    <div className="milestone-right">
                      <span className="milestone-status-tag upcoming">
                        {ms.daysUntil === 0
                          ? 'Today'
                          : ms.daysUntil === 1
                          ? 'Tomorrow'
                          : `in ${ms.daysUntil} days`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 3. Recently Completed Milestones */}
          {completed.length > 0 && (
            <div className="milestone-group completed">
              <div className="milestone-group-title">
                <CheckCircle2 size={14} color="var(--accent-emerald)" />
                <span>Completed Milestones ({completed.length})</span>
              </div>
              <div className="milestone-items-list">
                {completed.slice(0, 3).map((ms) => (
                  <div
                    key={ms.activityId}
                    className="milestone-item-row completed"
                    onClick={() => onSelectMilestone && onSelectMilestone(ms.activityId)}
                  >
                    <div className="milestone-left">
                      <div className="milestone-pill-row">
                        <span className="code-pill emerald">{ms.externalId}</span>
                        <span className="milestone-date-badge completed">
                          <CheckCircle2 size={11} />
                          {ms.milestoneDate}
                        </span>
                      </div>
                      <div className="milestone-name">{ms.name}</div>
                    </div>
                    <div className="milestone-right">
                      <span className="milestone-status-tag completed">
                        Achieved
                      </span>
                    </div>
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
