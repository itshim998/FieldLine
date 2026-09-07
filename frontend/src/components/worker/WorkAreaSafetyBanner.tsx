import React from 'react';
import {
  ShieldAlert,
  HardHat,
  Eye,
  AlertTriangle,
  Zap,
  Flame,
  Wind,
  PlusCircle,
  FileWarning
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
  accentColor: string;
}

const SAFETY_PROFILES: Record<string, AreaSafetyProfile> = {
  'Area A': {
    areaName: 'Area A — Site Preparation & Earthworks',
    hazardTitle: 'Heavy Machinery & Open Trenching Zone',
    hazardDesc: 'High-visibility Class 3 required. Keep minimum 15m radius from operating excavators and dump trucks. Edge protection installed along retention basin.',
    requiredPpe: ['Hard Hat', 'High-Vis Vest', 'Steel-Toe Boots', 'Dust Mask'],
    severity: 'medium',
    accentColor: '#f59e0b'
  },
  'Area B': {
    areaName: 'Area B — Heavy Foundations & Deep Piling',
    hazardTitle: 'Piling Rig Operation & Heavy Ground Vibrations',
    hazardDesc: 'Strict 25m rotary piling exclusion perimeter active. Hearing protection mandatory within 30m. Ground stability checks verified daily.',
    requiredPpe: ['Hard Hat with Chin Strap', 'Hearing Protection', 'Safety Glasses', 'Steel-Toe Boots'],
    severity: 'high',
    accentColor: '#ef4444'
  },
  'Area C': {
    areaName: 'Area C — Structural Steel & Pipe Racks',
    hazardTitle: 'Active Overhead Crane Lifts & Elevated Steel Erection',
    hazardDesc: '100% tie-off dual-lanyard safety harness mandatory above 1.8m. Never walk underneath suspended structural loads. Mobile crane pad exclusion tape enforced.',
    requiredPpe: ['Hard Hat', 'Safety Harness (100% Tie-Off)', 'Cut-Resistant Gloves', 'High-Vis'],
    severity: 'high',
    accentColor: '#ef4444'
  },
  'Area D': {
    areaName: 'Area D — Process Piping & Welding',
    hazardTitle: 'Active Hot Work & High-Pressure Header Flanging',
    hazardDesc: 'Designated fire watch posted with 10kg dry chemical extinguisher. Leather welding jacket, face shield, and hot work permit must be displayed on work station.',
    requiredPpe: ['Welding Hood / Face Shield', 'Leather Sleeves', 'Fire-Retardant Clothing', 'Safety Boots'],
    severity: 'high',
    accentColor: '#f97316'
  },
  'Area E': {
    areaName: 'Area E — Electrical & Instrumentation',
    hazardTitle: 'Substation Energized Boundary & High-Voltage Trays',
    hazardDesc: 'Lockout/Tagout (LOTO) active on Marshalling Cabinets. Dielectric boots and arc flash shield required when testing inside MCC room.',
    requiredPpe: ['Arc Flash Shield', 'Dielectric Boots', 'Insulated Gloves (1000V)', 'Cotton Underlayers'],
    severity: 'medium',
    accentColor: '#eab308'
  },
  'Area F': {
    areaName: 'Area F — Pre-Commissioning & Testing',
    hazardTitle: 'Hydrostatic High-Pressure Pipe Testing Zone',
    hazardDesc: 'Hydrotest Package A under 150 bar pressure. Warning sirens active during pressurization. Only authorized test engineers permitted past red perimeter barrier.',
    requiredPpe: ['Full Face Visor', 'Safety Glasses', 'High-Vis', 'Impact Gloves'],
    severity: 'high',
    accentColor: '#ef4444'
  }
};

const DEFAULT_PROFILE: AreaSafetyProfile = {
  areaName: 'Refinery Expansion Unit 4 — Site-Wide Protocol',
  hazardTitle: 'Active Industrial Construction Site (5-Point PPE Mandatory)',
  hazardDesc: 'Always maintain situational awareness. Report all near misses, equipment fluid leaks, and access obstructions immediately to Field Safety.',
  requiredPpe: ['Hard Hat', 'Safety Glasses', 'High-Vis Vest', 'Steel-Toe Boots', 'Gloves'],
  severity: 'low',
  accentColor: '#3b82f6'
};

export function WorkAreaSafetyBanner({
  selectedArea,
  onOpenReportHazard
}: WorkAreaSafetyBannerProps): React.JSX.Element {
  const profile = SAFETY_PROFILES[selectedArea] || DEFAULT_PROFILE;

  return (
    <div
      className="work-area-safety-banner"
      style={{
        borderLeftColor: profile.accentColor
      }}
      data-testid="work-area-safety-banner"
    >
      <div className="safety-banner-left">
        <div className="safety-badge-row">
          <span className="safety-indicator-chip" style={{ backgroundColor: `${profile.accentColor}20`, color: profile.accentColor }}>
            <ShieldAlert size={14} />
            <span>Safety Briefing</span>
          </span>
          <span className="safety-area-label">{profile.areaName}</span>
        </div>

        <h4 className="safety-hazard-title">{profile.hazardTitle}</h4>
        <p className="safety-hazard-desc">{profile.hazardDesc}</p>

        {/* Required PPE Chips */}
        <div className="safety-ppe-row">
          <span className="ppe-label">Mandatory PPE:</span>
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
          <span>Report Hazard / Near Miss</span>
        </button>
      </div>
    </div>
  );
}
