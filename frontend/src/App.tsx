import React, { useState, useEffect, useCallback } from 'react';
import {
  Layers,
  ShieldCheck,
  Plus,
  ArrowLeft,
  Calendar,
  Clock,
  FolderGit2,
  Edit3,
  Trash2,
  Search,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
  FileSpreadsheet,
  Activity,
  FileText,
  TrendingUp,
  Info,
  ChevronRight,
  UploadCloud,
  FileCheck,
  Check,
  AlertCircle,
  FileUp,
  User,
  Paperclip,
  ExternalLink,
  Bot,
  Send,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  MessageSquare
} from 'lucide-react';

export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed' | 'archived';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  code: string;
  status: ProjectStatus;
  startDate: string | null;
  targetEndDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Schedule {
  id: string;
  projectId: string;
  name: string;
  version: string;
  sourceType: 'csv' | 'xlsx' | 'p6' | 'manual';
  sourceFilename: string | null;
  isBaseline: boolean;
  importedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleActivity {
  id: string;
  projectId: string;
  scheduleId: string;
  externalId: string;
  name: string;
  description: string | null;
  wbsCode: string | null;
  location: string | null;
  plannedStart: string;
  plannedFinish: string;
  plannedQuantity: number | null;
  unit: string | null;
  baselineProgress: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImportSummary {
  schedule: Schedule;
  activitiesImported: number;
  rowCount: number;
  sourceType: string;
  originalFilename: string;
}

export interface ScheduleValidationIssue {
  code: string;
  message: string;
  rowNumber?: number;
  field?: string;
  value?: unknown;
}

export interface ProgressUpdate {
  id: string;
  projectId: string;
  reportDate: string;
  reporterName: string | null;
  reporterRole: string | null;
  sourceType: 'manual' | 'voice' | 'pdf' | 'xlsx' | 'image' | 'text';
  rawText: string;
  status: 'received' | 'processed' | 'reviewed';
  createdAt: string;
  updatedAt: string;
}

export interface Evidence {
  id: string;
  projectId: string;
  progressUpdateId: string | null;
  fileName: string;
  filePath: string;
  fileType: 'text' | 'xlsx' | 'pdf' | 'image' | 'transcript' | 'other';
  fileSizeBytes: number | null;
  mimeType: string | null;
  metadataJson: string | null;
  uploadedAt: string;
  createdAt: string;
}

export interface RiskReason {
  code: string;
  message: string;
}

export interface DelayedActivityFact {
  activityId: string;
  externalId: string;
  name: string;
  plannedFinish: string;
  actualProgress: number;
  progressVariance: number;
  overdue: boolean;
  classification: 'DELAYED';
  reasons: RiskReason[];
}

export interface AtRiskActivityFact {
  activityId: string;
  externalId: string;
  name: string;
  classification: 'AT_RISK';
  reasons: RiskReason[];
  plannedFinish: string;
  actualProgress: number;
  progressVariance: number;
}

export interface CompletedActivityFact {
  activityId: string;
  externalId: string;
  name: string;
  progressUpdateId: string | null;
  asOfDate: string;
  actualPercent: number;
  actualFinish: string | null;
  status: string;
}

export interface BehindScheduleActivityFact {
  activityId: string;
  externalId: string;
  name: string;
  plannedProgress: number;
  actualProgress: number;
  progressVariance: number;
  varianceState: string;
  status: string;
  plannedFinish: string;
  overdue: boolean;
}

export interface ApproachingMilestoneFact {
  activityId: string;
  externalId: string;
  name: string;
  milestoneDate: string;
  daysUntil: number;
  status: string;
  actualProgress: number;
}

export interface StaleActivityFact {
  activityId: string;
  externalId: string;
  name: string;
  latestUpdateDate: string | null;
  daysSinceUpdate: number | null;
  hasAnyUpdate: boolean;
}

export interface RecentChangeFact {
  eventId: string;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  createdAt: string;
  payload: Record<string, unknown> | null;
}

export interface ProjectIntelligence {
  projectId: string;
  asOfDate: string;
  generatedAt: string;
  delayed: DelayedActivityFact[];
  atRisk: AtRiskActivityFact[];
  completedToday: CompletedActivityFact[];
  behindSchedule: BehindScheduleActivityFact[];
  approachingMilestones: ApproachingMilestoneFact[];
  staleActivities: StaleActivityFact[];
  recentChanges: RecentChangeFact[];
}

export interface AssistantIntent {
  intent: string;
  activityQuery?: string | null;
  explicitDate?: string | null;
}

export interface VerifiedFact {
  ref: string;
  category: string;
  summary: string;
  activityId?: string | null;
  externalId?: string | null;
  activityName?: string | null;
  progressUpdateId?: string | null;
  evidenceId?: string | null;
  data: Record<string, unknown>;
}

export interface ResolvedActivityInfo {
  id: string;
  externalId: string;
  name: string;
  location: string | null;
}

export interface AssistantClaim {
  type: 'metric' | 'classification' | 'status' | 'date' | 'variance' | 'reason' | 'activity_identity';
  factRef: string;
  field: string;
  value: string | number | boolean;
  text: string;
  factRefs?: string[];
}

export interface AssistantQueryResponse {
  question: string;
  intent: AssistantIntent;
  resolvedActivity: ResolvedActivityInfo | null;
  ambiguousCandidates: ResolvedActivityInfo[] | null;
  answer: string;
  claims?: AssistantClaim[];
  factRefs: string[];
  grounded: boolean;
  status: 'success' | 'activity_not_found' | 'ambiguous_activity' | 'insufficient_data' | 'unsupported';
  asOfDate: string;
  verifiedFacts: VerifiedFact[];
}

interface HealthData {
  status: 'ok' | 'degraded' | 'error';
  service: string;
  version: string;
  timestamp: string;
  uptime: number;
  environment: string;
  database: {
    status: 'connected' | 'disconnected' | 'error';
    type: string;
    path: string;
  };
  metadata?: Record<string, string>;
}

const STORAGE_KEY_SELECTED_PROJECT = 'fieldline_selected_project_id';

export function App(): React.JSX.Element {
  // Projects State
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [loadingProjects, setLoadingProjects] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Workspace View State
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<
    'overview' | 'schedules' | 'progress' | 'evidence' | 'intelligence'
  >('overview');

  // FieldLine Assistant State (PASS 18)
  const [assistantQuestion, setAssistantQuestion] = useState<string>('');
  const [assistantLoading, setAssistantLoading] = useState<boolean>(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [assistantResponse, setAssistantResponse] = useState<AssistantQueryResponse | null>(null);
  const [showVerifiedFacts, setShowVerifiedFacts] = useState<boolean>(true);

  // Project Intelligence State (PASS 17)
  const [intelligence, setIntelligence] = useState<ProjectIntelligence | null>(null);
  const [loadingIntelligence, setLoadingIntelligence] = useState<boolean>(false);
  const [intelligenceError, setIntelligenceError] = useState<string | null>(null);
  const [intelligenceAsOfDate, setIntelligenceAsOfDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [intelligenceRecentDays, setIntelligenceRecentDays] = useState<number>(7);
  const [intelligenceApproachingDays, setIntelligenceApproachingDays] = useState<number>(14);

  // Schedules & Activities State
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
  const [activities, setActivities] = useState<ScheduleActivity[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState<boolean>(false);
  const [loadingActivities, setLoadingActivities] = useState<boolean>(false);

  // Progress Updates State (PASS 7)
  const [progressUpdates, setProgressUpdates] = useState<ProgressUpdate[]>([]);
  const [loadingProgressUpdates, setLoadingProgressUpdates] = useState<boolean>(false);
  const [reportFormData, setReportFormData] = useState({
    reportDate: new Date().toISOString().slice(0, 10),
    reporterName: '',
    reporterRole: '',
    rawText: ''
  });
  const [submittingReport, setSubmittingReport] = useState<boolean>(false);
  const [reportFormError, setReportFormError] = useState<string | null>(null);
  const [reportSuccessMessage, setReportSuccessMessage] = useState<string | null>(null);

  // Evidence State (PASS 13 & PASS 14)
  const [evidenceList, setEvidenceList] = useState<Evidence[]>([]);
  const [loadingEvidence, setLoadingEvidence] = useState<boolean>(false);
  const [evidenceUploadFile, setEvidenceUploadFile] = useState<File | null>(null);
  const [evidenceSelectedUpdateId, setEvidenceSelectedUpdateId] = useState<string>('');
  const [uploadingEvidence, setUploadingEvidence] = useState<boolean>(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [evidenceSuccess, setEvidenceSuccess] = useState<string | null>(null);
  const [processingEvidenceId, setProcessingEvidenceId] = useState<string | null>(null);
  const [processingStatusMap, setProcessingStatusMap] = useState<
    Record<string, 'processing' | 'processed' | 'failed'>
  >({});

  // Activity Evidence Traceability Modal State
  const [traceActivity, setTraceActivity] = useState<ScheduleActivity | null>(null);
  const [activityEvidenceList, setActivityEvidenceList] = useState<Evidence[]>([]);
  const [loadingActivityEvidence, setLoadingActivityEvidence] = useState<boolean>(false);

  // File Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<ScheduleValidationIssue[]>([]);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);

  // Modals & UI State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState<boolean>(false);
  const [formSubmitting, setFormSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    status: 'active' as ProjectStatus,
    startDate: '',
    targetEndDate: ''
  });

  // Notification Banner
  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // Backend Health Diagnostics
  const [health, setHealth] = useState<HealthData | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  // Show notification helper
  const showNotification = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification((prev) => (prev?.message === message ? null : prev));
    }, 5000);
  }, []);

  // Fetch Health
  const fetchHealth = useCallback(async () => {
    const start = performance.now();
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      const end = performance.now();
      if (res.ok) {
        setHealth(data);
        setLatency(Math.round(end - start));
      }
    } catch {
      setHealth(null);
    }
  }, []);

  // Fetch Schedule Activities
  const fetchActivities = useCallback(async (projectId: string, scheduleId: string) => {
    setLoadingActivities(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/schedules/${scheduleId}/activities`);
      const data = await res.json();
      if (res.ok) {
        setActivities(data.activities || []);
      } else {
        setActivities([]);
      }
    } catch {
      setActivities([]);
    } finally {
      setLoadingActivities(false);
    }
  }, []);

  // Fetch Project Schedules
  const fetchSchedules = useCallback(async (projectId: string, preferredScheduleId?: string) => {
    setLoadingSchedules(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/schedules`);
      const data = await res.json();
      if (res.ok) {
        const scheduleList: Schedule[] = data.schedules || [];
        setSchedules(scheduleList);

        if (scheduleList.length > 0) {
          const target = preferredScheduleId
            ? scheduleList.find((s) => s.id === preferredScheduleId) || scheduleList[0]
            : scheduleList[0];
          setSelectedSchedule(target);
          await fetchActivities(projectId, target.id);
        } else {
          setSelectedSchedule(null);
          setActivities([]);
        }
      }
    } catch {
      setSchedules([]);
      setSelectedSchedule(null);
      setActivities([]);
    } finally {
      setLoadingSchedules(false);
    }
  }, [fetchActivities]);

  // Fetch Project Progress Updates (PASS 7)
  const fetchProgressUpdates = useCallback(async (projectId: string) => {
    setLoadingProgressUpdates(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/progress-updates`);
      const data = await res.json();
      if (res.ok) {
        setProgressUpdates(data.progressUpdates || []);
      } else {
        setProgressUpdates([]);
      }
    } catch {
      setProgressUpdates([]);
    } finally {
      setLoadingProgressUpdates(false);
    }
  }, []);

  // Fetch Project Evidence (PASS 13)
  const fetchEvidence = useCallback(async (projectId: string) => {
    setLoadingEvidence(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/evidence`);
      const data = await res.json();
      if (res.ok) {
        setEvidenceList(data.evidence || []);
      } else {
        setEvidenceList([]);
      }
    } catch {
      setEvidenceList([]);
    } finally {
      setLoadingEvidence(false);
    }
  }, []);

  // Fetch Project Intelligence (PASS 17)
  const fetchIntelligence = useCallback(
    async (
      projectId: string,
      asOfDate?: string,
      recentDays?: number,
      approachingDays?: number
    ) => {
      setLoadingIntelligence(true);
      setIntelligenceError(null);
      try {
        const params = new URLSearchParams();
        if (asOfDate) params.set('asOfDate', asOfDate);
        if (recentDays !== undefined) params.set('recentDays', String(recentDays));
        if (approachingDays !== undefined)
          params.set('approachingDays', String(approachingDays));

        const res = await fetch(
          `/api/projects/${projectId}/intelligence?${params.toString()}`
        );
        const data = await res.json();
        if (res.ok) {
          setIntelligence(data);
        } else {
          setIntelligenceError(
            data.error?.message || 'Failed to fetch project intelligence facts'
          );
        }
      } catch {
        setIntelligenceError('Network error connecting to intelligence service');
      } finally {
        setLoadingIntelligence(false);
      }
    },
    []
  );

  // Fetch Projects and restore saved selection
  const fetchProjects = useCallback(async (preferredSelectId?: string) => {
    setLoadingProjects(true);
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load projects');
      }

      const projectList: Project[] = data.projects || [];
      setProjects(projectList);

      const targetId = preferredSelectId || localStorage.getItem(STORAGE_KEY_SELECTED_PROJECT);
      if (targetId) {
        const found = projectList.find((p) => p.id === targetId);
        if (found) {
          setSelectedProject(found);
          localStorage.setItem(STORAGE_KEY_SELECTED_PROJECT, found.id);
          fetchSchedules(found.id);
          fetchProgressUpdates(found.id);
          fetchEvidence(found.id);
          fetchIntelligence(found.id, intelligenceAsOfDate, intelligenceRecentDays, intelligenceApproachingDays);
        } else {
          localStorage.removeItem(STORAGE_KEY_SELECTED_PROJECT);
          setSelectedProject(null);
          if (targetId && !preferredSelectId) {
            showNotification('info', 'Previously selected project was not found; returned to project list.');
          }
        }
      } else {
        setSelectedProject(null);
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Error connecting to API server');
    } finally {
      setLoadingProjects(false);
    }
  }, [showNotification, fetchSchedules, fetchProgressUpdates, fetchEvidence, fetchIntelligence, intelligenceAsOfDate, intelligenceRecentDays, intelligenceApproachingDays]);

  // Initial load
  useEffect(() => {
    fetchHealth();
    fetchProjects();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [fetchHealth, fetchProjects]);

  // Handle Opening a Project
  const handleOpenProject = (project: Project) => {
    setSelectedProject(project);
    setActiveWorkspaceTab('overview');
    setSelectedFile(null);
    setUploadError(null);
    setImportSummary(null);
    setReportFormError(null);
    setReportSuccessMessage(null);
    setEvidenceError(null);
    setEvidenceSuccess(null);
    setEvidenceUploadFile(null);
    setProcessingEvidenceId(null);
    setProcessingStatusMap({});
    setReportFormData({
      reportDate: new Date().toISOString().slice(0, 10),
      reporterName: '',
      reporterRole: '',
      rawText: ''
    });
    localStorage.setItem(STORAGE_KEY_SELECTED_PROJECT, project.id);
    setAssistantQuestion('');
    setAssistantError(null);
    setAssistantResponse(null);
    fetchSchedules(project.id);
    fetchProgressUpdates(project.id);
    fetchEvidence(project.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Handle Returning to Project Selector
  const handleBackToProjects = () => {
    setSelectedProject(null);
    setSelectedSchedule(null);
    setSchedules([]);
    setActivities([]);
    setProgressUpdates([]);
    setEvidenceList([]);
    setSelectedFile(null);
    setEvidenceUploadFile(null);
    setUploadError(null);
    setImportSummary(null);
    setReportFormError(null);
    setReportSuccessMessage(null);
    setEvidenceError(null);
    setEvidenceSuccess(null);
    setProcessingEvidenceId(null);
    setProcessingStatusMap({});
    setTraceActivity(null);
    setAssistantQuestion('');
    setAssistantError(null);
    setAssistantResponse(null);
    localStorage.removeItem(STORAGE_KEY_SELECTED_PROJECT);
  };

  // Handle Asking FieldLine Assistant (PASS 18)
  const handleAskAssistant = async (overrideQuestion?: string) => {
    if (!selectedProject) return;
    const queryToAsk = (overrideQuestion || assistantQuestion).trim();
    if (!queryToAsk) return;

    setAssistantLoading(true);
    setAssistantError(null);
    if (overrideQuestion) {
      setAssistantQuestion(overrideQuestion);
    }

    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/assistant/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: queryToAsk,
          asOfDate: intelligenceAsOfDate
        })
      });

      const data = await res.json();
      if (res.ok) {
        setAssistantResponse(data);
      } else {
        const errorMsg = data.error?.message || data.error || 'Failed to query FieldLine assistant';
        setAssistantError(errorMsg);
        showNotification('error', errorMsg);
      }
    } catch {
      const netMsg = 'Network error connecting to FieldLine assistant service';
      setAssistantError(netMsg);
      showNotification('error', netMsg);
    } finally {
      setAssistantLoading(false);
    }
  };

  // Reset Create Form
  const openCreateModal = () => {
    setFormData({
      name: '',
      code: '',
      description: '',
      status: 'active',
      startDate: '',
      targetEndDate: ''
    });
    setFormError(null);
    setIsCreateModalOpen(true);
  };

  // Open Edit Form
  const openEditModal = () => {
    if (!selectedProject) return;
    setFormData({
      name: selectedProject.name,
      code: selectedProject.code,
      description: selectedProject.description || '',
      status: selectedProject.status,
      startDate: selectedProject.startDate ? selectedProject.startDate.slice(0, 10) : '',
      targetEndDate: selectedProject.targetEndDate ? selectedProject.targetEndDate.slice(0, 10) : ''
    });
    setFormError(null);
    setIsEditModalOpen(true);
  };

  // Submit Create Project
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.code.trim()) {
      setFormError('Project name and code are required.');
      return;
    }

    setFormSubmitting(true);
    setFormError(null);

    try {
      const payload = {
        name: formData.name.trim(),
        code: formData.code.trim().toUpperCase(),
        description: formData.description.trim() || null,
        status: formData.status,
        startDate: formData.startDate || null,
        targetEndDate: formData.targetEndDate || null
      };

      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create project');
      }

      const created: Project = data.project;
      setIsCreateModalOpen(false);
      showNotification('success', `Project "${created.name}" created successfully.`);

      await fetchProjects(created.id);
    } catch (err: any) {
      setFormError(err.message || 'An error occurred while creating project.');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Submit Edit Project
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;

    if (!formData.name.trim() || !formData.code.trim()) {
      setFormError('Project name and code are required.');
      return;
    }

    setFormSubmitting(true);
    setFormError(null);

    try {
      const payload = {
        name: formData.name.trim(),
        code: formData.code.trim().toUpperCase(),
        description: formData.description.trim() || null,
        status: formData.status,
        startDate: formData.startDate || null,
        targetEndDate: formData.targetEndDate || null
      };

      const res = await fetch(`/api/projects/${selectedProject.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to update project');
      }

      const updated: Project = data.project;
      setSelectedProject(updated);
      setIsEditModalOpen(false);
      showNotification('success', `Project "${updated.name}" updated successfully.`);

      await fetchProjects(updated.id);
    } catch (err: any) {
      setFormError(err.message || 'An error occurred while updating project.');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Submit Delete Project
  const handleDeleteSubmit = async () => {
    if (!selectedProject) return;

    setFormSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${selectedProject.id}`, {
        method: 'DELETE'
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete project');
      }

      const deletedName = selectedProject.name;
      setIsDeleteModalOpen(false);
      setSelectedProject(null);
      localStorage.removeItem(STORAGE_KEY_SELECTED_PROJECT);
      showNotification('success', `Project "${deletedName}" was deleted.`);

      await fetchProjects();
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to delete project.');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Drag & Drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (file: File) => {
    setUploadError(null);
    setValidationIssues([]);
    setImportSummary(null);

    const name = file.name.toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) {
      setUploadError('Unsupported file type. Please select a .csv or .xlsx schedule file.');
      setSelectedFile(null);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File size exceeds the 10MB limit.');
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  };

  // Schedule Import Upload Execution
  const handleImportSchedule = async () => {
    if (!selectedProject || !selectedFile) return;

    setIsUploading(true);
    setUploadError(null);
    setValidationIssues([]);
    setImportSummary(null);

    try {
      const formDataUpload = new FormData();
      formDataUpload.append('file', selectedFile);

      const res = await fetch(`/api/projects/${selectedProject.id}/schedules/import`, {
        method: 'POST',
        body: formDataUpload
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.details?.issues && Array.isArray(data.details.issues)) {
          setValidationIssues(data.details.issues);
        }
        throw new Error(data.error || 'Schedule import failed');
      }

      setImportSummary({
        schedule: data.schedule,
        activitiesImported: data.activitiesImported,
        rowCount: data.rowCount,
        sourceType: data.sourceType,
        originalFilename: data.originalFilename
      });

      setSelectedFile(null);
      showNotification('success', `Imported ${data.activitiesImported} activities from ${data.originalFilename}`);

      // Refresh project schedules
      await fetchSchedules(selectedProject.id, data.schedule.id);
    } catch (err: any) {
      setUploadError(err.message || 'An error occurred while importing schedule.');
    } finally {
      setIsUploading(false);
    }
  };

  // Switch Selected Schedule
  const handleSelectSchedule = (schedule: Schedule) => {
    setSelectedSchedule(schedule);
    if (selectedProject) {
      fetchActivities(selectedProject.id, schedule.id);
    }
  };

  // Format File Size
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Handle Manual Progress Report Submission (PASS 7)
  const handleProgressUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;

    if (!reportFormData.rawText.trim()) {
      setReportFormError('Report text cannot be empty or whitespace only');
      return;
    }

    setSubmittingReport(true);
    setReportFormError(null);
    setReportSuccessMessage(null);

    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/progress-updates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          reportDate: reportFormData.reportDate,
          reporterName: reportFormData.reporterName.trim() || undefined,
          reporterRole: reportFormData.reporterRole.trim() || undefined,
          rawText: reportFormData.rawText
        })
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMsg = data.error?.message || data.message || 'Failed to record progress update';
        setReportFormError(errorMsg);
        showNotification('error', errorMsg);
      } else {
        await fetchProgressUpdates(selectedProject.id);
        setReportFormData((prev) => ({
          ...prev,
          rawText: ''
        }));
        setReportSuccessMessage('Field progress report successfully recorded and persisted.');
        showNotification('success', 'Field update recorded successfully');
        setTimeout(() => setReportSuccessMessage(null), 5000);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Error recording field update';
      setReportFormError(errorMsg);
      showNotification('error', errorMsg);
    } finally {
      setSubmittingReport(false);
    }
  };

  // Handle Upload Evidence (PASS 13)
  const handleUploadEvidence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject || !evidenceUploadFile) return;

    setUploadingEvidence(true);
    setEvidenceError(null);
    setEvidenceSuccess(null);

    try {
      const formData = new FormData();
      formData.append('file', evidenceUploadFile);
      if (evidenceSelectedUpdateId) {
        formData.append('progressUpdateId', evidenceSelectedUpdateId);
      }

      const res = await fetch(`/api/projects/${selectedProject.id}/evidence`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to upload evidence');
      }

      setEvidenceUploadFile(null);
      setEvidenceSelectedUpdateId('');
      if (data.deduplicated) {
        setEvidenceSuccess(`Evidence file "${data.evidence.fileName}" deduplicated (reusing existing identical content in project).`);
        showNotification('info', `Evidence "${data.evidence.fileName}" deduplicated (existing content reused).`);
      } else {
        setEvidenceSuccess(`Evidence file "${data.evidence.fileName}" uploaded and persisted successfully.`);
        showNotification('success', `Evidence "${data.evidence.fileName}" uploaded.`);
      }
      await fetchEvidence(selectedProject.id);
      setTimeout(() => setEvidenceSuccess(null), 5000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error uploading evidence';
      setEvidenceError(msg);
      showNotification('error', msg);
    } finally {
      setUploadingEvidence(false);
    }
  };

  // Handle Delete Evidence (PASS 13)
  const handleDeleteEvidence = async (evidenceId: string) => {
    if (!selectedProject) return;
    if (!window.confirm('Are you sure you want to delete this evidence file?')) return;

    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/evidence/${evidenceId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        showNotification('success', 'Evidence file deleted.');
        await fetchEvidence(selectedProject.id);
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete evidence');
      }
    } catch (err: unknown) {
      showNotification('error', err instanceof Error ? err.message : 'Error deleting evidence');
    }
  };

  // Handle Process Evidence Document (PASS 15: Asynchronous In-Process Processing Job)
  const handleProcessEvidence = async (evidenceId: string) => {
    if (!selectedProject) return;

    setProcessingEvidenceId(evidenceId);
    setProcessingStatusMap((prev) => ({ ...prev, [evidenceId]: 'processing' }));
    setEvidenceError(null);
    setEvidenceSuccess(null);

    try {
      // 1. Enqueue job (HTTP 202 Accepted)
      const res = await fetch(`/api/projects/${selectedProject.id}/evidence/${evidenceId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await res.json();
      if (!res.ok) {
        const errorMsg = data.error?.message || data.error || data.message || 'Failed to enqueue processing job';
        throw new Error(errorMsg);
      }

      const jobId = data.job?.id;
      if (!jobId) {
        throw new Error('No processing job ID returned by backend');
      }

      // 2. Poll job status endpoint
      const maxAttempts = 120; // 120 seconds max timeout
      let attempts = 0;
      let isCompleted = false;

      while (attempts < maxAttempts && !isCompleted) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        attempts++;

        const jobRes = await fetch(`/api/projects/${selectedProject.id}/jobs/${jobId}`);
        if (!jobRes.ok) {
          const jobErrData = await jobRes.json().catch(() => ({}));
          throw new Error(jobErrData.error || `Failed to check status for job ${jobId}`);
        }

        const jobData = await jobRes.json();
        const job = jobData.job;

        if (!job) {
          throw new Error('Invalid job status response received');
        }

        if (job.status === 'completed') {
          isCompleted = true;
          setProcessingStatusMap((prev) => ({ ...prev, [evidenceId]: 'processed' }));
          const reportId = job.result?.progressUpdateId;
          const matchCount = job.result?.matchCount ?? 0;
          const reportSnippet = reportId ? ` (${reportId.slice(0, 8)}...)` : '';
          
          setEvidenceSuccess(
            `Evidence processed successfully! Created Field Progress Report${reportSnippet} with ${matchCount} suggested match${matchCount === 1 ? '' : 'es'}.`
          );
          showNotification(
            'success',
            `Evidence processed: ${matchCount} suggested match${matchCount === 1 ? '' : 'es'} created.`
          );

          // Refresh evidence list and progress updates
          await Promise.all([
            fetchEvidence(selectedProject.id),
            fetchProgressUpdates(selectedProject.id)
          ]);
        } else if (job.status === 'failed') {
          isCompleted = true;
          setProcessingStatusMap((prev) => ({ ...prev, [evidenceId]: 'failed' }));
          const errorMsg = job.errorMessage || 'Document processing failed';
          setEvidenceError(errorMsg);
          showNotification('error', errorMsg);
        }
        // If still 'queued' or 'processing', loop continues
      }

      if (!isCompleted) {
        setProcessingStatusMap((prev) => ({ ...prev, [evidenceId]: 'failed' }));
        const timeoutMsg = 'Job processing timed out after 120 seconds. Please check job status or try again.';
        setEvidenceError(timeoutMsg);
        showNotification('error', timeoutMsg);
      }
    } catch (err: unknown) {
      setProcessingStatusMap((prev) => ({ ...prev, [evidenceId]: 'failed' }));
      const msg = err instanceof Error ? err.message : 'Error processing evidence document';
      setEvidenceError(msg);
      showNotification('error', msg);
    } finally {
      setProcessingEvidenceId(null);
    }
  };

  // Trace Evidence for Activity (PASS 13)
  const handleOpenActivityTrace = async (activity: ScheduleActivity) => {
    if (!selectedProject) return;
    setTraceActivity(activity);
    setLoadingActivityEvidence(true);
    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/activities/${activity.id}/evidence`);
      const data = await res.json();
      if (res.ok) {
        setActivityEvidenceList(data.evidence || []);
      } else {
        setActivityEvidenceList([]);
      }
    } catch {
      setActivityEvidenceList([]);
    } finally {
      setLoadingActivityEvidence(false);
    }
  };

  // Filtered projects for search
  const filteredProjects = projects.filter((p) => {
    const query = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(query) ||
      p.code.toLowerCase().includes(query) ||
      (p.description && p.description.toLowerCase().includes(query)) ||
      p.status.toLowerCase().includes(query)
    );
  });

  const isOnline = health?.status === 'ok';

  return (
    <div className="container">
      {/* App Header */}
      <header className="app-header">
        <div className="brand-wrapper" onClick={handleBackToProjects}>
          <div className="logo-badge">
            <Layers size={24} color="#ffffff" />
          </div>
          <div>
            <h1 className="brand-title">FieldLine</h1>
            <p className="brand-tagline">
              Data Capture & Schedule-Linking Layer for Infrastructure Project Management
            </p>
          </div>
        </div>

        <div className="header-right">
          <button
            className="system-status-trigger"
            onClick={() => setIsDiagnosticsOpen(true)}
            title="Inspect system diagnostics and SQLite persistence"
          >
            <div className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
            <span>{isOnline ? 'System Online' : 'System Degraded'}</span>
            {latency !== null && <span style={{ opacity: 0.6 }}>({latency}ms)</span>}
          </button>
          <div className="badge-sih">
            <ShieldCheck size={14} />
            SIH 2026 &bull; SIH26122
          </div>
          <div className="badge-pass">
            Pass 7: Manual Progress Reporting
          </div>
        </div>
      </header>

      {/* Notification Banner */}
      {notification && (
        <div className={`notification-banner ${notification.type}`}>
          <div className="banner-content">
            {notification.type === 'success' && <CheckCircle2 size={18} />}
            {notification.type === 'error' && <AlertTriangle size={18} />}
            {notification.type === 'info' && <Info size={18} />}
            <span>{notification.message}</span>
          </div>
          <button
            className="banner-close"
            onClick={() => setNotification(null)}
            aria-label="Close notification"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Main Content Area */}
      {loadingProjects ? (
        <div className="empty-state-card">
          <div className="empty-icon-wrapper">
            <RefreshCw size={28} className="pulse-dot" />
          </div>
          <h2 className="empty-title">Loading FieldLine Projects...</h2>
          <p className="empty-desc">Connecting to local SQLite database service</p>
        </div>
      ) : selectedProject ? (
        /* ========================================================================= */
        /* CASE 3: OPENED PROJECT WORKSPACE                                          */
        /* ========================================================================= */
        <div className="workspace-view">
          {/* Workspace Header Card */}
          <div className="workspace-header-card">
            <div className="workspace-top-bar">
              <button
                id="back-to-projects-btn"
                className="back-btn"
                onClick={handleBackToProjects}
              >
                <ArrowLeft size={16} />
                <span>All Projects</span>
              </button>

              <div className="workspace-actions">
                <button
                  id="edit-project-btn"
                  className="btn btn-secondary btn-sm"
                  onClick={openEditModal}
                >
                  <Edit3 size={15} />
                  <span>Edit Metadata</span>
                </button>
                <button
                  id="delete-project-btn"
                  className="btn btn-danger btn-sm"
                  onClick={() => setIsDeleteModalOpen(true)}
                >
                  <Trash2 size={15} />
                  <span>Delete Project</span>
                </button>
              </div>
            </div>

            <div className="workspace-identity">
              <div className="workspace-title-section">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span className="workspace-code-badge">{selectedProject.code}</span>
                  <span className={`status-badge ${selectedProject.status}`}>
                    {selectedProject.status}
                  </span>
                </div>
                <h2 className="workspace-project-title">{selectedProject.name}</h2>
                {selectedProject.description ? (
                  <p className="workspace-project-desc">{selectedProject.description}</p>
                ) : (
                  <p className="workspace-project-desc" style={{ fontStyle: 'italic', opacity: 0.6 }}>
                    No project description provided.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Navigation Sub-Tabs */}
          <div className="workspace-tabs">
            <button
              className={`workspace-tab ${activeWorkspaceTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveWorkspaceTab('overview')}
            >
              <FolderGit2 size={16} />
              <span>Project Overview</span>
            </button>
            <button
              id="tab-schedules"
              className={`workspace-tab ${activeWorkspaceTab === 'schedules' ? 'active' : ''}`}
              onClick={() => setActiveWorkspaceTab('schedules')}
            >
              <FileSpreadsheet size={16} />
              <span>Schedules & Activities</span>
              {schedules.length > 0 && (
                <span className="status-badge active" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>
                  {schedules.length}
                </span>
              )}
            </button>
            <button
              id="tab-progress"
              className={`workspace-tab ${activeWorkspaceTab === 'progress' ? 'active' : ''}`}
              onClick={() => {
                setActiveWorkspaceTab('progress');
                if (selectedProject) {
                  fetchProgressUpdates(selectedProject.id);
                }
              }}
            >
              <Activity size={16} />
              <span>Progress Updates</span>
              {progressUpdates.length > 0 && (
                <span className="status-badge active" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>
                  {progressUpdates.length}
                </span>
              )}
            </button>
            <button
              id="tab-evidence"
              className={`workspace-tab ${activeWorkspaceTab === 'evidence' ? 'active' : ''}`}
              onClick={() => {
                setActiveWorkspaceTab('evidence');
                if (selectedProject) {
                  fetchEvidence(selectedProject.id);
                  fetchProgressUpdates(selectedProject.id);
                }
              }}
            >
              <FileText size={16} />
              <span>Evidence</span>
              {evidenceList.length > 0 && (
                <span className="status-badge active" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>
                  {evidenceList.length}
                </span>
              )}
            </button>
            <button
              id="tab-intelligence"
              className={`workspace-tab ${activeWorkspaceTab === 'intelligence' ? 'active' : ''}`}
              onClick={() => {
                setActiveWorkspaceTab('intelligence');
                if (selectedProject) {
                  fetchIntelligence(
                    selectedProject.id,
                    intelligenceAsOfDate,
                    intelligenceRecentDays,
                    intelligenceApproachingDays
                  );
                }
              }}
            >
              <TrendingUp size={16} />
              <span>Project Intelligence</span>
              {intelligence && (
                <span className="status-badge active" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>
                  {intelligence.delayed.length + intelligence.atRisk.length + intelligence.behindSchedule.length} Facts
                </span>
              )}
            </button>
          </div>

          {/* Tab Content */}
          {activeWorkspaceTab === 'overview' ? (
            /* Tab 1: Project Overview Content */
            <div className="workspace-content">
              {/* Metadata Grid */}
              <div className="meta-grid">
                <div className="meta-card">
                  <span className="meta-card-label">
                    <Activity size={14} color="var(--accent-blue)" />
                    Lifecycle Status
                  </span>
                  <div style={{ marginTop: '0.2rem' }}>
                    <span className={`status-badge ${selectedProject.status}`} style={{ fontSize: '0.85rem' }}>
                      {selectedProject.status}
                    </span>
                  </div>
                </div>

                <div className="meta-card">
                  <span className="meta-card-label">
                    <FolderGit2 size={14} color="var(--accent-cyan)" />
                    Unique Project Code
                  </span>
                  <span className="meta-card-value mono">{selectedProject.code}</span>
                </div>

                <div className="meta-card">
                  <span className="meta-card-label">
                    <Calendar size={14} color="var(--accent-emerald)" />
                    Planned Start Date
                  </span>
                  <span className="meta-card-value">
                    {selectedProject.startDate ? selectedProject.startDate.slice(0, 10) : 'Not set'}
                  </span>
                </div>

                <div className="meta-card">
                  <span className="meta-card-label">
                    <Calendar size={14} color="var(--accent-amber)" />
                    Target Completion Date
                  </span>
                  <span className="meta-card-value">
                    {selectedProject.targetEndDate ? selectedProject.targetEndDate.slice(0, 10) : 'Not set'}
                  </span>
                </div>

                <div className="meta-card">
                  <span className="meta-card-label">
                    <Clock size={14} color="var(--accent-indigo)" />
                    Created Timestamp
                  </span>
                  <span className="meta-card-value" style={{ fontSize: '0.9rem' }}>
                    {new Date(selectedProject.createdAt).toLocaleString()}
                  </span>
                </div>

                <div className="meta-card">
                  <span className="meta-card-label">
                    <Clock size={14} color="var(--accent-purple)" />
                    Last Updated
                  </span>
                  <span className="meta-card-value" style={{ fontSize: '0.9rem' }}>
                    {new Date(selectedProject.updatedAt).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Scope Card */}
              <div className="pass3-scope-card">
                <div className="pass3-scope-header">
                  <ShieldCheck size={18} />
                  <span>FieldLine Pass 7 Active Project Workspace</span>
                </div>
                <p className="pass3-scope-text">
                  This infrastructure project is fully registered in local SQLite persistence. Use the <strong>Schedules & Activities</strong> tab to import baseline schedules in <strong>.csv</strong> or <strong>.xlsx</strong> format, or switch to <strong>Progress Updates</strong> to record and persist raw manual field reports with verified data integrity.
                </p>
              </div>
            </div>
          ) : activeWorkspaceTab === 'schedules' ? (
            /* Tab 2: Schedules & Importer Content (PASS 4) */
            <div className="schedules-container">
              {/* Importer Section */}
              <div className="importer-card">
                <div className="importer-header">
                  <div className="importer-title-group">
                    <FileUp size={18} color="var(--accent-blue)" />
                    <h3 className="importer-title">Import Project Schedule</h3>
                  </div>
                  <div className="supported-formats-badge">
                    <FileSpreadsheet size={13} />
                    <span>CSV &bull; XLSX (Max 10MB)</span>
                  </div>
                </div>

                {/* Drag and Drop Zone */}
                <div
                  id="schedule-dropzone"
                  className={`dropzone ${dragActive ? 'drag-active' : ''}`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById('schedule-file-input')?.click()}
                >
                  <input
                    id="schedule-file-input"
                    type="file"
                    className="file-input-hidden"
                    accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                    onChange={handleFileInputChange}
                  />
                  <div className="dropzone-icon-wrapper">
                    <UploadCloud size={24} />
                  </div>
                  <h4 className="dropzone-title">
                    {selectedFile ? 'Change schedule file' : 'Click to select or drag and drop schedule file'}
                  </h4>
                  <p className="dropzone-desc">
                    FieldLine automatically maps column headers (Activity ID, Name, WBS, Location, Planned Start/Finish, Quantity, Unit).
                  </p>
                </div>

                {/* Selected File Bar */}
                {selectedFile && (
                  <div className="file-selected-bar">
                    <div className="file-info-group">
                      <div className="file-type-icon">
                        <FileCheck size={18} />
                      </div>
                      <div>
                        <div className="file-details-name">{selectedFile.name}</div>
                        <div className="file-details-meta">
                          {formatFileSize(selectedFile.size)} &bull; {selectedFile.name.endsWith('.csv') ? 'CSV File' : 'Excel Workbook'}
                        </div>
                      </div>
                    </div>

                    <div className="file-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setSelectedFile(null);
                          setUploadError(null);
                          setValidationIssues([]);
                        }}
                        disabled={isUploading}
                      >
                        Cancel
                      </button>
                      <button
                        id="submit-import-btn"
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={handleImportSchedule}
                        disabled={isUploading}
                      >
                        {isUploading ? (
                          <>
                            <RefreshCw size={14} className="pulse-dot" />
                            <span>Importing...</span>
                          </>
                        ) : (
                          <>
                            <FileUp size={14} />
                            <span>Import Schedule</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Validation Errors Box (PASS 6) */}
                {validationIssues.length > 0 ? (
                  <div className="validation-error-card">
                    <div className="validation-error-header">
                      <div className="validation-error-title-group">
                        <AlertCircle size={18} color="var(--accent-red)" />
                        <span>Schedule contains {validationIssues.length} validation error{validationIssues.length > 1 ? 's' : ''}</span>
                      </div>
                      <button
                        className="banner-close"
                        onClick={() => {
                          setValidationIssues([]);
                          setUploadError(null);
                        }}
                        aria-label="Close error"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="validation-issues-list">
                      {validationIssues.map((issue, idx) => (
                        <div key={idx} className="validation-issue-item">
                          <div className="validation-issue-meta">
                            {issue.rowNumber !== undefined && (
                              <span className="validation-row-badge">Row {issue.rowNumber}</span>
                            )}
                            {issue.field && (
                              <span className="validation-field-badge">{issue.field}</span>
                            )}
                            <span className="validation-code-badge">{issue.code}</span>
                          </div>
                          <div className="validation-issue-msg">{issue.message}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : uploadError && (
                  <div className="notification-banner error" style={{ marginTop: '1rem', marginBottom: '0' }}>
                    <div className="banner-content">
                      <AlertCircle size={18} />
                      <span>{uploadError}</span>
                    </div>
                    <button
                      className="banner-close"
                      onClick={() => setUploadError(null)}
                      aria-label="Close error"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}

                {/* Success Summary Banner */}
                {importSummary && (
                  <div className="import-summary-banner">
                    <div className="summary-details">
                      <div className="summary-icon">
                        <CheckCircle2 size={22} />
                      </div>
                      <div>
                        <div className="summary-text-main">
                          Import Complete: {importSummary.activitiesImported} activities persisted
                        </div>
                        <div className="summary-text-sub">
                          Schedule: <strong>{importSummary.schedule.name}</strong> &bull; Source: {importSummary.originalFilename} ({importSummary.sourceType.toUpperCase()}) &bull; Baseline: {importSummary.schedule.isBaseline ? 'Active' : 'No'}
                        </div>
                      </div>
                    </div>
                    <button
                      className="banner-close"
                      onClick={() => setImportSummary(null)}
                      aria-label="Dismiss summary"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
              </div>

              {/* Schedules and Activities View */}
              <div className="schedules-view-section">
                <div className="section-toolbar">
                  <div className="toolbar-left">
                    <h3 className="section-title">Schedule Activities</h3>
                    {selectedSchedule && (
                      <span className="status-badge active" style={{ fontSize: '0.8rem' }}>
                        {selectedSchedule.name} &bull; {activities.length} Work Items
                      </span>
                    )}
                  </div>

                  {/* Schedule Selector if multiple exist */}
                  {schedules.length > 1 && (
                    <div className="toolbar-right">
                      <label className="form-label" style={{ margin: 0, fontSize: '0.8rem' }}>Schedule:</label>
                      <select
                        className="form-select"
                        style={{ width: 'auto', padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
                        value={selectedSchedule?.id || ''}
                        onChange={(e) => {
                          const sched = schedules.find((s) => s.id === e.target.value);
                          if (sched) handleSelectSchedule(sched);
                        }}
                      >
                        {schedules.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.sourceType.toUpperCase()})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* If schedules exist */}
                {schedules.length > 0 ? (
                  <div className="activities-table-card">
                    {/* Schedule Metadata Bar */}
                    {selectedSchedule && (
                      <div className="schedules-selector-bar">
                        <div className="schedule-meta-pill">
                          <span className="meta-label">Source File:</span>
                          <span className="meta-val">{selectedSchedule.sourceFilename || 'Manual / Embedded'}</span>
                        </div>
                        <div className="schedule-meta-pill">
                          <span className="meta-label">Format:</span>
                          <span className="meta-val uppercase">{selectedSchedule.sourceType}</span>
                        </div>
                        <div className="schedule-meta-pill">
                          <span className="meta-label">Imported:</span>
                          <span className="meta-val">
                            {new Date(selectedSchedule.importedAt).toLocaleDateString()}
                          </span>
                        </div>
                        {selectedSchedule.isBaseline && (
                          <span className="status-badge active" style={{ fontSize: '0.75rem' }}>
                            Official Baseline
                          </span>
                        )}
                      </div>
                    )}

                    {/* Activity Verification Table */}
                    {loadingActivities ? (
                      <div style={{ padding: '2rem', textAlign: 'center' }}>
                        <RefreshCw size={20} className="pulse-dot" />
                        <p className="empty-desc" style={{ marginTop: '0.5rem' }}>Loading activities...</p>
                      </div>
                    ) : activities.length > 0 ? (
                      <div className="table-responsive">
                        <table className="activities-table">
                          <thead>
                            <tr>
                              <th>Activity ID</th>
                              <th>Activity Name</th>
                              <th>WBS</th>
                              <th>Location</th>
                              <th>Planned Start</th>
                              <th>Planned Finish</th>
                              <th style={{ textAlign: 'right' }}>Quantity</th>
                              <th>Unit</th>
                              <th style={{ textAlign: 'center' }}>Evidence</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activities.map((act) => (
                              <tr key={act.id}>
                                <td>
                                  <span className="act-id-cell">{act.externalId}</span>
                                </td>
                                <td style={{ fontWeight: 500 }}>{act.name}</td>
                                <td>
                                  {act.wbsCode ? (
                                    <span className="wbs-badge">{act.wbsCode}</span>
                                  ) : (
                                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                                  )}
                                </td>
                                <td>
                                  {act.location || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                </td>
                                <td>
                                  <span className="date-cell">{act.plannedStart}</span>
                                </td>
                                <td>
                                  <span className="date-cell">{act.plannedFinish}</span>
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                  {act.plannedQuantity !== null ? (
                                    <span className="qty-cell">
                                      {act.plannedQuantity.toLocaleString()}
                                    </span>
                                  ) : (
                                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                                  )}
                                </td>
                                <td>
                                  {act.unit || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', gap: '0.3rem', display: 'inline-flex', alignItems: 'center' }}
                                    onClick={() => handleOpenActivityTrace(act)}
                                    title="Trace originating evidence for this activity"
                                  >
                                    <Paperclip size={12} />
                                    <span>Trace</span>
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="empty-state-card" style={{ padding: '2rem 1rem' }}>
                        <p className="empty-desc">No activities found for this schedule.</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="empty-state-card">
                    <div className="empty-icon-wrapper">
                      <FileSpreadsheet size={32} />
                    </div>
                    <h3 className="empty-title">No Schedules Imported Yet</h3>
                    <p className="empty-desc">
                      Import your master construction schedule using the uploader above. FieldLine will extract all activity work items into the SQLite database.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : activeWorkspaceTab === 'progress' ? (
            /* Tab 3: Progress Updates Content (PASS 7) */
            <div className="progress-container">
              {/* Form Card: Record Manual Field Progress */}
              <div className="progress-form-card">
                <div className="progress-card-header">
                  <div className="progress-card-title-group">
                    <div className="progress-card-icon-badge">
                      <Activity size={18} color="var(--accent-blue)" />
                    </div>
                    <div>
                      <h3 className="progress-card-title">Record Manual Field Progress</h3>
                      <p className="progress-card-subtitle">
                        Capture ground-truth human updates with guaranteed raw-text preservation.
                      </p>
                    </div>
                  </div>
                  <div className="progress-mode-badge">
                    <ShieldCheck size={13} />
                    <span>PASS 7 &bull; Raw Data Capture</span>
                  </div>
                </div>

                {reportFormError && (
                  <div className="notification-banner error" style={{ marginBottom: '1rem' }}>
                    <AlertTriangle size={16} />
                    <span>{reportFormError}</span>
                  </div>
                )}

                {reportSuccessMessage && (
                  <div className="notification-banner success" style={{ marginBottom: '1rem' }}>
                    <CheckCircle2 size={16} />
                    <span>{reportSuccessMessage}</span>
                  </div>
                )}

                <form onSubmit={handleProgressUpdateSubmit}>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">
                        Report Date <span className="required-star">*</span>
                      </label>
                      <input
                        type="date"
                        className="form-input"
                        value={reportFormData.reportDate}
                        onChange={(e) =>
                          setReportFormData({ ...reportFormData, reportDate: e.target.value })
                        }
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Reporter Name (Optional)</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. Ramesh Deshmukh"
                        value={reportFormData.reporterName}
                        onChange={(e) =>
                          setReportFormData({ ...reportFormData, reporterName: e.target.value })
                        }
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Reporter Role (Optional)</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. Resident Site Engineer"
                        value={reportFormData.reporterRole}
                        onChange={(e) =>
                          setReportFormData({ ...reportFormData, reporterRole: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">
                      Field Observation / Shift Narrative <span className="required-star">*</span>
                    </label>
                    <textarea
                      id="progress-report-raw-text"
                      className="form-textarea"
                      placeholder="Enter raw field observation notes, work progress percentages, foundation pour logs, or inspection records..."
                      value={reportFormData.rawText}
                      onChange={(e) =>
                        setReportFormData({ ...reportFormData, rawText: e.target.value })
                      }
                      rows={4}
                      required
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                    <button
                      id="submit-progress-report-btn"
                      type="submit"
                      className="btn btn-primary"
                      disabled={submittingReport}
                    >
                      {submittingReport ? (
                        <>
                          <RefreshCw size={14} className="pulse-dot" />
                          <span>Persisting Field Update...</span>
                        </>
                      ) : (
                        <>
                          <FileUp size={14} />
                          <span>Submit Field Progress Report</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>

              {/* Progress Updates List */}
              <div className="progress-history-section">
                <div className="section-toolbar">
                  <div className="toolbar-left">
                    <h3 className="section-title">Field Progress History</h3>
                    <span className="status-badge active" style={{ fontSize: '0.8rem' }}>
                      {progressUpdates.length} {progressUpdates.length === 1 ? 'Report' : 'Reports'}
                    </span>
                  </div>
                  <div className="toolbar-right">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => selectedProject && fetchProgressUpdates(selectedProject.id)}
                      disabled={loadingProgressUpdates}
                    >
                      <RefreshCw size={14} className={loadingProgressUpdates ? 'pulse-dot' : ''} />
                      <span>Refresh Feed</span>
                    </button>
                  </div>
                </div>

                {loadingProgressUpdates ? (
                  <div style={{ padding: '3rem', textAlign: 'center' }}>
                    <RefreshCw size={24} className="pulse-dot" />
                    <p className="empty-desc" style={{ marginTop: '0.75rem' }}>Loading field updates...</p>
                  </div>
                ) : progressUpdates.length === 0 ? (
                  <div className="empty-state-card">
                    <div className="empty-icon-wrapper">
                      <Activity size={32} />
                    </div>
                    <h4 className="empty-title">No Field Reports Captured Yet</h4>
                    <p className="empty-desc">
                      Capture site observations, milestone completions, and shift summaries using the manual form above.
                    </p>
                  </div>
                ) : (
                  <div className="progress-updates-feed">
                    {progressUpdates.map((update) => (
                      <div key={update.id} className="progress-feed-item">
                        <div className="progress-item-header">
                          <div className="progress-item-meta-left">
                            <div className="progress-date-badge">
                              <Calendar size={13} />
                              <span>{update.reportDate}</span>
                            </div>

                            {update.reporterName ? (
                              <div className="progress-reporter-badge">
                                <User size={13} />
                                <span>{update.reporterName}</span>
                                {update.reporterRole && (
                                  <span className="reporter-role-tag">({update.reporterRole})</span>
                                )}
                              </div>
                            ) : (
                              <div className="progress-reporter-badge" style={{ opacity: 0.6 }}>
                                <User size={13} />
                                <span>Anonymous Field Reporter</span>
                              </div>
                            )}
                          </div>

                          <div className="progress-item-meta-right">
                            <span className="badge-source-manual">
                              Source: {update.sourceType.toUpperCase()}
                            </span>
                            <span className={`status-badge ${update.status === 'received' ? 'active' : 'planning'}`} style={{ textTransform: 'capitalize' }}>
                              {update.status}
                            </span>
                            <span className="progress-timestamp" title={`Stored at: ${update.createdAt}`}>
                              <Clock size={12} />
                              {new Date(update.createdAt).toLocaleString()}
                            </span>
                          </div>
                        </div>

                        <div className="progress-item-body">
                          <p className="progress-raw-text">{update.rawText}</p>
                        </div>

                        <div className="progress-item-footer">
                          <span className="progress-record-id mono">ID: {update.id}</span>
                          <span className="progress-pass-tag">Pass 7 Verified Raw Record &bull; Awaiting Pass 8 AI Extraction</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : activeWorkspaceTab === 'evidence' ? (
            /* Tab 4: Evidence System & Provenance (PASS 13) */
            <div className="evidence-container">
              {/* Evidence Upload Card */}
              <div className="evidence-uploader-card">
                <div className="progress-card-header" style={{ marginBottom: '1rem' }}>
                  <div>
                    <h3 className="section-title">Upload Project Evidence</h3>
                    <p className="section-subtitle">
                      Attach ground-truth site memos, inspection sign-offs, batch tickets, or drawings to this project.
                    </p>
                  </div>
                </div>

                {evidenceError && (
                  <div className="notification-banner error" style={{ marginBottom: '1rem' }}>
                    <AlertTriangle size={16} />
                    <span>{evidenceError}</span>
                  </div>
                )}

                {evidenceSuccess && (
                  <div className="notification-banner success" style={{ marginBottom: '1rem' }}>
                    <CheckCircle2 size={16} />
                    <span>{evidenceSuccess}</span>
                  </div>
                )}

                <form onSubmit={handleUploadEvidence}>
                  <div className="form-row" style={{ alignItems: 'flex-end', marginBottom: '1rem' }}>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">
                        Select Evidence File <span className="required-star">*</span>
                      </label>
                      <input
                        id="evidence-file-input"
                        type="file"
                        className="form-input"
                        onChange={(e) => {
                          if (e.target.files && e.target.files.length > 0) {
                            setEvidenceUploadFile(e.target.files[0]);
                          }
                        }}
                        required
                      />
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">
                        Attach to Field Progress Report (Optional)
                      </label>
                      <select
                        id="evidence-progress-update-select"
                        className="form-select"
                        value={evidenceSelectedUpdateId}
                        onChange={(e) => setEvidenceSelectedUpdateId(e.target.value)}
                      >
                        <option value="">None (Project-level Evidence)</option>
                        {progressUpdates.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.reportDate} — {u.reporterName || 'Anonymous'} ({u.rawText.slice(0, 35)}...)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group" style={{ flexShrink: 0 }}>
                      <button
                        id="submit-evidence-upload-btn"
                        type="submit"
                        className="btn btn-primary"
                        disabled={uploadingEvidence || !evidenceUploadFile}
                        style={{ height: '42px' }}
                      >
                        {uploadingEvidence ? (
                          <>
                            <RefreshCw size={16} className="pulse-dot" />
                            <span>Uploading...</span>
                          </>
                        ) : (
                          <>
                            <UploadCloud size={16} />
                            <span>Upload Evidence</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </form>
              </div>

              {/* Evidence Inventory */}
              <div className="evidence-inventory-section">
                <div className="section-toolbar" style={{ marginBottom: '1rem' }}>
                  <div className="toolbar-left">
                    <h3 className="section-title">Evidence Inventory</h3>
                    <span className="status-badge active" style={{ fontSize: '0.8rem' }}>
                      {evidenceList.length} {evidenceList.length === 1 ? 'file' : 'files'}
                    </span>
                  </div>
                  <div className="toolbar-right">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => selectedProject && fetchEvidence(selectedProject.id)}
                      disabled={loadingEvidence}
                    >
                      <RefreshCw size={14} className={loadingEvidence ? 'pulse-dot' : ''} />
                      <span>Refresh</span>
                    </button>
                  </div>
                </div>

                {loadingEvidence ? (
                  <div style={{ padding: '3rem', textAlign: 'center' }}>
                    <RefreshCw size={24} className="pulse-dot" />
                    <p className="empty-desc" style={{ marginTop: '0.75rem' }}>Loading project evidence...</p>
                  </div>
                ) : evidenceList.length === 0 ? (
                  <div className="empty-state-card">
                    <div className="empty-icon-wrapper">
                      <FileText size={32} />
                    </div>
                    <h4 className="empty-title">No Evidence Attached Yet</h4>
                    <p className="empty-desc">
                      Upload PDF blueprints, inspection tickets, site photos, or Excel logs above to establish traceable provenance.
                    </p>
                  </div>
                ) : (
                  <div className="evidence-grid">
                    {evidenceList.map((ev) => (
                      <div key={ev.id} className="evidence-card">
                        <div>
                          <div className="evidence-card-header">
                            <div className="evidence-title-group">
                              <FileText size={20} color="var(--accent-blue)" style={{ flexShrink: 0 }} />
                              <span className="evidence-file-name" title={ev.fileName}>
                                {ev.fileName}
                              </span>
                            </div>
                            <span className={`evidence-badge ${ev.fileType}`}>
                              {ev.fileType}
                            </span>
                          </div>

                          <div className="evidence-meta-list" style={{ marginTop: '0.75rem' }}>
                            <div className="evidence-meta-row">
                              <span style={{ color: 'var(--text-muted)' }}>Size:</span>
                              <span className="mono">{ev.fileSizeBytes !== null ? formatFileSize(ev.fileSizeBytes) : '—'}</span>
                            </div>
                            <div className="evidence-meta-row">
                              <span style={{ color: 'var(--text-muted)' }}>Uploaded:</span>
                              <span>{new Date(ev.uploadedAt).toLocaleString()}</span>
                            </div>
                            {ev.progressUpdateId && (
                              <div className="evidence-meta-row">
                                <span style={{ color: 'var(--text-muted)' }}>Report:</span>
                                <span className="mono" style={{ fontSize: '0.7rem' }}>{ev.progressUpdateId.slice(0, 12)}...</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="evidence-card-footer">
                          {['pdf', 'xlsx', 'image', 'text', 'transcript'].includes(ev.fileType) && (
                            <button
                              id={`process-evidence-btn-${ev.id}`}
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleProcessEvidence(ev.id)}
                              disabled={processingEvidenceId === ev.id}
                              style={{ gap: '0.35rem', fontSize: '0.75rem' }}
                              title="Extract document content and create progress update with AI facts"
                            >
                              {processingEvidenceId === ev.id ? (
                                <>
                                  <RefreshCw size={13} className="pulse-dot" />
                                  <span>Processing...</span>
                                </>
                              ) : processingStatusMap[ev.id] === 'processed' ? (
                                <>
                                  <CheckCircle2 size={13} color="var(--accent-emerald)" />
                                  <span>Processed</span>
                                </>
                              ) : processingStatusMap[ev.id] === 'failed' ? (
                                <>
                                  <AlertTriangle size={13} color="var(--accent-rose)" />
                                  <span>Retry Process</span>
                                </>
                              ) : (
                                <>
                                  <Activity size={13} />
                                  <span>Process</span>
                                </>
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => window.open(`/api/projects/${selectedProject.id}/evidence/${ev.id}/content`, '_blank')}
                            style={{ gap: '0.35rem', fontSize: '0.75rem' }}
                          >
                            <ExternalLink size={13} />
                            <span>Open Content</span>
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleDeleteEvidence(ev.id)}
                            style={{ color: 'var(--accent-rose)', borderColor: 'rgba(244, 63, 94, 0.2)' }}
                            title="Delete evidence record"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : activeWorkspaceTab === 'intelligence' ? (
            /* Tab 5: Project Intelligence Query Layer (PASS 17) */
            <div className="intelligence-container">
              {/* Controls Bar */}
              <div className="intelligence-controls-bar">
                <div className="intelligence-inputs-group">
                  <div className="intelligence-input-item">
                    <label htmlFor="intel-as-of-date">As-Of Date:</label>
                    <input
                      id="intel-as-of-date"
                      type="date"
                      className="form-input"
                      value={intelligenceAsOfDate}
                      onChange={(e) => setIntelligenceAsOfDate(e.target.value)}
                    />
                  </div>

                  <div className="intelligence-input-item">
                    <label htmlFor="intel-recent-days">Recent Window (Days):</label>
                    <input
                      id="intel-recent-days"
                      type="number"
                      min="1"
                      max="365"
                      className="form-input"
                      style={{ width: '80px' }}
                      value={intelligenceRecentDays}
                      onChange={(e) => setIntelligenceRecentDays(Number(e.target.value) || 1)}
                    />
                  </div>

                  <div className="intelligence-input-item">
                    <label htmlFor="intel-approaching-days">Approaching Window (Days):</label>
                    <input
                      id="intel-approaching-days"
                      type="number"
                      min="0"
                      max="365"
                      className="form-input"
                      style={{ width: '80px' }}
                      value={intelligenceApproachingDays}
                      onChange={(e) => setIntelligenceApproachingDays(Number(e.target.value) || 0)}
                    />
                  </div>
                </div>

                <button
                  id="query-intelligence-btn"
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    if (selectedProject) {
                      fetchIntelligence(
                        selectedProject.id,
                        intelligenceAsOfDate,
                        intelligenceRecentDays,
                        intelligenceApproachingDays
                      );
                    }
                  }}
                  disabled={loadingIntelligence}
                  style={{ gap: '0.4rem' }}
                >
                  <RefreshCw size={14} className={loadingIntelligence ? 'pulse-dot' : ''} />
                  <span>{loadingIntelligence ? 'Evaluating Facts...' : 'Refresh Intelligence'}</span>
                </button>
              </div>

              {intelligenceError && (
                <div className="notification-banner error">
                  <AlertCircle size={18} />
                  <span>{intelligenceError}</span>
                </div>
              )}

              {/* FieldLine Assistant Panel (PASS 18) */}
              <div className="assistant-panel-card" id="assistant-panel">
                <div className="assistant-header">
                  <div className="assistant-title-group">
                    <div className="assistant-icon-badge">
                      <Bot size={24} color="#6366f1" />
                    </div>
                    <div>
                      <h2 className="assistant-title">Ask FieldLine Assistant</h2>
                      <p className="assistant-subtitle">
                        Natural-language queries grounded strictly in verified Project Intelligence facts.
                      </p>
                    </div>
                  </div>
                  <span className="assistant-guard-badge">
                    <ShieldCheck size={14} />
                    Verified Facts &bull; Zero Hallucinations
                  </span>
                </div>

                <form
                  className="assistant-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAskAssistant();
                  }}
                >
                  <div className="assistant-input-wrapper">
                    <MessageSquare size={17} className="assistant-input-icon" />
                    <input
                      id="assistant-query-input"
                      type="text"
                      className="assistant-input"
                      placeholder="Ask anything (e.g. What is delayed? Why is Foundation B at risk? What changed today?)..."
                      value={assistantQuestion}
                      onChange={(e) => setAssistantQuestion(e.target.value)}
                      disabled={assistantLoading}
                    />
                  </div>
                  <button
                    id="assistant-ask-btn"
                    type="submit"
                    className="assistant-ask-btn"
                    disabled={assistantLoading || !assistantQuestion.trim()}
                  >
                    {assistantLoading ? (
                      <>
                        <RefreshCw size={16} className="pulse-dot" />
                        <span>Evaluating...</span>
                      </>
                    ) : (
                      <>
                        <Send size={16} />
                        <span>Ask</span>
                      </>
                    )}
                  </button>
                </form>

                {/* Quick Query Chips */}
                <div className="assistant-suggestions">
                  <span className="assistant-suggestions-label">Recent / Suggested:</span>
                  {[
                    'What is delayed?',
                    'Why is Foundation B at risk?',
                    'Which activities are most behind schedule?',
                    'What changed today?',
                    'Which milestones are approaching?',
                    'Which activities have no recent updates?'
                  ].map((q, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="assistant-chip"
                      onClick={() => handleAskAssistant(q)}
                      disabled={assistantLoading}
                    >
                      "{q}"
                    </button>
                  ))}
                </div>

                {/* Error Banner */}
                {assistantError && (
                  <div className="notification-banner error" style={{ margin: 0 }}>
                    <AlertCircle size={16} />
                    <span>{assistantError}</span>
                  </div>
                )}

                {/* Assistant Answer Response */}
                {assistantResponse && (
                  <div className="assistant-response-box" id="assistant-response-box">
                    <div className="assistant-response-meta">
                      <div className="assistant-meta-tags">
                        <span className="intent-pill">
                          Intent: {assistantResponse.intent.intent}
                        </span>

                        {assistantResponse.grounded ? (
                          <span className="grounding-pill success">
                            <CheckCircle2 size={13} />
                            Grounded ({assistantResponse.factRefs.length} Cited Facts)
                          </span>
                        ) : assistantResponse.status === 'unsupported' ? (
                          <span className="grounding-pill unsupported">
                            <HelpCircle size={13} />
                            Unsupported Question
                          </span>
                        ) : (
                          <span className="grounding-pill warning">
                            <AlertTriangle size={13} />
                            {assistantResponse.status === 'activity_not_found'
                              ? 'Activity Not Found'
                              : assistantResponse.status === 'ambiguous_activity'
                              ? 'Ambiguous Activity Match'
                              : 'Insufficient Facts'}
                          </span>
                        )}

                        {assistantResponse.resolvedActivity && (
                          <span className="format-tag" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
                            Target: {assistantResponse.resolvedActivity.name} ({assistantResponse.resolvedActivity.externalId})
                          </span>
                        )}
                      </div>

                      <span className="date-cell" style={{ fontSize: '0.75rem' }}>
                        Observed as-of {assistantResponse.asOfDate}
                      </span>
                    </div>

                    <div className="assistant-answer-body">
                      {assistantResponse.answer}
                    </div>

                    {/* Ambiguous Candidates Suggestion Box */}
                    {assistantResponse.ambiguousCandidates && assistantResponse.ambiguousCandidates.length > 0 && (
                      <div className="assistant-candidates-box">
                        <span className="assistant-candidates-title">
                          Multiple matching activities detected — select one to query:
                        </span>
                        <div className="assistant-candidates-list">
                          {assistantResponse.ambiguousCandidates.map((cand) => (
                            <button
                              key={cand.id}
                              type="button"
                              className="assistant-candidate-btn"
                              onClick={() => handleAskAssistant(`What is the status of ${cand.name}?`)}
                            >
                              {cand.name} ({cand.externalId})
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Verified Facts & Citations Accordion */}
                    {assistantResponse.verifiedFacts.length > 0 && (
                      <div className="assistant-facts-section">
                        <button
                          type="button"
                          className="assistant-facts-toggle"
                          onClick={() => setShowVerifiedFacts(!showVerifiedFacts)}
                        >
                          <span>
                            Verified Fact Set &amp; Citations ({assistantResponse.verifiedFacts.length})
                          </span>
                          {showVerifiedFacts ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </button>

                        {showVerifiedFacts && (
                          <div className="assistant-facts-grid">
                            {assistantResponse.verifiedFacts.map((fact) => (
                              <div key={fact.ref} className="assistant-fact-card">
                                <div className="assistant-fact-card-header">
                                  <span className="assistant-fact-ref-badge">{fact.ref}</span>
                                  {fact.externalId && (
                                    <span className="act-id-cell">{fact.externalId}</span>
                                  )}
                                  {fact.category && (
                                    <span className="format-tag" style={{ fontSize: '0.7rem' }}>
                                      {fact.category}
                                    </span>
                                  )}
                                </div>
                                <p className="assistant-fact-summary">{fact.summary}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {loadingIntelligence && !intelligence ? (
                <div style={{ padding: '3rem', textAlign: 'center' }}>
                  <RefreshCw size={24} className="pulse-dot" />
                  <p className="empty-desc" style={{ marginTop: '0.75rem' }}>
                    Computing deterministic project intelligence queries...
                  </p>
                </div>
              ) : intelligence ? (
                <>
                  {/* Summary Metrics Chips */}
                  <div className="intelligence-metrics-grid">
                    <div className="intelligence-metric-card delayed">
                      <span className="intelligence-metric-label">Delayed</span>
                      <span className="intelligence-metric-val">{intelligence.delayed.length}</span>
                    </div>

                    <div className="intelligence-metric-card at-risk">
                      <span className="intelligence-metric-label">At Risk</span>
                      <span className="intelligence-metric-val">{intelligence.atRisk.length}</span>
                    </div>

                    <div className="intelligence-metric-card behind">
                      <span className="intelligence-metric-label">Behind Schedule</span>
                      <span className="intelligence-metric-val">{intelligence.behindSchedule.length}</span>
                    </div>

                    <div className="intelligence-metric-card completed">
                      <span className="intelligence-metric-label">Completed ({intelligence.asOfDate})</span>
                      <span className="intelligence-metric-val">{intelligence.completedToday.length}</span>
                    </div>

                    <div className="intelligence-metric-card milestones">
                      <span className="intelligence-metric-label">Approaching Milestones</span>
                      <span className="intelligence-metric-val">{intelligence.approachingMilestones.length}</span>
                    </div>

                    <div className="intelligence-metric-card stale">
                      <span className="intelligence-metric-label">Stale Activities</span>
                      <span className="intelligence-metric-val">{intelligence.staleActivities.length}</span>
                    </div>

                    <div className="intelligence-metric-card events">
                      <span className="intelligence-metric-label">Recent Changes</span>
                      <span className="intelligence-metric-val">{intelligence.recentChanges.length}</span>
                    </div>
                  </div>

                  {/* 7 Structured Fact Sections */}
                  <div className="intelligence-sections-stack">
                    {/* Section 1: Delayed Activities */}
                    <div className="intelligence-card">
                      <div className="intelligence-card-header">
                        <div className="intelligence-card-title-group">
                          <AlertTriangle size={18} color="var(--accent-rose)" />
                          <h3 className="intelligence-card-title">1. Delayed Activities</h3>
                          <span className="intelligence-card-count">{intelligence.delayed.length}</span>
                        </div>
                        <span className="status-badge delayed" style={{ fontSize: '0.75rem' }}>
                          Objective Overdue (Finish &lt; {intelligence.asOfDate})
                        </span>
                      </div>

                      {intelligence.delayed.length === 0 ? (
                        <p className="empty-desc" style={{ padding: '0.5rem 0' }}>
                          No overdue/delayed activities detected as of {intelligence.asOfDate}.
                        </p>
                      ) : (
                        <div className="table-responsive">
                          <table className="activities-table">
                            <thead>
                              <tr>
                                <th>Activity ID</th>
                                <th>Name</th>
                                <th>Planned Finish</th>
                                <th>Actual Progress</th>
                                <th>Variance</th>
                                <th>Classification Reasons</th>
                              </tr>
                            </thead>
                            <tbody>
                              {intelligence.delayed.map((d) => (
                                <tr key={d.activityId}>
                                  <td><span className="act-id-cell">{d.externalId}</span></td>
                                  <td><strong>{d.name}</strong></td>
                                  <td><span className="date-cell">{d.plannedFinish}</span></td>
                                  <td><span className="qty-cell">{d.actualProgress}%</span></td>
                                  <td>
                                    <span style={{ color: 'var(--accent-rose)', fontWeight: 600 }}>
                                      {d.progressVariance}%
                                    </span>
                                  </td>
                                  <td>
                                    <div className="reasons-tags-list">
                                      {d.reasons.map((r, idx) => (
                                        <span key={idx} className="reason-tag-item">{r.message}</span>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Section 2: At-Risk Activities */}
                    <div className="intelligence-card">
                      <div className="intelligence-card-header">
                        <div className="intelligence-card-title-group">
                          <AlertCircle size={18} color="var(--accent-amber)" />
                          <h3 className="intelligence-card-title">2. At-Risk Activities</h3>
                          <span className="intelligence-card-count">{intelligence.atRisk.length}</span>
                        </div>
                        <span className="status-badge" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', fontSize: '0.75rem' }}>
                          Variance &le; -10% or Near Finish Window
                        </span>
                      </div>

                      {intelligence.atRisk.length === 0 ? (
                        <p className="empty-desc" style={{ padding: '0.5rem 0' }}>
                          No activities classified as at-risk as of {intelligence.asOfDate}.
                        </p>
                      ) : (
                        <div className="table-responsive">
                          <table className="activities-table">
                            <thead>
                              <tr>
                                <th>Activity ID</th>
                                <th>Name</th>
                                <th>Planned Finish</th>
                                <th>Actual Progress</th>
                                <th>Variance</th>
                                <th>Risk Signals</th>
                              </tr>
                            </thead>
                            <tbody>
                              {intelligence.atRisk.map((r) => (
                                <tr key={r.activityId}>
                                  <td><span className="act-id-cell">{r.externalId}</span></td>
                                  <td><strong>{r.name}</strong></td>
                                  <td><span className="date-cell">{r.plannedFinish}</span></td>
                                  <td><span className="qty-cell">{r.actualProgress}%</span></td>
                                  <td>
                                    <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>
                                      {r.progressVariance}%
                                    </span>
                                  </td>
                                  <td>
                                    <div className="reasons-tags-list">
                                      {r.reasons.map((reason, idx) => (
                                        <span key={idx} className="reason-tag-item" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#fcd34d', borderColor: 'rgba(245, 158, 11, 0.25)' }}>
                                          {reason.message}
                                        </span>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Section 3: Behind Schedule */}
                    <div className="intelligence-card">
                      <div className="intelligence-card-header">
                        <div className="intelligence-card-title-group">
                          <TrendingUp size={18} color="#fb923c" />
                          <h3 className="intelligence-card-title">3. Behind Schedule Activities</h3>
                          <span className="intelligence-card-count">{intelligence.behindSchedule.length}</span>
                        </div>
                        <span className="status-badge" style={{ background: 'rgba(251, 146, 60, 0.15)', color: '#fb923c', fontSize: '0.75rem' }}>
                          Variance &lt; -0.01%
                        </span>
                      </div>

                      {intelligence.behindSchedule.length === 0 ? (
                        <p className="empty-desc" style={{ padding: '0.5rem 0' }}>
                          All project activities are on-plan or ahead of planned schedule as of {intelligence.asOfDate}.
                        </p>
                      ) : (
                        <div className="table-responsive">
                          <table className="activities-table">
                            <thead>
                              <tr>
                                <th>Activity ID</th>
                                <th>Name</th>
                                <th>Planned %</th>
                                <th>Actual %</th>
                                <th>Variance</th>
                                <th>Execution Status</th>
                                <th>Planned Finish</th>
                              </tr>
                            </thead>
                            <tbody>
                              {intelligence.behindSchedule.map((b) => (
                                <tr key={b.activityId}>
                                  <td><span className="act-id-cell">{b.externalId}</span></td>
                                  <td><strong>{b.name}</strong></td>
                                  <td><span className="date-cell">{b.plannedProgress}%</span></td>
                                  <td><span className="qty-cell">{b.actualProgress}%</span></td>
                                  <td>
                                    <span style={{ color: '#fb923c', fontWeight: 600 }}>
                                      {b.progressVariance}%
                                    </span>
                                  </td>
                                  <td><span className="format-tag">{b.status}</span></td>
                                  <td><span className="date-cell">{b.plannedFinish}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Section 4: Completed on Selected Date */}
                    <div className="intelligence-card">
                      <div className="intelligence-card-header">
                        <div className="intelligence-card-title-group">
                          <CheckCircle2 size={18} color="var(--accent-emerald)" />
                          <h3 className="intelligence-card-title">4. Completed on Selected Date</h3>
                          <span className="intelligence-card-count">{intelligence.completedToday.length}</span>
                        </div>
                        <span className="status-badge active" style={{ fontSize: '0.75rem' }}>
                          Observed as-of {intelligence.asOfDate}
                        </span>
                      </div>

                      {intelligence.completedToday.length === 0 ? (
                        <p className="empty-desc" style={{ padding: '0.5rem 0' }}>
                          No activities recorded completion observations on {intelligence.asOfDate}.
                        </p>
                      ) : (
                        <div className="table-responsive">
                          <table className="activities-table">
                            <thead>
                              <tr>
                                <th>Activity ID</th>
                                <th>Name</th>
                                <th>Progress Update ID</th>
                                <th>Observation Date</th>
                                <th>Actual Progress</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {intelligence.completedToday.map((c) => (
                                <tr key={c.activityId}>
                                  <td><span className="act-id-cell">{c.externalId}</span></td>
                                  <td><strong>{c.name}</strong></td>
                                  <td><span className="mono" style={{ fontSize: '0.75rem', opacity: 0.8 }}>{c.progressUpdateId || 'Direct'}</span></td>
                                  <td><span className="date-cell">{c.asOfDate}</span></td>
                                  <td><span className="qty-cell">{c.actualPercent}%</span></td>
                                  <td><span className="baseline-tag">{c.status}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Section 5: Approaching Milestones */}
                    <div className="intelligence-card">
                      <div className="intelligence-card-header">
                        <div className="intelligence-card-title-group">
                          <Calendar size={18} color="var(--accent-cyan)" />
                          <h3 className="intelligence-card-title">5. Approaching Milestones</h3>
                          <span className="intelligence-card-count">{intelligence.approachingMilestones.length}</span>
                        </div>
                        <span className="status-badge" style={{ background: 'rgba(6, 182, 212, 0.15)', color: '#22d3ee', fontSize: '0.75rem' }}>
                          Zero-duration within {intelligenceApproachingDays} days
                        </span>
                      </div>

                      {intelligence.approachingMilestones.length === 0 ? (
                        <p className="empty-desc" style={{ padding: '0.5rem 0' }}>
                          No milestones approaching within the next {intelligenceApproachingDays} days from {intelligence.asOfDate}.
                        </p>
                      ) : (
                        <div className="table-responsive">
                          <table className="activities-table">
                            <thead>
                              <tr>
                                <th>Milestone ID</th>
                                <th>Name</th>
                                <th>Milestone Date</th>
                                <th>Days Until</th>
                                <th>Progress</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {intelligence.approachingMilestones.map((m) => (
                                <tr key={m.activityId}>
                                  <td><span className="act-id-cell">{m.externalId}</span></td>
                                  <td><strong>{m.name}</strong></td>
                                  <td><span className="date-cell">{m.milestoneDate}</span></td>
                                  <td>
                                    <span className="format-tag" style={{ background: 'rgba(6, 182, 212, 0.15)', color: '#67e8f9', fontWeight: 700 }}>
                                      {m.daysUntil} day{m.daysUntil !== 1 ? 's' : ''}
                                    </span>
                                  </td>
                                  <td><span className="qty-cell">{m.actualProgress}%</span></td>
                                  <td><span className="format-tag">{m.status}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Section 6: Activities With No Recent Updates (Stale) */}
                    <div className="intelligence-card">
                      <div className="intelligence-card-header">
                        <div className="intelligence-card-title-group">
                          <Clock size={18} color="#c084fc" />
                          <h3 className="intelligence-card-title">6. Stale Activities (No Recent Updates)</h3>
                          <span className="intelligence-card-count">{intelligence.staleActivities.length}</span>
                        </div>
                        <span className="status-badge" style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', fontSize: '0.75rem' }}>
                          Older than {intelligenceRecentDays} days or never updated
                        </span>
                      </div>

                      {intelligence.staleActivities.length === 0 ? (
                        <p className="empty-desc" style={{ padding: '0.5rem 0' }}>
                          All project activities have progress reports within the last {intelligenceRecentDays} days.
                        </p>
                      ) : (
                        <div className="table-responsive">
                          <table className="activities-table">
                            <thead>
                              <tr>
                                <th>Activity ID</th>
                                <th>Name</th>
                                <th>Latest Observation Date</th>
                                <th>Days Since Update</th>
                                <th>Monitoring Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {intelligence.staleActivities.map((s) => (
                                <tr key={s.activityId}>
                                  <td><span className="act-id-cell">{s.externalId}</span></td>
                                  <td><strong>{s.name}</strong></td>
                                  <td><span className="date-cell">{s.latestUpdateDate || 'None recorded'}</span></td>
                                  <td>
                                    <span className="date-cell">
                                      {s.daysSinceUpdate !== null ? `${s.daysSinceUpdate} days ago` : '—'}
                                    </span>
                                  </td>
                                  <td>
                                    {s.hasAnyUpdate ? (
                                      <span className="format-tag" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24' }}>
                                        Observation Stale
                                      </span>
                                    ) : (
                                      <span className="format-tag" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171' }}>
                                        Never Updated
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Section 7: Recent Project Changes */}
                    <div className="intelligence-card">
                      <div className="intelligence-card-header">
                        <div className="intelligence-card-title-group">
                          <FileText size={18} color="var(--accent-indigo)" />
                          <h3 className="intelligence-card-title">7. Recent Project Changes</h3>
                          <span className="intelligence-card-count">{intelligence.recentChanges.length}</span>
                        </div>
                        <span className="status-badge" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#a5b4fc', fontSize: '0.75rem' }}>
                          Bounded Project Event Stream
                        </span>
                      </div>

                      {intelligence.recentChanges.length === 0 ? (
                        <p className="empty-desc" style={{ padding: '0.5rem 0' }}>
                          No project events recorded in the {intelligenceRecentDays}-day window prior to {intelligence.asOfDate}.
                        </p>
                      ) : (
                        <div className="table-responsive">
                          <table className="activities-table">
                            <thead>
                              <tr>
                                <th>Timestamp</th>
                                <th>Event Type</th>
                                <th>Summary</th>
                                <th>Structured Payload</th>
                              </tr>
                            </thead>
                            <tbody>
                              {intelligence.recentChanges.map((evt) => (
                                <tr key={evt.eventId}>
                                  <td><span className="date-cell">{evt.createdAt}</span></td>
                                  <td><span className="format-tag" style={{ color: '#93c5fd' }}>{evt.eventType}</span></td>
                                  <td><strong>{evt.summary}</strong></td>
                                  <td style={{ maxWidth: '300px' }}>
                                    {evt.payload ? (
                                      <div className="payload-preview-box">
                                        {JSON.stringify(evt.payload, null, 2)}
                                      </div>
                                    ) : (
                                      <span className="date-cell">—</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : projects.length === 0 ? (
        /* ========================================================================= */
        /* CASE 1: NO PROJECTS (EMPTY STATE)                                         */
        /* ========================================================================= */
        <div className="empty-state-card">
          <div className="empty-icon-wrapper">
            <FolderGit2 size={32} />
          </div>
          <h2 className="empty-title">No Projects Found</h2>
          <p className="empty-desc">
            FieldLine needs at least one infrastructure project to begin tracking schedules and field progress. Create your first project below.
          </p>
          <button
            id="create-first-project-btn"
            className="btn btn-primary"
            onClick={openCreateModal}
          >
            <Plus size={16} />
            <span>Create Project</span>
          </button>
        </div>
      ) : (
        /* ========================================================================= */
        /* CASE 2: PROJECT SELECTION SCREEN / LIST                                   */
        /* ========================================================================= */
        <div className="project-selector-view">
          <div className="section-toolbar">
            <div className="toolbar-title-group">
              <h2 className="section-title">
                <FolderGit2 size={22} color="var(--accent-blue)" />
                Infrastructure Projects
              </h2>
              <span className="section-subtitle">
                {projects.length} registered {projects.length === 1 ? 'project' : 'projects'} available
              </span>
            </div>

            <div className="toolbar-actions">
              <div className="search-input-wrapper">
                <Search size={15} className="search-icon" />
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search by name, code..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <button
                id="create-project-btn"
                className="btn btn-primary"
                onClick={openCreateModal}
              >
                <Plus size={16} />
                <span>New Project</span>
              </button>
            </div>
          </div>

          {filteredProjects.length === 0 ? (
            <div className="empty-state-card" style={{ padding: '3rem 1.5rem' }}>
              <p className="empty-desc" style={{ marginBottom: '1rem' }}>
                No projects matched your search query "{searchQuery}".
              </p>
              <button className="btn btn-secondary btn-sm" onClick={() => setSearchQuery('')}>
                Clear Search
              </button>
            </div>
          ) : (
            <div className="projects-grid">
              {filteredProjects.map((project) => (
                <div
                  key={project.id}
                  className="project-card"
                  onClick={() => handleOpenProject(project)}
                >
                  <div className="project-card-header">
                    <div className="project-card-title-group">
                      <span className="project-code-tag">{project.code}</span>
                      <h3 className="project-card-name">{project.name}</h3>
                    </div>
                    <span className={`status-badge ${project.status}`}>
                      {project.status}
                    </span>
                  </div>

                  <p className="project-card-desc">
                    {project.description || 'No description provided for this infrastructure project.'}
                  </p>

                  <div className="project-card-meta">
                    <div className="meta-row">
                      <span className="meta-item-with-icon">
                        <Calendar size={13} />
                        Planned Start
                      </span>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {project.startDate ? project.startDate.slice(0, 10) : 'Not specified'}
                      </span>
                    </div>

                    <div className="meta-row">
                      <span className="meta-item-with-icon">
                        <Calendar size={13} />
                        Target Completion
                      </span>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {project.targetEndDate ? project.targetEndDate.slice(0, 10) : 'Not specified'}
                      </span>
                    </div>
                  </div>

                  <div className="project-card-footer">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenProject(project);
                      }}
                    >
                      <span>Open Workspace</span>
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer Banner */}
      <footer className="footer-banner">
        <div className="footer-text">
          <strong>FieldLine Local Monolith</strong> &bull; Problem Statement SIH26122 &bull; Local SQLite WAL
        </div>
        <div className="footer-actions">
          <span className="footer-link">Database: {envDatabaseDisplay(health)}</span>
          <span className="footer-link">Port: 3001</span>
        </div>
      </footer>

      {/* Modal: Create Project */}
      {isCreateModalOpen && (
        <div className="modal-overlay" onClick={() => !formSubmitting && setIsCreateModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Create Infrastructure Project</h3>
              <button
                className="modal-close-btn"
                onClick={() => setIsCreateModalOpen(false)}
                disabled={formSubmitting}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit}>
              <div className="modal-body">
                {formError && (
                  <div className="notification-banner error" style={{ marginBottom: '1rem' }}>
                    <AlertTriangle size={16} />
                    <span>{formError}</span>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">
                    Project Name <span className="required-star">*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Mumbai Coastal Road Package 1"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    autoFocus
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">
                      Project Code <span className="required-star">*</span>
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. MCR-PKG1"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Lifecycle Status</label>
                    <select
                      className="form-select"
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as ProjectStatus })}
                    >
                      <option value="planning">Planning</option>
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="completed">Completed</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Project Scope / Description</label>
                  <textarea
                    className="form-textarea"
                    placeholder="Provide a detailed scope summary of the infrastructure project..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Planned Start Date</label>
                    <input
                      type="date"
                      className="form-input"
                      value={formData.startDate}
                      onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Target Completion Date</label>
                    <input
                      type="date"
                      className="form-input"
                      value={formData.targetEndDate}
                      onChange={(e) => setFormData({ ...formData, targetEndDate: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsCreateModalOpen(false)}
                  disabled={formSubmitting}
                >
                  Cancel
                </button>
                <button
                  id="submit-create-project-btn"
                  type="submit"
                  className="btn btn-primary"
                  disabled={formSubmitting}
                >
                  {formSubmitting ? 'Creating Project...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Project */}
      {isEditModalOpen && selectedProject && (
        <div className="modal-overlay" onClick={() => !formSubmitting && setIsEditModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Edit Project Metadata</h3>
              <button
                className="modal-close-btn"
                onClick={() => setIsEditModalOpen(false)}
                disabled={formSubmitting}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit}>
              <div className="modal-body">
                {formError && (
                  <div className="notification-banner error" style={{ marginBottom: '1rem' }}>
                    <AlertTriangle size={16} />
                    <span>{formError}</span>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">
                    Project Name <span className="required-star">*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">
                      Project Code <span className="required-star">*</span>
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Lifecycle Status</label>
                    <select
                      className="form-select"
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as ProjectStatus })}
                    >
                      <option value="planning">Planning</option>
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="completed">Completed</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Project Scope / Description</label>
                  <textarea
                    className="form-textarea"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Planned Start Date</label>
                    <input
                      type="date"
                      className="form-input"
                      value={formData.startDate}
                      onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Target Completion Date</label>
                    <input
                      type="date"
                      className="form-input"
                      value={formData.targetEndDate}
                      onChange={(e) => setFormData({ ...formData, targetEndDate: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsEditModalOpen(false)}
                  disabled={formSubmitting}
                >
                  Cancel
                </button>
                <button
                  id="submit-edit-project-btn"
                  type="submit"
                  className="btn btn-primary"
                  disabled={formSubmitting}
                >
                  {formSubmitting ? 'Saving Changes...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Project Confirmation */}
      {isDeleteModalOpen && selectedProject && (
        <div className="modal-overlay" onClick={() => !formSubmitting && setIsDeleteModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: 'var(--accent-rose)' }}>
                Delete Project
              </h3>
              <button
                className="modal-close-btn"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={formSubmitting}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <p style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
                Are you sure you want to permanently delete <strong>{selectedProject.name}</strong> ({selectedProject.code})?
              </p>
              <div className="notification-banner error" style={{ margin: 0 }}>
                <AlertTriangle size={16} />
                <span>
                  All associated schedules, activities, and linked progress data in SQLite will be cascade deleted.
                </span>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={formSubmitting}
              >
                Cancel
              </button>
              <button
                id="confirm-delete-project-btn"
                type="button"
                className="btn btn-danger"
                onClick={handleDeleteSubmit}
                disabled={formSubmitting}
              >
                {formSubmitting ? 'Deleting...' : 'Delete Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Activity Evidence Provenance (PASS 13) */}
      {traceActivity && selectedProject && (
        <div className="modal-overlay" onClick={() => setTraceActivity(null)}>
          <div className="modal-card" style={{ maxWidth: '650px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Paperclip size={18} color="var(--accent-blue)" />
                  <span>Activity Evidence Provenance</span>
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  Trace all ground-truth evidence linked to <strong>{traceActivity.externalId} — {traceActivity.name}</strong>
                </p>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setTraceActivity(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              {loadingActivityEvidence ? (
                <div style={{ padding: '2rem', textAlign: 'center' }}>
                  <RefreshCw size={20} className="pulse-dot" />
                  <p className="empty-desc" style={{ marginTop: '0.5rem' }}>Tracing originating evidence...</p>
                </div>
              ) : activityEvidenceList.length === 0 ? (
                <div className="empty-state-card" style={{ padding: '2rem 1rem' }}>
                  <p className="empty-desc">
                    No originating evidence attached to this activity yet. Evidence uploaded with matching progress reports will automatically appear here.
                  </p>
                </div>
              ) : (
                <div className="evidence-trace-list">
                  {activityEvidenceList.map((ev) => (
                    <div key={ev.id} className="evidence-trace-item">
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{ev.fileName}</span>
                          <span className={`evidence-badge ${ev.fileType}`}>{ev.fileType}</span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', gap: '1rem' }}>
                          <span>Size: {ev.fileSizeBytes !== null ? formatFileSize(ev.fileSizeBytes) : '—'}</span>
                          <span>Uploaded: {new Date(ev.uploadedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => window.open(`/api/projects/${selectedProject.id}/evidence/${ev.id}/content`, '_blank')}
                        style={{ gap: '0.35rem', fontSize: '0.75rem' }}
                      >
                        <ExternalLink size={13} />
                        <span>View Evidence</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setTraceActivity(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diagnostics Drawer / Modal */}
      {isDiagnosticsOpen && (
        <div className="modal-overlay" onClick={() => setIsDiagnosticsOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">System Diagnostics & Storage</h3>
              <button className="modal-close-btn" onClick={() => setIsDiagnosticsOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="meta-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="meta-card">
                  <span className="meta-card-label">Server Status</span>
                  <span className="meta-card-value">{health?.status.toUpperCase() || 'OFFLINE'}</span>
                </div>
                <div className="meta-card">
                  <span className="meta-card-label">Database Path</span>
                  <span className="meta-card-value mono" style={{ fontSize: '0.75rem' }}>
                    {health?.database.path || 'Unknown'}
                  </span>
                </div>
                <div className="meta-card">
                  <span className="meta-card-label">Latency</span>
                  <span className="meta-card-value">{latency !== null ? `${latency} ms` : '—'}</span>
                </div>
                <div className="meta-card">
                  <span className="meta-card-label">Pass Version</span>
                  <span className="meta-card-value">Pass 7 Manual Reporting</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setIsDiagnosticsOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function envDatabaseDisplay(health: HealthData | null): string {
  if (!health) return 'SQLite';
  return health.database.path;
}

export default App;
