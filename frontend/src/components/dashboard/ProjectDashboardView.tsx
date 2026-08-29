import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  AlertCircle,
  Calendar,
  Layers,
  ArrowRight,
  TrendingUp,
  ShieldAlert
} from 'lucide-react';
import { ProjectHealth } from './ProjectHealth.js';
import { ActivityStatusSummary } from './ActivityStatusSummary.js';
import { AttentionSummary } from './AttentionSummary.js';
import { MilestoneSummary } from './MilestoneSummary.js';
import { RecentUpdates, DashboardUpdateItem } from './RecentUpdates.js';

export interface ProjectDashboardData {
  project: {
    id: string;
    name: string;
    code: string;
    description: string | null;
    status: string;
    startDate: string | null;
    targetEndDate: string | null;
    createdAt: string;
    updatedAt: string;
  };
  health: {
    overallActualProgress: number;
    overallPlannedProgress: number;
    progressVariance: number;
    varianceState: 'ahead' | 'on_plan' | 'behind';
    overallRiskClassification: 'ON_TRACK' | 'AHEAD' | 'AT_RISK' | 'DELAYED' | 'COMPLETED';
    asOfDate: string;
    generatedAt: string;
  };
  activityStatus: {
    totalActivities: number;
    onTrack: number;
    ahead: number;
    atRisk: number;
    delayed: number;
    completed: number;
    overdueCount: number;
  };
  recentUpdates: DashboardUpdateItem[];
  milestones: {
    upcoming: Array<{
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
    }>;
    completed: Array<{
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
    }>;
    late: Array<{
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
    }>;
  };
  attention: {
    delayedCount: number;
    delayed: Array<{
      activityId: string;
      externalId: string;
      name: string;
      plannedFinish: string;
      actualProgress: number;
      progressVariance: number;
      reasons?: Array<{ code: string; message: string }>;
    }>;
    atRiskCount: number;
    atRisk: Array<{
      activityId: string;
      externalId: string;
      name: string;
      plannedFinish: string;
      actualProgress: number;
      progressVariance: number;
      reasons?: Array<{ code: string; message: string }>;
    }>;
    staleCount: number;
    stale: Array<{
      activityId: string;
      externalId: string;
      name: string;
      latestUpdateDate: string | null;
      daysSinceUpdate: number | null;
      hasAnyUpdate: boolean;
    }>;
    unresolvedMatchesCount: number;
    unresolvedMatches: Array<{
      matchId: string;
      progressUpdateId: string;
      activityId: string;
      activityExternalId: string;
      activityName: string;
      reportDate: string;
      reporterName: string | null;
      confidenceScore: number;
      confidenceTier: string | null;
      reviewState: string | null;
      rationale: string | null;
    }>;
  };
}

export interface ProjectDashboardViewProps {
  projectId: string;
  onNavigateTab: (
    tab: 'overview' | 'schedules' | 'progress' | 'evidence' | 'intelligence' | 'activity-detail',
    extra?: { updateId?: string; activityId?: string; statusFilter?: string }
  ) => void;
  onTraceEvidence?: (evidenceId?: string) => void;
  onSelectActivity?: (activityId: string) => void;
}

export function ProjectDashboardView({
  projectId,
  onNavigateTab,
  onTraceEvidence,
  onSelectActivity
}: ProjectDashboardViewProps): React.JSX.Element {
  const [dashboardData, setDashboardData] = useState<ProjectDashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [asOfDate, setAsOfDate] = useState<string>(new Date().toISOString().slice(0, 10));

  const fetchDashboard = useCallback(
    async (targetDate?: string) => {
      setLoading(true);
      setError(null);

      try {
        const queryParams = new URLSearchParams();
        if (targetDate) {
          queryParams.append('asOfDate', targetDate);
        }
        queryParams.append('recentLimit', '10');

        const res = await fetch(
          `/api/projects/${projectId}/dashboard?${queryParams.toString()}`
        );

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Failed to fetch project dashboard');
        }

        setDashboardData(data);
      } catch (err: any) {
        setError(err.message || 'An unexpected error occurred while loading dashboard.');
      } finally {
        setLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    fetchDashboard(asOfDate);
  }, [fetchDashboard, asOfDate]);

  const handleDateChange = (newDate: string) => {
    setAsOfDate(newDate);
    fetchDashboard(newDate);
  };

  if (loading && !dashboardData) {
    return (
      <div className="dashboard-loading-container">
        <RefreshCw size={28} className="pulse-dot" color="var(--accent-blue)" />
        <p className="loading-text">Composing Project Operational Snapshot...</p>
      </div>
    );
  }

  if (error && !dashboardData) {
    return (
      <div className="dashboard-error-card">
        <div className="dashboard-error-icon">
          <ShieldAlert size={28} color="var(--accent-rose)" />
        </div>
        <h3 className="error-title">Unable to Load Dashboard</h3>
        <p className="error-msg">{error}</p>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => fetchDashboard(asOfDate)}
        >
          <RefreshCw size={13} />
          <span>Retry Loading</span>
        </button>
      </div>
    );
  }

  if (!dashboardData) return <></>;

  return (
    <div className="project-dashboard-container">
      {/* Date Filter Toolbar */}
      <div className="dashboard-top-bar">
        <div className="dashboard-top-left">
          <span className="dashboard-hero-tag">Primary Operational Overview</span>
        </div>
        <div className="dashboard-date-selector-group">
          <Calendar size={14} color="var(--accent-blue)" />
          <label htmlFor="dashboard-as-of-date" className="date-selector-label">
            Snapshot Date:
          </label>
          <input
            id="dashboard-as-of-date"
            type="date"
            className="dashboard-date-input"
            value={asOfDate}
            onChange={(e) => handleDateChange(e.target.value)}
          />
        </div>
      </div>

      {/* 1. Project Health Section */}
      <ProjectHealth
        actualProgress={dashboardData.health.overallActualProgress}
        plannedProgress={dashboardData.health.overallPlannedProgress}
        variance={dashboardData.health.progressVariance}
        varianceState={dashboardData.health.varianceState}
        riskClassification={dashboardData.health.overallRiskClassification}
        asOfDate={dashboardData.health.asOfDate}
        projectName={dashboardData.project.name}
        projectCode={dashboardData.project.code}
        onRefresh={() => fetchDashboard(asOfDate)}
        isLoading={loading}
      />

      {/* 2. Activity Status Summary Section */}
      <ActivityStatusSummary
        counts={dashboardData.activityStatus}
        onSelectStatusFilter={(status) => {
          onNavigateTab('schedules', { statusFilter: status });
        }}
      />

      {/* 3. Two-Column Layout: Attention & Milestones */}
      <div className="dashboard-two-col-grid">
        {/* Left Column: Needs Attention */}
        <AttentionSummary
          delayedCount={dashboardData.attention.delayedCount}
          delayed={dashboardData.attention.delayed}
          atRiskCount={dashboardData.attention.atRiskCount}
          atRisk={dashboardData.attention.atRisk}
          staleCount={dashboardData.attention.staleCount}
          stale={dashboardData.attention.stale}
          unresolvedMatchesCount={dashboardData.attention.unresolvedMatchesCount}
          unresolvedMatches={dashboardData.attention.unresolvedMatches}
          onNavigateToIntelligence={() => onNavigateTab('intelligence')}
          onNavigateToProgressReview={(updateId) => onNavigateTab('progress', { updateId })}
          onNavigateToActivities={(activityId) => {
            if (activityId) {
              if (onSelectActivity) onSelectActivity(activityId);
              else onNavigateTab('activity-detail', { activityId });
            } else {
              onNavigateTab('schedules');
            }
          }}
        />

        {/* Right Column: Key Milestones */}
        <MilestoneSummary
          upcoming={dashboardData.milestones.upcoming}
          completed={dashboardData.milestones.completed}
          late={dashboardData.milestones.late}
          onSelectMilestone={(activityId) => {
            if (onSelectActivity) onSelectActivity(activityId);
            else onNavigateTab('activity-detail', { activityId });
          }}
        />
      </div>

      {/* 4. Recent Updates Section */}
      <RecentUpdates
        updates={dashboardData.recentUpdates}
        onSelectUpdateReview={(updateId) => onNavigateTab('progress', { updateId })}
        onTraceEvidence={onTraceEvidence}
        onViewAllUpdates={() => onNavigateTab('progress')}
        onSelectActivity={(activityId) => {
          if (onSelectActivity) onSelectActivity(activityId);
          else onNavigateTab('activity-detail', { activityId });
        }}
      />
    </div>
  );
}
