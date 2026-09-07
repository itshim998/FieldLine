import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  X,
  Wrench,
  Package,
  Compass,
  FileCheck,
  CloudRain,
  ShieldAlert,
  Users,
  CheckCircle2,
  Loader2,
  MapPin,
  Flame
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { OperationalTaskItem } from './TodayWorkView.js';

export type BlockerCategory =
  | 'equipment'
  | 'material'
  | 'access'
  | 'inspection'
  | 'weather'
  | 'safety'
  | 'coordination';

export interface BlockerModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  initialTask?: OperationalTaskItem | null;
  onBlockerLogged?: (blocker: any) => void;
}

interface CategoryOption {
  id: BlockerCategory;
  label: string;
  icon: React.ElementType;
  color: string;
  description: string;
}

const CATEGORIES: CategoryOption[] = [
  {
    id: 'equipment',
    label: 'Equipment',
    icon: Wrench,
    color: '#f59e0b',
    description: 'Breakdown, maintenance, or missing machinery'
  },
  {
    id: 'material',
    label: 'Material',
    icon: Package,
    color: '#3b82f6',
    description: 'Out of stock, delayed delivery, or damaged goods'
  },
  {
    id: 'access',
    label: 'Access',
    icon: Compass,
    color: '#10b981',
    description: 'Blocked route, scaffolding missing, or restricted zone'
  },
  {
    id: 'inspection',
    label: 'Inspection',
    icon: FileCheck,
    color: '#8b5cf6',
    description: 'Awaiting QA/QC hold-point signoff or survey verification'
  },
  {
    id: 'weather',
    label: 'Weather',
    icon: CloudRain,
    color: '#06b6d4',
    description: 'High winds, heavy rainfall, or lightning stand-down'
  },
  {
    id: 'safety',
    label: 'Safety Stop',
    icon: ShieldAlert,
    color: '#ef4444',
    description: 'Hazard identified requiring work to halt immediately'
  },
  {
    id: 'coordination',
    label: 'Coordination',
    icon: Users,
    color: '#ec4899',
    description: 'Interference with adjacent trade or client interface'
  }
];

const COMMON_SNIPPETS: Record<BlockerCategory, string[]> = {
  equipment: ['Crane down for hydraulic repair', 'Welding generator low voltage', 'Excavator fuel filter blocked'],
  material: ['Delayed bolt delivery', 'Awaiting structural rebar delivery', 'Piping spool damaged in transit'],
  access: ['Scaffolding tagged red / uncertified', 'Access trench not backfilled', 'Heavy mud blocking crane pad'],
  inspection: ['Awaiting ultrasonic weld inspection', 'Rebar placement inspection hold', 'Pressure test sign-off pending'],
  weather: ['High winds exceeding 30 knots', 'Heavy rain flooding work pit', 'Lightning warning active'],
  safety: ['Missing perimeter toe board', 'Working at height without lifeline', 'Energized line uncovered'],
  coordination: ['Trade interference: Civils in area', 'Electrical cable pull blocking access', 'Client permit handover delay']
};

export function BlockerModal({
  isOpen,
  onClose,
  projectId,
  initialTask,
  onBlockerLogged
}: BlockerModalProps): React.JSX.Element | null {
  const { session, authFetch } = useAuth();

  const [selectedCategory, setSelectedCategory] = useState<BlockerCategory>('equipment');
  const [description, setDescription] = useState<string>('');
  const [reporterName, setReporterName] = useState<string>('');
  const [reporterRole, setReporterRole] = useState<string>('');
  const [applyToTask, setApplyToTask] = useState<boolean>(true);

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (session) {
      setReporterName(session.displayName || 'Worker Crew');
      setReporterRole(session.accountType === 'worker' ? 'Field Operations' : 'Project Controls');
    }
  }, [session]);

  useEffect(() => {
    if (isOpen) {
      setDescription('');
      setError(null);
      setSuccess(null);
      setApplyToTask(Boolean(initialTask));
    }
  }, [isOpen, initialTask]);

  if (!isOpen) return null;

  const handleSnippetClick = (snippet: string) => {
    setDescription(snippet);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || description.trim().length < 3) {
      setError('Please provide a descriptive explanation (minimum 3 characters).');
      return;
    }

    if (!reporterName.trim()) {
      setError('Reporter attribution name is required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = {
        activityId: applyToTask && initialTask ? initialTask.id : null,
        category: selectedCategory,
        description: description.trim(),
        reporterName: reporterName.trim(),
        reporterRole: reporterRole.trim() || null
      };

      const res = await authFetch(`/api/projects/${projectId}/blockers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || !data.blocker) {
        throw new Error(data.error?.message || data.message || 'Failed to log operational blocker');
      }

      setSuccess(`Blocker logged successfully! Routed directly into Risk Engine.`);
      if (onBlockerLogged) {
        onBlockerLogged(data.blocker);
      }

      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message || 'Network error logging blocker');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="blocker-modal-backdrop" role="dialog" aria-modal="true">
      <div className="blocker-modal-sheet">
        {/* Header */}
        <div className="modal-header-row">
          <div className="modal-title-group">
            <div className="modal-icon-badge amber">
              <AlertTriangle size={20} color="#f59e0b" />
            </div>
            <div>
              <h2 className="modal-sheet-title">Log Operational Blocker</h2>
              <p className="modal-sheet-subtitle">
                Flag constraints stopping field crews. Blockers immediately signal the Risk Engine and Admin Dashboard.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Task Association Badge */}
        {initialTask && (
          <div className="task-association-card">
            <div className="task-assoc-left">
              <span className="assoc-badge">{initialTask.externalId}</span>
              <span className="assoc-name">{initialTask.name}</span>
              {initialTask.location && (
                <span className="assoc-loc">
                  <MapPin size={11} />
                  {initialTask.location}
                </span>
              )}
            </div>
            <label className="assoc-toggle">
              <input
                type="checkbox"
                checked={applyToTask}
                onChange={(e) => setApplyToTask(e.target.checked)}
              />
              <span>Link to this task</span>
            </label>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="blocker-modal-form">
          {/* Category Selector Grid */}
          <div className="field-group">
            <label className="field-label">Blocker Category</label>
            <div className="category-grid" role="radiogroup" aria-label="Blocker categories">
              {CATEGORIES.map((cat) => {
                const IconComponent = cat.icon;
                const isSelected = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    id={`category-btn-${cat.id}`}
                    className={`category-chip ${isSelected ? 'selected' : ''}`}
                    style={{
                      borderColor: isSelected ? cat.color : undefined,
                      backgroundColor: isSelected ? `${cat.color}15` : undefined
                    }}
                    onClick={() => setSelectedCategory(cat.id)}
                  >
                    <IconComponent size={16} color={cat.color} />
                    <span className="cat-label">{cat.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Snippets for Selected Category */}
          <div className="field-group">
            <label className="field-label-sm">Quick Fill Suggestions</label>
            <div className="snippets-row">
              {COMMON_SNIPPETS[selectedCategory].map((snippet, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="snippet-pill"
                  onClick={() => handleSnippetClick(snippet)}
                >
                  + {snippet}
                </button>
              ))}
            </div>
          </div>

          {/* Description Textarea */}
          <div className="field-group">
            <label className="field-label" htmlFor="blocker-description">
              Blocker Description <span className="req">*</span>
            </label>
            <textarea
              id="blocker-description"
              rows={3}
              className="modal-textarea"
              placeholder={`Describe what is physically preventing work (e.g., "${COMMON_SNIPPETS[selectedCategory][0]}")`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          {/* Attribution Fields */}
          <div className="form-two-col">
            <div className="field-group">
              <label className="field-label" htmlFor="blocker-reporter-name">
                Reporter Name <span className="req">*</span>
              </label>
              <input
                type="text"
                id="blocker-reporter-name"
                className="modal-input"
                placeholder="Your Name / Crew Lead"
                value={reporterName}
                onChange={(e) => setReporterName(e.target.value)}
                required
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="blocker-reporter-role">
                Trade / Role
              </label>
              <input
                type="text"
                id="blocker-reporter-role"
                className="modal-input"
                placeholder="e.g. Rigging Lead, Site Superintendent"
                value={reporterRole}
                onChange={(e) => setReporterRole(e.target.value)}
              />
            </div>
          </div>

          {/* Feedback Alerts */}
          {error && (
            <div className="modal-alert error" role="alert">
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="modal-alert success" role="alert">
              <CheckCircle2 size={15} />
              <span>{success}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="modal-actions-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              id="submit-blocker-btn"
              className="btn btn-primary"
              disabled={submitting || !description.trim() || !reporterName.trim()}
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className="spinner" />
                  <span>Logging Blocker...</span>
                </>
              ) : (
                <>
                  <Flame size={15} />
                  <span>Log Operational Blocker</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
