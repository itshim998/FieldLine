export interface ConversationTurn {
  role: 'user' | 'model' | 'system';
  content: string;
  timestamp: number;
}

export interface InFlightProgressReport {
  id: string;
  statement: string;
  timestamp: number;
  status: 'pending' | 'verified' | 'failed';
  resolutionMessage?: string;
}

export interface RollingConversationBufferOptions {
  maxTurns?: number;
  projectSummary?: string;
}

export class RollingConversationBuffer {
  private readonly maxTurns: number;
  private turns: ConversationTurn[] = [];
  private inFlightReports: Map<string, InFlightProgressReport> = new Map();
  private projectSummary: string = '';

  constructor(options: RollingConversationBufferOptions = {}) {
    this.maxTurns = options.maxTurns ?? 20;
    if (options.projectSummary) {
      this.projectSummary = options.projectSummary;
    }
  }

  setProjectSummary(summary: string): void {
    this.projectSummary = summary;
  }

  getProjectSummary(): string {
    return this.projectSummary;
  }

  addUserTurn(content: string): void {
    const trimmed = content.trim();
    if (!trimmed) return;
    this.appendTurn({
      role: 'user',
      content: trimmed,
      timestamp: Date.now()
    });
  }

  addModelTurn(content: string): void {
    const trimmed = content.trim();
    if (!trimmed) return;
    this.appendTurn({
      role: 'model',
      content: trimmed,
      timestamp: Date.now()
    });
  }

  addSystemEvent(content: string): void {
    const trimmed = content.trim();
    if (!trimmed) return;
    this.appendTurn({
      role: 'system',
      content: trimmed,
      timestamp: Date.now()
    });
  }

  addInFlightReport(id: string, statement: string): void {
    this.inFlightReports.set(id, {
      id,
      statement,
      timestamp: Date.now(),
      status: 'pending'
    });
  }

  resolveInFlightReport(id: string, status: 'verified' | 'failed', resolutionMessage?: string): void {
    const report = this.inFlightReports.get(id);
    if (report) {
      report.status = status;
      report.resolutionMessage = resolutionMessage;
    }
  }

  getInFlightReports(): InFlightProgressReport[] {
    return Array.from(this.inFlightReports.values());
  }

  getRecentTurns(limit?: number): ConversationTurn[] {
    const count = Math.min(limit ?? this.turns.length, this.turns.length);
    return this.turns.slice(this.turns.length - count);
  }

  getTurnCount(): number {
    return this.turns.length;
  }

  /**
   * Generates a concise context hydration summary formatted for injection
   * into a new upstream Gemini Live session during key handover.
   */
  generateHandoverSummary(): string {
    const recent = this.getRecentTurns(10);
    const sections: string[] = [];

    if (this.projectSummary) {
      sections.push(`[Active Project Context]\n${this.projectSummary}`);
    }

    if (this.inFlightReports.size > 0) {
      const reports = Array.from(this.inFlightReports.values())
        .slice(-5)
        .map((r) => `- [${r.status.toUpperCase()}] "${r.statement}"${r.resolutionMessage ? ` -> ${r.resolutionMessage}` : ''}`)
        .join('\n');
      sections.push(`[In-Flight / Recent Field Progress Reports]\n${reports}`);
    }

    if (recent.length > 0) {
      const history = recent
        .map((t) => {
          const speaker = t.role === 'user' ? 'Site Worker' : t.role === 'model' ? 'FieldLine Assistant' : 'System Event';
          return `${speaker}: ${t.content}`;
        })
        .join('\n');
      sections.push(`[Recent Conversation History (Transferred Session)]\n${history}`);
    }

    sections.push(
      'Session Note: This session was seamlessly handed over from an active connection. Continue conversing with the worker naturally without stating that a handover occurred.'
    );

    return sections.join('\n\n');
  }

  clear(): void {
    this.turns = [];
    this.inFlightReports.clear();
  }

  private appendTurn(turn: ConversationTurn): void {
    this.turns.push(turn);
    if (this.turns.length > this.maxTurns) {
      this.turns.splice(0, this.turns.length - this.maxTurns);
    }
  }
}
