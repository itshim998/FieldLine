import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  X,
  ShieldAlert,
  CheckCircle2,
  Loader2,
  HardHat,
  Eye,
  Flame,
  Zap,
  Footprints,
  Wrench,
  Radio
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';

export interface ReportHazardModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  selectedArea?: string;
  onHazardReported?: (event: any) => void;
}

const HAZARD_TYPES = [
  { id: 'Working at Heights', icon: Footprints, label: 'Heights & Falling Objects' },
  { id: 'Access Obstruction', icon: Eye, label: 'Access / Slip & Trip' },
  { id: 'Machinery Guarding', icon: Wrench, label: 'Machinery & Pinch Points' },
  { id: 'Electrical Hazard', icon: Zap, label: 'Electrical / High Voltage' },
  { id: 'Hot Work & Fire', icon: Flame, label: 'Hot Work / Fire Risk' },
  { id: 'Near Miss Incident', icon: Radio, label: 'Near Miss (Zero Contact)' },
  { id: 'Environmental / Chemical', icon: ShieldAlert, label: 'Chemical / Fumes / Spills' }
];

export function ReportHazardModal({
  isOpen,
  onClose,
  projectId,
  selectedArea,
  onHazardReported
}: ReportHazardModalProps): React.JSX.Element | null {
  const { session, authFetch } = useAuth();

  const [workArea, setWorkArea] = useState<string>('General Site');
  const [hazardType, setHazardType] = useState<string>('Working at Heights');
  const [description, setDescription] = useState<string>('');
  const [immediateActionTaken, setImmediateActionTaken] = useState<string>('');
  const [reporterName, setReporterName] = useState<string>('');
  const [reporterRole, setReporterRole] = useState<string>('');

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (session) {
      setReporterName(session.displayName || 'Worker Crew');
      setReporterRole(session.accountType === 'worker' ? 'Field Tradesperson' : 'HSE Marshall');
    }
  }, [session]);

  useEffect(() => {
    if (isOpen) {
      setWorkArea(selectedArea && selectedArea !== 'all' ? selectedArea : 'General Site');
      setDescription('');
      setImmediateActionTaken('');
      setError(null);
      setSuccess(null);
    }
  }, [isOpen, selectedArea]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || description.trim().length < 3) {
      setError('Please provide details describing the hazard (minimum 3 characters).');
      return;
    }

    if (!reporterName.trim()) {
      setError('Reporter name is required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = {
        workArea: workArea.trim(),
        hazardType,
        description: description.trim(),
        reporterName: reporterName.trim(),
        reporterRole: reporterRole.trim() || null,
        immediateActionTaken: immediateActionTaken.trim() || null
      };

      const res = await authFetch(`/api/projects/${projectId}/safety/hazards`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || !data.event) {
        throw new Error(data.error?.message || data.message || 'Failed to report safety hazard');
      }

      setSuccess('Safety hazard observation logged directly to project audit events!');
      if (onHazardReported) {
        onHazardReported(data.event);
      }

      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message || 'Error submitting safety hazard report');
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
            <div className="modal-icon-badge red">
              <ShieldAlert size={20} color="#ef4444" />
            </div>
            <div>
              <h2 className="modal-sheet-title">Report Site Hazard / Near Miss</h2>
              <p className="modal-sheet-subtitle">
                Rapidly log safety observations and preventative actions to the project event record.
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

        <form onSubmit={handleSubmit} className="blocker-modal-form">
          {/* Work Area Field */}
          <div className="field-group">
            <label className="field-label" htmlFor="hazard-work-area">
              Work Area / Location Context
            </label>
            <input
              type="text"
              id="hazard-work-area"
              className="modal-input"
              value={workArea}
              onChange={(e) => setWorkArea(e.target.value)}
              placeholder="e.g. Area C — Pipe Rack PR-07, South Laydown"
            />
          </div>

          {/* Hazard Type Selector */}
          <div className="field-group">
            <label className="field-label">Hazard Classification</label>
            <div className="category-grid" role="radiogroup" aria-label="Hazard types">
              {HAZARD_TYPES.map((type) => {
                const isSelected = hazardType === type.id;
                const Icon = type.icon;
                return (
                  <button
                    key={type.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    id={`hazard-type-${type.id.replace(/\s+/g, '-').toLowerCase()}`}
                    className={`category-chip ${isSelected ? 'selected' : ''}`}
                    onClick={() => setHazardType(type.id)}
                  >
                    <Icon size={15} color={isSelected ? '#ef4444' : '#9ca3af'} />
                    <span className="cat-label">{type.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Description */}
          <div className="field-group">
            <label className="field-label" htmlFor="hazard-description">
              Hazard Observation & Condition <span className="req">*</span>
            </label>
            <textarea
              id="hazard-description"
              rows={3}
              className="modal-textarea"
              placeholder="What unsafe condition, equipment defect, or near miss did you observe?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          {/* Immediate Action Taken */}
          <div className="field-group">
            <label className="field-label" htmlFor="hazard-action-taken">
              Immediate Action Taken (Optional)
            </label>
            <input
              type="text"
              id="hazard-action-taken"
              className="modal-input"
              placeholder="e.g. Put up danger tape, stopped work, alerted crane operator"
              value={immediateActionTaken}
              onChange={(e) => setImmediateActionTaken(e.target.value)}
            />
          </div>

          {/* Attribution Fields */}
          <div className="form-two-col">
            <div className="field-group">
              <label className="field-label" htmlFor="hazard-reporter-name">
                Observer Name <span className="req">*</span>
              </label>
              <input
                type="text"
                id="hazard-reporter-name"
                className="modal-input"
                value={reporterName}
                onChange={(e) => setReporterName(e.target.value)}
                required
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="hazard-reporter-role">
                Trade / Crew
              </label>
              <input
                type="text"
                id="hazard-reporter-role"
                className="modal-input"
                placeholder="e.g. Scaffolder, Rigger, HSE"
                value={reporterRole}
                onChange={(e) => setReporterRole(e.target.value)}
              />
            </div>
          </div>

          {/* Alerts */}
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
              id="submit-hazard-btn"
              className="btn btn-primary"
              disabled={submitting || !description.trim() || !reporterName.trim()}
              style={{ backgroundColor: 'var(--accent-rose, #f43f5e)' }}
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className="spinner" />
                  <span>Submitting Hazard...</span>
                </>
              ) : (
                <>
                  <ShieldAlert size={15} />
                  <span>Submit Safety Hazard</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
