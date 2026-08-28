import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ShieldAlert, ArrowLeft } from 'lucide-react';
import { ActivityDetail } from '../../services/activity-detail/activity-detail.types.js';
import { ActivityHeader } from './ActivityHeader.js';
import { ActivityCurrentState } from './ActivityCurrentState.js';
import { ActivityTimeline } from './ActivityTimeline.js';
import { ActivityProgressSources } from './ActivityProgressSources.js';
import { ActivityReviewContext } from './ActivityReviewContext.js';
import { ActivityEvidence } from './ActivityEvidence.js';

export interface ActivityDetailViewProps {
  projectId: string;
  activityId: string;
  initialAsOfDate?: string;
  onBack: () => void;
  onSelectUpdate?: (updateId: string) => void;
}

export function ActivityDetailView({
  projectId,
  activityId,
  initialAsOfDate,
  onBack,
  onSelectUpdate
}: ActivityDetailViewProps): React.JSX.Element {
  const [detailData, setDetailData] = useState<ActivityDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [asOfDate, setAsOfDate] = useState<string>(
    initialAsOfDate || new Date().toISOString().slice(0, 10)
  );

  const fetchActivityDetail = useCallback(
    async (targetDate?: string) => {
      setLoading(true);
      setError(null);

      try {
        const queryParams = new URLSearchParams();
        if (targetDate) {
          queryParams.append('asOfDate', targetDate);
        }

        const res = await fetch(
          `/api/projects/${projectId}/activities/${activityId}?${queryParams.toString()}`
        );

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Failed to fetch activity detail');
        }

        setDetailData(data);
      } catch (err: any) {
        setError(err.message || 'An unexpected error occurred while loading activity detail.');
      } finally {
        setLoading(false);
      }
    },
    [projectId, activityId]
  );

  useEffect(() => {
    fetchActivityDetail(asOfDate);
  }, [fetchActivityDetail, asOfDate]);

  const handleDateChange = (newDate: string) => {
    setAsOfDate(newDate);
    fetchActivityDetail(newDate);
  };

  if (loading && !detailData) {
    return (
      <div className="dashboard-loading-container">
        <RefreshCw size={28} className="pulse-dot" color="var(--accent-blue)" />
        <p className="loading-text">Loading Activity History & Operational Truth...</p>
      </div>
    );
  }

  if (error && !detailData) {
    return (
      <div className="dashboard-error-card">
        <div className="dashboard-error-icon">
          <ShieldAlert size={28} color="var(--accent-rose)" />
        </div>
        <h3 className="error-title">Unable to Load Activity Detail</h3>
        <p className="error-msg">{error}</p>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', justifyContent: 'center' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
            <ArrowLeft size={13} />
            <span>Back to Workspace</span>
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => fetchActivityDetail(asOfDate)}
          >
            <RefreshCw size={13} />
            <span>Retry Loading</span>
          </button>
        </div>
      </div>
    );
  }

  if (!detailData) return <></>;

  return (
    <div className="activity-detail-page-container">
      {/* 1. Header & Identity Section */}
      <ActivityHeader
        activity={detailData.activity}
        asOfDate={asOfDate}
        onDateChange={handleDateChange}
        onBack={onBack}
        isLoading={loading}
      />

      {/* 2. Current State Section */}
      <ActivityCurrentState
        activity={detailData.activity}
        current={detailData.current}
      />

      {/* 3. Chronological Observation Timeline */}
      <ActivityTimeline
        timeline={detailData.timeline}
        unit={detailData.activity.unit}
      />

      {/* 4. Originating Progress Reports */}
      <ActivityProgressSources
        progressUpdates={detailData.progressUpdates}
        onSelectUpdate={onSelectUpdate}
      />

      {/* 5. Match & Review Context */}
      <ActivityReviewContext
        matches={detailData.matches}
      />

      {/* 6. Originating Evidence */}
      <ActivityEvidence
        projectId={projectId}
        evidence={detailData.evidence}
      />
    </div>
  );
}
