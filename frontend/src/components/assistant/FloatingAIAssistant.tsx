import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Send,
  RefreshCw,
  MessageSquare,
  Sparkles,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  FolderGit2,
  Mic,
  MicOff,
  Radio,
  CheckCircle2,
  ExternalLink
} from 'lucide-react';
import { AssistantMarkdown } from './AssistantMarkdown.js';
import { useLiveVoiceSession } from './live/useLiveVoiceSession.js';
import type {
  Project,
  AssistantQueryResponse
} from '../../App.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content?: string;
  response?: AssistantQueryResponse;
  displayedAnswer?: string;
  isStreaming?: boolean;
  timestamp: string;
  error?: string;
}

export interface FloatingAIAssistantProps {
  projects: Project[];
  currentProject: Project | null;
  onNavigateToProject?: (project: Project) => void;
  onNavigateToActivity?: (activityId: string) => void;
  asOfDate?: string;
}

const SUGGESTED_QUESTIONS = [
  'What is delayed?',
  'Which activities are at risk?',
  'Which milestones are approaching?',
  'What changed recently?',
  'What is the status of ACT-B02?',
  'Which activities have no recent updates?'
];

export const FloatingAIAssistant: React.FC<FloatingAIAssistantProps> = ({
  projects,
  currentProject,
  onNavigateToProject,
  onNavigateToActivity,
  asOfDate = new Date().toISOString().slice(0, 10)
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputQuery, setInputQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [expandedFactsMap, setExpandedFactsMap] = useState<Record<string, boolean>>({});

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up streaming interval on unmount
  useEffect(() => {
    return () => {
      if (streamIntervalRef.current) {
        clearInterval(streamIntervalRef.current);
        streamIntervalRef.current = null;
      }
    };
  }, []);

  // Sync selected project with active project or default to first project
  useEffect(() => {
    if (currentProject) {
      setSelectedProjectId(currentProject.id);
    } else if (projects.length > 0 && (!selectedProjectId || !projects.some((p) => p.id === selectedProjectId))) {
      setSelectedProjectId(projects[0].id);
    }
  }, [currentProject, projects, selectedProjectId]);

  // Scroll to bottom when messages update
  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading, isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 150);
    }
  }, [isOpen]);

  const activeTargetProject = projects.find((p) => p.id === selectedProjectId) || currentProject || (projects.length > 0 ? projects[0] : null);

  // Live Voice Session Hook (Gemini 3 Flash Live Multimodal Session)
  const liveSession = useLiveVoiceSession({
    projectId: activeTargetProject?.id
  });

  const isLiveActive =
    liveSession.isLiveConnected ||
    liveSession.connectionState === 'connecting' ||
    liveSession.connectionState === 'handover' ||
    liveSession.connectionState === 'error';

  // Seamlessly sync selected project to live voice session
  const prevProjectIdRef = useRef<string>(activeTargetProject?.id || '');
  useEffect(() => {
    if (activeTargetProject?.id && prevProjectIdRef.current && prevProjectIdRef.current !== activeTargetProject.id) {
      if (liveSession.isLiveConnected) {
        liveSession.startSession(activeTargetProject.id);
      }
    }
    if (activeTargetProject?.id) {
      prevProjectIdRef.current = activeTargetProject.id;
    }
  }, [activeTargetProject?.id, liveSession]);

  const handleSendQuery = async (queryToSend?: string) => {
    const text = (queryToSend || inputQuery).trim();
    if (!text || isLoading) return;

    if (!activeTargetProject) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          error: 'Please create or select a project first to query the AI assistant.'
        }
      ]);
      return;
    }

    const userMessageId = `user-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: userMessageId,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputQuery('');
    setIsLoading(true);

    try {
      const res = await fetch(`/api/projects/${activeTargetProject.id}/assistant/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: text,
          asOfDate
        })
      });

      const data = await res.json();

      if (res.ok) {
        const fullAnswer = data.answer || '';
        const assistantMsgId = `ai-${Date.now()}`;
        const tokens = fullAnswer.match(/(\S+\s*|\s+)/g) || [fullAnswer];

        if (streamIntervalRef.current) {
          clearInterval(streamIntervalRef.current);
          streamIntervalRef.current = null;
        }

        if (tokens.length <= 1) {
          const assistantMsg: ChatMessage = {
            id: assistantMsgId,
            role: 'assistant',
            response: data,
            displayedAnswer: fullAnswer,
            isStreaming: false,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          };
          setMessages((prev) => [...prev, assistantMsg]);
        } else {
          let currentIndex = 1;
          let accumulated = tokens[0];

          const assistantMsg: ChatMessage = {
            id: assistantMsgId,
            role: 'assistant',
            response: data,
            displayedAnswer: accumulated,
            isStreaming: true,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          };
          setMessages((prev) => [...prev, assistantMsg]);

          streamIntervalRef.current = setInterval(() => {
            if (currentIndex < tokens.length) {
              accumulated += tokens[currentIndex++];
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, displayedAnswer: accumulated, isStreaming: currentIndex < tokens.length }
                    : m
                )
              );
            } else {
              if (streamIntervalRef.current) {
                clearInterval(streamIntervalRef.current);
                streamIntervalRef.current = null;
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, displayedAnswer: fullAnswer, isStreaming: false }
                    : m
                )
              );
            }
          }, 18);
        }
      } else {
        const errorMsg = data.error?.message || data.error || 'Failed to evaluate project facts';
        const assistantErr: ChatMessage = {
          id: `ai-err-${Date.now()}`,
          role: 'assistant',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          error: errorMsg
        };
        setMessages((prev) => [...prev, assistantErr]);
      }
    } catch {
      const netErr: ChatMessage = {
        id: `ai-net-err-${Date.now()}`,
        role: 'assistant',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        error: 'Network connection issue. Unable to reach FieldLine AI intelligence service.'
      };
      setMessages((prev) => [...prev, netErr]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearChat = () => {
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    setMessages([]);
    setInputQuery('');
    setExpandedFactsMap({});
  };

  const toggleFactsAccordion = (msgId: string) => {
    setExpandedFactsMap((prev) => ({
      ...prev,
      [msgId]: !prev[msgId]
    }));
  };

  return (
    <>
      {/* Floating Trigger Circle Button (Bottom-Right) */}
      <button
        id="floating-ai-assistant-btn"
        className={`floating-ai-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle FieldLine AI Assistant"
        title="Ask FieldLine AI Assistant"
        type="button"
      >
        <div className="floating-ai-trigger-inner">
          <Sparkles size={20} color="#ffffff" />
        </div>
      </button>

      {/* Floating Modal & Blurred Backdrop Overlay */}
      {isOpen && (
        <>
          {/* Backdrop with slight blur */}
          <div
            id="floating-ai-backdrop"
            className="floating-ai-backdrop"
            onClick={() => setIsOpen(false)}
            aria-label="Close Assistant Modal Backdrop"
          />

          {/* Floating Rounded Rectangular Modal / Panel in Corner */}
          <div
            id="floating-ai-modal"
            className="floating-ai-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="floating-ai-title"
          >
            {/* Header */}
            <div className="floating-ai-header">
              <div className="floating-ai-title-wrap">
                <h3 id="floating-ai-title" className="floating-ai-title">
                  FieldLine AI
                </h3>
              </div>

              {/* Project Selector Dropdown */}
              {projects.length > 0 && (
                <div className="floating-ai-project-picker">
                  <FolderGit2 size={13} className="project-picker-icon" />
                  <select
                    id="floating-ai-project-select"
                    className="floating-ai-project-select"
                    value={activeTargetProject?.id || ''}
                    onChange={(e) => {
                      setSelectedProjectId(e.target.value);
                    }}
                    title="Select project context for AI queries"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code}: {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Header Actions: Clear Chat & Close */}
              <div className="floating-ai-header-actions">
                {messages.length > 0 && (
                  <button
                    type="button"
                    className="floating-ai-action-btn"
                    onClick={handleClearChat}
                    title="Clear conversation"
                    aria-label="Clear conversation"
                  >
                    <RotateCcw size={14} />
                  </button>
                )}
                <button
                  id="floating-ai-close-btn"
                  type="button"
                  className="floating-ai-action-btn close"
                  onClick={() => setIsOpen(false)}
                  title="Close Assistant"
                  aria-label="Close Assistant"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Chat Body */}
            <div className="floating-ai-body">
              {/* Live Voice HUD Banner / Overlay */}
              {isLiveActive && (
                <div id="floating-ai-live-hud" className="floating-ai-live-hud">
                  <div className="live-hud-header">
                    <div className="live-hud-status-badge">
                      <span className={`live-status-dot ${liveSession.connectionState === 'error' ? 'error' : liveSession.connectionState === 'connecting' ? 'connecting' : liveSession.isSpeaking ? 'speaking' : liveSession.connectionState === 'handover' ? 'handover' : 'listening'}`} />
                      <span className="live-status-text">
                        {liveSession.connectionState === 'connecting'
                          ? 'CONNECTING TO GEMINI LIVE...'
                          : liveSession.connectionState === 'error'
                          ? (liveSession.error || 'CONNECTION FAILED')
                          : liveSession.connectionState === 'handover'
                          ? 'SESSION HANDOVER...'
                          : liveSession.isSpeaking
                          ? 'GEMINI SPEAKING...'
                          : 'LISTENING...'}
                      </span>
                    </div>
                    <div className="live-hud-badges">
                      {liveSession.activeSlot && (
                        <span className="live-slot-badge" title="Active Gemini Key Slot">
                          Slot {liveSession.activeSlot}
                        </span>
                      )}
                      <span className="live-model-badge">Gemini 3 Flash Live</span>
                    </div>
                  </div>

                  {/* Audio Equalizer Frequency Bars */}
                  <div className="live-voice-visualizer" aria-label="Audio Visualizer">
                    {liveSession.frequencyBars.map((height, idx) => (
                      <div
                        key={idx}
                        className={`live-voice-bar ${liveSession.isSpeaking ? 'speaking' : 'listening'}`}
                        style={{
                          transform: `scaleY(${Math.max(0.15, height)})`
                        }}
                      />
                    ))}
                  </div>

                  {/* Real-time Streaming Speech Captions */}
                  {liveSession.liveTranscript.length > 0 ? (
                    <div className="live-voice-captions">
                      {liveSession.liveTranscript.slice(-2).map((item) => (
                        <div key={item.id} className={`live-caption-item ${item.sender}`}>
                          <span className="caption-sender">
                            {item.sender === 'user' ? 'Worker' : 'Gemini'}:
                          </span>
                          <span className="caption-text">{item.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="live-voice-hint">
                      <span>Speak naturally: "We finished Pier 12 excavation" or "What is scheduled next at Block B?"</span>
                    </div>
                  )}

                  {/* Verified Progress Confirmation Cards */}
                  {liveSession.verifiedUpdates.length > 0 && (
                    <div className="live-verified-container">
                      {liveSession.verifiedUpdates.slice(0, 2).map((upd) => (
                        <div key={upd.id} className="live-verified-card">
                          <div className="verified-card-header">
                            <div className="verified-card-title-wrap">
                              <CheckCircle2 size={15} className="verified-check-icon" />
                              <span className="verified-card-title">Update Verified &amp; Saved</span>
                            </div>
                            <span className="verified-progress-pill">{upd.progressPercent}%</span>
                          </div>
                          <p className="verified-card-msg">{upd.message}</p>
                          <div className="verified-card-actions">
                            <button
                              type="button"
                              className="verified-act-btn"
                              onClick={() => {
                                if (onNavigateToActivity) {
                                  onNavigateToActivity(upd.activityId);
                                }
                              }}
                            >
                              <span>View Activity ({upd.activityCode})</span>
                              <ExternalLink size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {messages.length === 0 ? (
                <div className="floating-ai-welcome">
                  <div className="floating-ai-welcome-badge">
                    <Sparkles size={22} />
                  </div>
                  <h4 className="floating-ai-welcome-title">How can I assist your project?</h4>

                  {/* Quick-start Suggestions */}
                  <div className="floating-ai-suggestions-box">
                    <div className="floating-ai-chips-grid">
                      {SUGGESTED_QUESTIONS.map((q, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="floating-ai-chip"
                          onClick={() => handleSendQuery(q)}
                          disabled={isLoading}
                        >
                          "{q}"
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="floating-ai-messages-list">
                  {messages.map((msg) => (
                    <div key={msg.id} className={`floating-chat-msg ${msg.role}`}>
                      {msg.role === 'user' ? (
                        <div className="floating-user-bubble">
                          <p className="floating-user-text">{msg.content}</p>
                          <span className="floating-msg-time">{msg.timestamp}</span>
                        </div>
                      ) : (
                        <div className="floating-ai-bubble">
                          {msg.error ? (
                            <div className="floating-ai-error-box">
                              <AlertCircle size={15} />
                              <span>{msg.error}</span>
                            </div>
                          ) : msg.response ? (
                            <div className="floating-ai-response-content">
                              {/* Ambiguous Candidates */}
                              {msg.response.ambiguousCandidates && msg.response.ambiguousCandidates.length > 0 && (
                                <div className="assistant-candidates-box" style={{ padding: '0.5rem', marginBottom: '0.5rem' }}>
                                  <span className="assistant-candidates-title" style={{ fontSize: '0.75rem' }}>
                                    Select an activity to query:
                                  </span>
                                  <div className="assistant-candidates-list">
                                    {msg.response.ambiguousCandidates.map((cand) => (
                                      <button
                                        key={cand.id}
                                        type="button"
                                        className="assistant-candidate-btn"
                                        style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                                        onClick={() => handleSendQuery(`What is the status of ${cand.name}?`)}
                                      >
                                        {cand.name} ({cand.externalId})
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Markdown Synthesis Answer with Streaming Animation */}
                              <div className="floating-ai-markdown-wrap">
                                <AssistantMarkdown
                                  content={
                                    msg.displayedAnswer !== undefined
                                      ? msg.displayedAnswer
                                      : (msg.response?.answer || '')
                                  }
                                />
                                {msg.isStreaming && <span className="streaming-cursor">▍</span>}
                              </div>

                              {/* Verified Facts & Citations Accordion (Revealed after streaming) */}
                              {!msg.isStreaming && msg.response.verifiedFacts && msg.response.verifiedFacts.length > 0 && (
                                <div className="floating-ai-facts-section fade-in">
                                  <button
                                    type="button"
                                    className="floating-ai-facts-toggle"
                                    onClick={() => toggleFactsAccordion(msg.id)}
                                  >
                                    <span>
                                      Citations &amp; Fact Set ({msg.response.verifiedFacts.length})
                                    </span>
                                    {expandedFactsMap[msg.id] ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                  </button>

                                  {expandedFactsMap[msg.id] && (
                                    <div className="floating-ai-facts-list">
                                      {msg.response.verifiedFacts.map((fact) => (
                                        <div key={fact.ref} className="floating-fact-card">
                                          <div className="floating-fact-head">
                                            <span className="assistant-fact-ref-badge" style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem' }}>
                                              {fact.ref}
                                            </span>
                                            {fact.externalId && (
                                              <span className="act-id-cell" style={{ fontSize: '0.7rem' }}>
                                                {fact.externalId}
                                              </span>
                                            )}
                                          </div>
                                          <p className="floating-fact-summary">{fact.summary}</p>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : null}
                          {!msg.isStreaming && <span className="floating-msg-time">{msg.timestamp}</span>}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Loading State */}
                  {isLoading && (
                    <div className="floating-chat-msg assistant">
                      <div className="floating-ai-bubble loading">
                        <RefreshCw size={15} className="pulse-dot" color="#818cf8" />
                        <span className="floating-loading-text">
                          Evaluating verified facts for {activeTargetProject?.code || 'project'}...
                        </span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>

            {/* Footer Input Area */}
            <div className="floating-ai-footer">
              <form
                className="floating-ai-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendQuery();
                }}
              >
                <div className="floating-input-wrapper">
                  <MessageSquare size={15} className="floating-input-icon" />
                  <input
                    ref={inputRef}
                    id="floating-ai-query-input"
                    type="text"
                    className="floating-ai-input"
                    placeholder={`Ask about ${activeTargetProject?.code || 'project'}...`}
                    value={inputQuery}
                    onChange={(e) => setInputQuery(e.target.value)}
                    disabled={isLoading || !activeTargetProject}
                  />
                </div>

                {/* Live Voice Toggle Button */}
                <button
                  id="floating-ai-live-voice-btn"
                  type="button"
                  className={`floating-ai-mic-btn ${isLiveActive ? 'active' : ''} ${liveSession.isSpeaking ? 'speaking' : ''}`}
                  onClick={() => liveSession.toggleSession(activeTargetProject?.id)}
                  disabled={!activeTargetProject}
                  aria-label={isLiveActive ? 'Stop Live Voice Assistant' : 'Start Live Voice Assistant'}
                  title={isLiveActive ? 'Stop Live Voice Assistant' : 'Start Live Voice Assistant (Gemini 3 Flash Live)'}
                >
                  {isLiveActive ? <MicOff size={15} /> : <Mic size={15} />}
                  {isLiveActive && <span className="floating-ai-mic-ring" />}
                </button>

                <button
                  id="floating-ai-send-btn"
                  type="submit"
                  className="floating-ai-send-btn"
                  disabled={isLoading || !inputQuery.trim() || !activeTargetProject}
                  aria-label="Send query"
                  title="Send query"
                >
                  {isLoading ? (
                    <RefreshCw size={14} className="pulse-dot" />
                  ) : (
                    <Send size={14} />
                  )}
                </button>
              </form>
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default FloatingAIAssistant;
