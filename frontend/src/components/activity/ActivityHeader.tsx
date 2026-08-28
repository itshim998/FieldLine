import React from 'react';
import { ArrowLeft, Calendar, Tag, MapPin, Layers, RefreshCw } from 'lucide-react';
import { ActivityDetailActivity } from '../../services/activity-detail/activity-detail.types.js';

export interface ActivityHeaderProps {
  activity: ActivityDetailActivity;
  asOfDate: string;
  onDateChange: (newDate: string) => void;
  onBack: () => void;
  isLoading?: boolean;
}

export function ActivityHeader({
  activity,
  asOfDate,
  onDateChange,
  onBack,
  isLoading
}: ActivityHeaderProps): React.JSX.Element {
  return (
    <div className="activity-detail-header-card">
      <div className="activity-detail-header-top">
        <button
          type="button"
          id="btn-back-to-project"
          className="btn btn-secondary btn-sm activity-back-btn"
          onClick={onBack}
        >
          <ArrowLeft size={14} />
          <span>Back to Workspace</span>
        </button>

        <div className="activity-as-of-selector">
          <Calendar size={14} color="var(--accent-blue)" />
          <label htmlFor="activity-as-of-date" className="activity-as-of-label">
            As of Date:
          </label>
          <input
            id="activity-as-of-date"
            type="date"
            className="dashboard-date-input"
            value={asOfDate}
            onChange={(e) => onDateChange(e.target.value)}
          />
          {isLoading && <RefreshCw size={13} className="pulse-dot" color="var(--accent-blue)" />}
        </div>
      </div>

      <div className="activity-identity-main">
        <div className="activity-identity-title-row">
          <h2 className="activity-title">{activity.name}</h2>
          <span className="activity-external-id-badge">{activity.externalId}</span>
        </div>

        {activity.description && (
          <p className="activity-description-text">{activity.description}</p>
        )}

        <div className="activity-metadata-pills-row">
          {activity.wbsCode && (
            <div className="meta-pill">
              <Tag size={12} />
              <span className="meta-pill-label">WBS:</span>
              <span className="meta-pill-val">{activity.wbsCode}</span>
            </div>
          )}

          {activity.location && (
            <div className="meta-pill">
              <MapPin size={12} />
              <span className="meta-pill-label">Location:</span>
              <span className="meta-pill-val">{activity.location}</span>
            </div>
          )}

          <div className="meta-pill">
            <Layers size={12} />
            <span className="meta-pill-label">Schedule ID:</span>
            <span className="meta-pill-val">{activity.scheduleId.slice(0, 8)}...</span>
          </div>

          {activity.plannedQuantity !== null && activity.unit && (
            <div className="meta-pill">
              <span className="meta-pill-label">Planned Qty:</span>
              <span className="meta-pill-val">
                {activity.plannedQuantity.toLocaleString()} {activity.unit}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
