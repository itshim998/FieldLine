import React from 'react';
import {
  ShieldAlert,
  HardHat,
  AlertTriangle
} from 'lucide-react';

export interface WorkAreaSafetyBannerProps {
  selectedArea: string;
  onOpenReportHazard: () => void;
}

interface AreaSafetyProfile {
  areaName: string;
  hazardTitle: string;
  hazardDesc: string;
  requiredPpe: string[];
  severity: 'low' | 'medium' | 'high';
}

const SAFETY_PROFILES: Record<string, AreaSafetyProfile> = {
  'Area A': {
    areaName: 'Area A — Site Preparation & Earthworks',
    hazardTitle: 'Heavy plant and trenches',
    hazardDesc: 'Keep clear of moving plant and open trenches. Confirm exclusion zones and edge protection with the site supervisor.',
    requiredPpe: ['Hard Hat', 'High-Vis Vest', 'Steel-Toe Boots', 'Dust Mask'],
    severity: 'medium'
  },
  'Area B': {
    areaName: 'Area B — Heavy Foundations & Deep Piling',
    hazardTitle: 'Piling operations',
    hazardDesc: 'Confirm piling exclusion zones, hearing protection and ground stability controls before starting.',
    requiredPpe: ['Hard Hat with Chin Strap', 'Hearing Protection', 'Safety Glasses', 'Steel-Toe Boots'],
    severity: 'high'
  },
  'Area C': {
    areaName: 'Area C — Structural Steel & Pipe Racks',
    hazardTitle: 'Lifting and working at height',
    hazardDesc: 'Confirm fall protection and lifting exclusion zones. Never pass under suspended loads.',
    requiredPpe: ['Hard Hat', 'Safety Harness (100% Tie-Off)', 'Cut-Resistant Gloves', 'High-Vis'],
    severity: 'high'
  },
  'Area D': {
    areaName: 'Area D — Process Piping & Welding',
    hazardTitle: 'Hot work and piping',
    hazardDesc: 'Confirm hot-work authorization, fire watch and appropriate protective equipment before welding or cutting.',
    requiredPpe: ['Welding Hood / Face Shield', 'Leather Sleeves', 'Fire-Retardant Clothing', 'Safety Boots'],
    severity: 'high'
  },
  'Area E': {
    areaName: 'Area E — Electrical & Instrumentation',
    hazardTitle: 'Electrical isolation',
    hazardDesc: 'Verify isolation, lockout/tagout and arc-flash boundaries with the authorized site team before electrical work.',
    requiredPpe: ['Arc Flash Shield', 'Dielectric Boots', 'Insulated Gloves (1000V)', 'Cotton Underlayers'],
    severity: 'medium'
  },
  'Area F': {
    areaName: 'Area F — Pre-Commissioning & Testing',
    hazardTitle: 'Pressure testing',
    hazardDesc: 'Confirm pressure-test authorization, barriers and team communication before entering the test area.',
    requiredPpe: ['Full Face Visor', 'Safety Glasses', 'High-Vis', 'Impact Gloves'],
    severity: 'high'
  }
};

const DEFAULT_PROFILE: AreaSafetyProfile = {
  areaName: 'All work areas',
  hazardTitle: 'Construction work area',
  hazardDesc: 'Follow the current site safety briefing and report hazards or near misses to the responsible safety team.',
  requiredPpe: ['Hard Hat', 'Safety Glasses', 'High-Vis Vest', 'Steel-Toe Boots', 'Gloves'],
  severity: 'low'
};

export function WorkAreaSafetyBanner({
  selectedArea,
  onOpenReportHazard
}: WorkAreaSafetyBannerProps): React.JSX.Element {
  const profile = SAFETY_PROFILES[selectedArea] || DEFAULT_PROFILE;

  return (
    <div
      className="work-area-safety-banner"
      data-severity={profile.severity}
      data-testid="work-area-safety-banner"
    >
      <div className="safety-banner-left">
        <div className="safety-badge-row">
          <span className="safety-indicator-chip">
            <ShieldAlert size={14} />
            <span>Area safety reminder</span>
          </span>
          <span className="safety-area-label">{profile.areaName}</span>
        </div>

        <h4 className="safety-hazard-title">{profile.hazardTitle}</h4>
        <p className="safety-hazard-desc">{profile.hazardDesc}</p>
        <p className="safety-briefing-disclaimer">General reminder only. Check the current site briefing and supervisor instructions.</p>

        {/* Required PPE Chips */}
        <div className="safety-ppe-row">
          <span className="ppe-label">PPE to confirm:</span>
          {profile.requiredPpe.map((item, idx) => (
            <span key={idx} className="ppe-chip">
              <HardHat size={11} />
              <span>{item}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="safety-banner-right">
        <button
          type="button"
          id="report-hazard-btn"
          data-testid="report-hazard-btn"
          className="btn btn-warning-touch"
          onClick={onOpenReportHazard}
          title="Quickly report an observed safety hazard or near miss"
        >
          <AlertTriangle size={15} />
          <span>Report a hazard</span>
        </button>
      </div>
    </div>
  );
}
