import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface AssistantMarkdownProps {
  content: string;
  className?: string;
}

/**
 * Normalizes raw LLM output text:
 * 1. Strips accidental outer ```markdown / ```json code fences if present.
 * 2. Normalizes unescaped literal '\n' sequences outside code blocks to actual line breaks.
 */
export function normalizeMarkdownContent(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';

  let text = raw.trim();

  // Strip accidental outer code block wrapper e.g. ```markdown ... ``` or ``` ... ```
  if (/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.test(text)) {
    const match = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
    if (match && match[1]) {
      text = match[1].trim();
    }
  }

  // Normalize literal `\n` sequences (backslash followed by n) that might occur from JSON serialization
  // while carefully avoiding disrupting intentional escaped characters
  if (text.includes('\\n')) {
    // Split by code blocks to avoid transforming literal backslashes inside code blocks
    const segments = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
    text = segments
      .map((seg, idx) => {
        // Even indices are regular markdown prose
        if (idx % 2 === 0) {
          return seg.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
        }
        // Odd indices are code blocks or inline code
        return seg;
      })
      .join('');
  }

  return text;
}

export const AssistantMarkdown: React.FC<AssistantMarkdownProps> = ({ content, className = '' }) => {
  const normalized = normalizeMarkdownContent(content);

  return (
    <div className={`assistant-markdown ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Responsive table container wrapper for mobile / desktop viewports
          table: ({ children, ...props }) => (
            <div className="assistant-table-wrapper">
              <table {...props}>{children}</table>
            </div>
          ),
          // Links open in new tab securely
          a: ({ href, children, ...props }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="assistant-md-link"
              {...props}
            >
              {children}
            </a>
          ),
          // Pre & Code blocks
          pre: ({ children, ...props }) => (
            <pre className="assistant-code-block" {...props}>
              {children}
            </pre>
          ),
          code: ({ className: codeClassName, children, ...props }) => {
            const isInline = !codeClassName;
            return isInline ? (
              <code className="assistant-inline-code" {...props}>
                {children}
              </code>
            ) : (
              <code className={codeClassName} {...props}>
                {children}
              </code>
            );
          },
          // Semantic Headings
          h1: ({ children, ...props }) => (
            <h1 className="assistant-heading assistant-h1" {...props}>
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 className="assistant-heading assistant-h2" {...props}>
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="assistant-heading assistant-h3" {...props}>
              {children}
            </h3>
          ),
          h4: ({ children, ...props }) => (
            <h4 className="assistant-heading assistant-h4" {...props}>
              {children}
            </h4>
          ),
          // Paragraphs & Lists
          p: ({ children, ...props }) => (
            <p className="assistant-paragraph" {...props}>
              {children}
            </p>
          ),
          ul: ({ children, ...props }) => (
            <ul className="assistant-list assistant-ul" {...props}>
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="assistant-list assistant-ol" {...props}>
              {children}
            </ol>
          ),
          li: ({ children, ...props }) => (
            <li className="assistant-list-item" {...props}>
              {children}
            </li>
          ),
          blockquote: ({ children, ...props }) => (
            <blockquote className="assistant-blockquote" {...props}>
              {children}
            </blockquote>
          ),
          hr: ({ ...props }) => <hr className="assistant-divider" {...props} />
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
};

export default AssistantMarkdown;
