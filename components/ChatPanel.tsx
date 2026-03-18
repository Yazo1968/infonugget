import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { marked } from 'marked';
import { sanitizeHtml } from '../utils/sanitize';
import { ChatMessage, DetailLevel, UploadedFile, DocChangeEvent } from '../types';
import { DocumentChangeNotice } from './Dialogs';
import PanelRequirements from './PanelRequirements';
import { useThemeContext } from '../context/ThemeContext';
import { usePanelOverlay } from '../hooks/usePanelOverlay';

/** Strip the ```card-suggestions``` fenced block from card content before persisting. */
const SUGGESTIONS_REGEX = /```card-suggestions(?:\s+multi)?\n[\s\S]*?```/;
function stripSuggestionsBlock(content: string): string {
  return content.replace(SUGGESTIONS_REGEX, '').trimEnd();
}

interface ChatPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  messages: ChatMessage[];
  isLoading: boolean;
  onSendMessage: (text: string, isCardRequest: boolean, detailLevel?: DetailLevel) => void;
  onSaveAsCard: (message: ChatMessage, editedContent: string) => void;
  onClearChat: () => void;
  onStop: () => void;
  documents: UploadedFile[];
  pendingDocChanges?: DocChangeEvent[];
  hasConversation?: boolean;
  onDocChangeContinue?: (text: string, isCardRequest: boolean, detailLevel?: DetailLevel) => void;
  onDocChangeStartFresh?: () => void;
  tabBarRef?: React.RefObject<HTMLElement | null>;
  onCreatePlaceholder?: (title: string, detailLevel: DetailLevel) => string | null;
  onFillPlaceholderCard?: (cardId: string, detailLevel: DetailLevel, content: string, newTitle?: string) => void;
  onRemovePlaceholderCard?: (cardId: string, detailLevel: DetailLevel) => void;
  onRequestCardGeneration?: (promptText: string, detailLevel: DetailLevel) => void;
  externalPlaceholderRef?: React.MutableRefObject<{ cardId: string; level: DetailLevel } | null>;
  onInitiateChat?: () => void;
  qualityStatus?: 'green' | 'amber' | 'red' | 'stale' | null;
  onViewLog?: () => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({
  isOpen,
  onToggle,
  messages,
  isLoading,
  onSendMessage,
  onSaveAsCard,
  onClearChat,
  onStop,
  documents,
  pendingDocChanges,
  hasConversation,
  onDocChangeContinue,
  onDocChangeStartFresh,
  tabBarRef,
  onCreatePlaceholder,
  onFillPlaceholderCard,
  onRemovePlaceholderCard,
  onRequestCardGeneration,
  externalPlaceholderRef,
  onInitiateChat,
  qualityStatus,
  onViewLog,
}) => {
  const { darkMode } = useThemeContext();
  const { shouldRender, isClosing, overlayStyle } = usePanelOverlay({
    isOpen,
    defaultWidth: Math.min(window.innerWidth * 0.5, 750),
    minWidth: 300,
    anchorRef: tabBarRef,
  });
  const [inputText, setInputText] = useState('');
  const [showSendMenu, setShowSendMenu] = useState(false);
  const [showCardSubmenu, setShowCardSubmenu] = useState(false);
  const [sendMenuPos, setSendMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const sendMenuRef = useRef<HTMLDivElement>(null);
  const sendBtnRef = useRef<HTMLDivElement>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMessagesRef = useRef<typeof messages>(messages);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  // Auto-expand document log for the first assistant message (initiate chat response)
  const initDocLogExpandedRef = useRef(false);
  useEffect(() => {
    // Reset when chat is cleared so next initiation auto-expands again
    if (messages.length === 0) {
      initDocLogExpandedRef.current = false;
      return;
    }
    if (initDocLogExpandedRef.current) return;
    if (messages.length === 1 && messages[0].role === 'assistant') {
      const docLogRegex = /```document-log\n[\s\S]*?```/;
      if (docLogRegex.test(messages[0].content)) {
        const docLogKey = messages[0].id + '-doclog';
        setExpandedCards((prev) => {
          if (prev.has(docLogKey)) return prev;
          const next = new Set(prev);
          next.add(docLogKey);
          return next;
        });
        initDocLogExpandedRef.current = true;
      }
    }
  }, [messages]);

  // ── Document change notice state ──
  const [showDocChangeNotice, setShowDocChangeNotice] = useState(false);
  const [pendingSendText, setPendingSendText] = useState('');
  const [pendingSendIsCard, setPendingSendIsCard] = useState(false);
  const [pendingSendLevel, setPendingSendLevel] = useState<DetailLevel | undefined>(undefined);

  // Track placeholder card created for the in-flight "Generate Card" request
  const pendingPlaceholderRef = useRef<{ cardId: string; level: DetailLevel } | null>(null);

  // Auto-save card content as card when a NEW card message arrives during this session.
  // Skip messages that already exist when the component mounts or when messages are first loaded.
  const autoSavedRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) {
      // First run: seed with all existing message IDs so we don't auto-save restored messages
      // Also auto-expand any existing card messages
      const cardIds: string[] = [];
      for (const msg of messages) {
        autoSavedRef.current.add(msg.id);
        if (msg.isCardContent && msg.role === 'assistant') cardIds.push(msg.id);
      }
      if (cardIds.length > 0) {
        setExpandedCards((prev) => {
          const next = new Set(prev);
          for (const id of cardIds) next.add(id);
          return next;
        });
      }
      initializedRef.current = true;
      return;
    }
    for (const msg of messages) {
      if (msg.isCardContent && msg.role === 'assistant' && !msg.savedAsCardId && !autoSavedRef.current.has(msg.id)) {
        autoSavedRef.current.add(msg.id);

        // Auto-expand new card content
        setExpandedCards((prev) => {
          if (prev.has(msg.id)) return prev;
          const next = new Set(prev);
          next.add(msg.id);
          return next;
        });

        // Check external (folder-picker flow) placeholder first, then internal
        const pending = externalPlaceholderRef?.current || pendingPlaceholderRef.current;
        if (pending && onFillPlaceholderCard) {
          // Fill the existing placeholder with real content + extract H1 as title
          // Strip suggestions block — it's for the chat UI, not for card storage
          const cardContent = stripSuggestionsBlock(msg.content);
          const titleMatch = cardContent.match(/^#\s+(.+)$/m);
          const newTitle = titleMatch ? titleMatch[1].trim() : undefined;
          onFillPlaceholderCard(pending.cardId, pending.level, cardContent, newTitle);
          if (externalPlaceholderRef?.current) externalPlaceholderRef.current = null;
          pendingPlaceholderRef.current = null;
        } else {
          // Fallback: no placeholder exists, create card directly
          onSaveAsCard(msg, stripSuggestionsBlock(msg.content));
        }
      }
    }
  }, [messages, onSaveAsCard, onFillPlaceholderCard, externalPlaceholderRef]);

  // Clean up placeholder if loading ends without a card being filled (error case)
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    const activePlaceholder = externalPlaceholderRef?.current || pendingPlaceholderRef.current;
    if (prevLoadingRef.current && !isLoading && activePlaceholder) {
      // Give a brief delay so the auto-save effect can run first
      const timer = setTimeout(() => {
        const current = externalPlaceholderRef?.current || pendingPlaceholderRef.current;
        if (current) {
          onRemovePlaceholderCard?.(current.cardId, current.level);
          if (externalPlaceholderRef?.current) externalPlaceholderRef.current = null;
          pendingPlaceholderRef.current = null;
        }
      }, 200);
      prevLoadingRef.current = isLoading;
      return () => clearTimeout(timer);
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading, onRemovePlaceholderCard]);

  // Scroll: instant on load/nugget switch, smooth on new messages
  useEffect(() => {
    const prev = prevMessagesRef.current;
    const isAppend =
      messages.length > prev.length && prev.length > 0 && messages[prev.length - 1] === prev[prev.length - 1];
    if (isAppend || isLoading) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }
    prevMessagesRef.current = messages;
  }, [messages, isLoading]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px';
    }
  }, [inputText]);

  // Send as regular chat message
  const handleSend = useCallback(() => {
    if (!inputText.trim() || isLoading) return;
    const text = inputText.trim();
    if (pendingDocChanges && pendingDocChanges.length > 0 && hasConversation && onDocChangeContinue) {
      setPendingSendText(text);
      setPendingSendIsCard(false);
      setPendingSendLevel(undefined);
      setShowDocChangeNotice(true);
      return;
    }
    onSendMessage(text, false);
    setInputText('');
  }, [inputText, isLoading, onSendMessage, pendingDocChanges, hasConversation, onDocChangeContinue]);

  // Send as card with specific detail level
  const handleSendAsCard = useCallback(
    (level: DetailLevel) => {
      if (!inputText.trim() || isLoading) return;
      const text = inputText.trim();
      setShowSendMenu(false);
      if (pendingDocChanges && pendingDocChanges.length > 0 && hasConversation && onDocChangeContinue) {
        setPendingSendText(text);
        setPendingSendIsCard(true);
        setPendingSendLevel(level);
        setShowDocChangeNotice(true);
        return;
      }
      // Route through folder picker if available
      if (onRequestCardGeneration) {
        onRequestCardGeneration(text, level);
        setInputText('');
        return;
      }
      // Fallback: create placeholder directly (no folder selection)
      if (onCreatePlaceholder) {
        const placeholderId = onCreatePlaceholder(text, level);
        if (placeholderId) {
          pendingPlaceholderRef.current = { cardId: placeholderId, level };
        }
      }
      onSendMessage(text, true, level);
      setInputText('');
    },
    [inputText, isLoading, onSendMessage, pendingDocChanges, hasConversation, onDocChangeContinue, onCreatePlaceholder, onRequestCardGeneration],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Close send menu on outside click or Escape
  useEffect(() => {
    if (!showSendMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (
        sendMenuRef.current &&
        !sendMenuRef.current.contains(e.target as Node) &&
        sendBtnRef.current &&
        !sendBtnRef.current.contains(e.target as Node)
      ) {
        setShowSendMenu(false);
        setShowCardSubmenu(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowSendMenu(false);
        setShowCardSubmenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [showSendMenu]);

  const handleCopyChatMarkdown = useCallback(() => {
    const text = messages
      .map((m) => {
        if (m.role === 'user') return `**You:** ${m.content}`;
        if (m.role === 'system') return `> ${m.content}`;
        return `**Claude:** ${m.content}`;
      })
      .join('\n\n');
    if (text) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [messages]);

  const _startEditing = (msg: ChatMessage) => {
    setEditingMessageId(msg.id);
    setEditContent(msg.content);
  };

  const handleSaveCard = (msg: ChatMessage) => {
    const raw = editingMessageId === msg.id ? editContent : msg.content;
    onSaveAsCard(msg, stripSuggestionsBlock(raw));
    setEditingMessageId(null);
  };

  const handleCopyMessage = (msg: ChatMessage) => {
    navigator.clipboard.writeText(msg.content);
    setCopiedMsgId(msg.id);
    setTimeout(() => setCopiedMsgId(null), 1500);
  };

  const parseDocumentLog = useCallback((content: string): { body: string; docLog: string | null } => {
    const regex = /```document-log\n([\s\S]*?)```/;
    const match = content.match(regex);
    if (!match) return { body: content, docLog: null };
    const body = content.replace(regex, '').trimEnd();
    return { body, docLog: match[1].trim() };
  }, []);

  /** Extract suggestion prompts from a ```card-suggestions fenced block in the response.
   *  The server wraps suggestions in this block (like document-log). Strips the fence,
   *  parses individual lines, and removes list markers. */
  const parseSuggestions = useCallback(
    (body: string): { cleanBody: string; suggestions: string[] } => {
      const regex = /```card-suggestions(?:\s+multi)?\n([\s\S]*?)```/;
      const match = body.match(regex);
      if (!match) return { cleanBody: body, suggestions: [] };

      const suggestions = match[1]
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        // Strip markdown list markers (-, *, •, 1.)
        .map((l) => l.replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, ''));

      if (suggestions.length === 0) return { cleanBody: body, suggestions: [] };

      const cleanBody = body.replace(regex, '').trimEnd();
      return { cleanBody, suggestions };
    },
    [],
  );

  const renderMarkdown = (content: string) => {
    const html = sanitizeHtml(marked.parse(content, { async: false }) as string);
    return <div className="document-prose chat-prose" dangerouslySetInnerHTML={{ __html: html }} />;
  };

  const extractCardTitle = (content: string): string => {
    const match = content.match(/^#+\s+(.+)$/m);
    return match ? match[1].trim() : 'Card Content';
  };

  const toggleCardExpanded = (msgId: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  };

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <>
      {shouldRender &&
        createPortal(
          <>
          <div
            data-panel-overlay
            className="fixed z-[105] flex flex-col bg-white dark:bg-zinc-900 border shadow-[5px_0_6px_rgba(0,0,0,0.35)] overflow-hidden"
            style={{
              borderColor: 'rgb(51,115,196)',
              ...overlayStyle,
            }}
          >
            <div className="flex-1 overflow-y-auto px-3 [&>*]:max-w-2xl [&>*]:mx-auto">
                {/* ── Empty state ── */}
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center px-8">
                    <PanelRequirements level="sources" />
                    {documents.length > 0 && (
                      <>
                        <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800/50 rounded-full flex items-center justify-center mb-3">
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            className="text-zinc-500 dark:text-zinc-400"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                          </svg>
                        </div>
                        {onInitiateChat && (
                          <button
                            onClick={onInitiateChat}
                            disabled={isLoading}
                            className="px-5 py-1.5 rounded-full text-[11px] font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-40 disabled:pointer-events-none transition-colors mb-2"
                          >
                            Initiate Chat
                          </button>
                        )}
                        <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-light max-w-xs">
                          Reviews your documents and suggests exploration prompts
                        </p>
                      </>
                    )}
                  </div>
                )}

                {messages.map((msg, msgIndex) => {
                  // System messages — collapsible, collapsed by default
                  if (msg.role === 'system') {
                    const noticeHtml = sanitizeHtml(marked.parse(msg.content, { async: false }) as string);
                    // Extract header: first line stripped of markdown brackets/formatting, truncated to 60 chars
                    const firstLine = msg.content.split('\n').find((l) => l.trim()) || 'System Update';
                    const headerText = firstLine.replace(/^\[|\]$|^\*\*|\*\*$/g, '').trim();
                    const truncatedHeader = headerText.length > 60 ? headerText.slice(0, 57) + '...' : headerText;
                    const isExpanded = expandedCards.has(msg.id);
                    return (
                      <div key={msg.id} className="px-5 py-2">
                        <div
                          className="rounded-xl overflow-hidden"
                          style={{
                            backgroundColor: 'rgba(42, 159, 212, 0.06)',
                            border: '1px solid rgba(42, 159, 212, 0.2)',
                          }}
                        >
                          <button
                            onClick={() => toggleCardExpanded(msg.id)}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                          >
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className={`shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                              style={{ color: '#1a7aaa' }}
                            >
                              <path d="m9 18 6-6-6-6" />
                            </svg>
                            <span className="text-[10px] font-medium truncate" style={{ color: '#1a7aaa' }}>
                              {truncatedHeader}
                            </span>
                          </button>
                          {isExpanded && (
                            <div
                              className="px-4 pb-3 system-notice-prose text-[11px] leading-relaxed"
                              style={{ color: '#1a7aaa' }}
                              dangerouslySetInnerHTML={{ __html: noticeHtml }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  }

                  // User messages
                  if (msg.role === 'user') {
                    return (
                      <div key={msg.id} className="group/msg px-5 py-3 flex justify-end">
                        <div className="max-w-[85%]">
                          <p className="text-[12px] text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed bg-zinc-100 dark:bg-zinc-800/50 rounded-2xl rounded-br-md px-4 py-2.5">
                            {msg.content}
                          </p>
                          <div className="flex items-center justify-end gap-2 mt-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              {formatTime(msg.timestamp)}
                            </span>
                            <button
                              onClick={() => handleCopyMessage(msg)}
                              title="Copy"
                              className="p-0.5 rounded text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                            >
                              {copiedMsgId === msg.id ? (
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="#22c55e"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M20 6L9 17l-5-5" />
                                </svg>
                              ) : (
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <rect x="9" y="9" width="12" height="12" rx="2" ry="2" />
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // Assistant messages — parse doc-log + suggestions
                  const { body: rawBody, docLog } = parseDocumentLog(msg.content);
                  const { cleanBody: body, suggestions } = parseSuggestions(rawBody);
                  const docLogKey = msg.id + '-doclog';
                  const docLogLineCount = docLog ? docLog.split('\n').filter((l) => l.trim()).length : 0;
                  return (
                    <div key={msg.id} className="group/msg px-5 py-3">
                      {/* Document log — collapsible, collapsed by default */}
                      {docLog && (
                        <div
                          className="mb-2 rounded-xl overflow-hidden border"
                          style={{
                            backgroundColor: 'rgba(42, 159, 212, 0.04)',
                            borderColor: 'rgba(42, 159, 212, 0.15)',
                          }}
                        >
                          <button
                            onClick={() => toggleCardExpanded(docLogKey)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                          >
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className={`shrink-0 transition-transform duration-150 ${expandedCards.has(docLogKey) ? 'rotate-90' : ''}`}
                              style={{ color: '#1a7aaa' }}
                            >
                              <path d="m9 18 6-6-6-6" />
                            </svg>
                            <span className="text-[10px] font-medium" style={{ color: '#1a7aaa' }}>
                              Documents ({docLogLineCount} {docLogLineCount === 1 ? 'source' : 'sources'})
                            </span>
                          </button>
                          {expandedCards.has(docLogKey) && (
                            <div className="px-4 pb-2.5 text-[11px]" style={{ color: '#1a7aaa' }}>
                              {renderMarkdown(docLog)}
                            </div>
                          )}
                        </div>
                      )}
                      <div
                        className={`max-w-[95%] ${msg.isCardContent ? 'bg-zinc-50 dark:bg-zinc-800 rounded-xl border border-zinc-300 dark:border-zinc-600 overflow-hidden' : ''}`}
                      >
                        {/* Card content — collapsible, default collapsed */}
                        {msg.isCardContent ? (
                          <>
                            <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors">
                              <button
                                onClick={() => toggleCardExpanded(msg.id)}
                                className="flex items-center gap-2 min-w-0 text-left"
                              >
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className={`shrink-0 text-zinc-500 dark:text-zinc-400 transition-transform duration-150 ${expandedCards.has(msg.id) ? 'rotate-90' : ''}`}
                                >
                                  <path d="m9 18 6-6-6-6" />
                                </svg>
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-white bg-zinc-900 px-2 py-0.5 rounded-full shrink-0">
                                  Card
                                </span>
                                {msg.detailLevel && (
                                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400 shrink-0">
                                    {msg.detailLevel}
                                  </span>
                                )}
                                <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400 truncate">
                                  {extractCardTitle(body)}
                                </span>
                              </button>
                              {/* Actions — always visible */}
                              <div className="flex items-center gap-1.5 ml-auto shrink-0">
                                <div className="flex items-center gap-1 px-0.5" title="Card content (auto-saved)">
                                  <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="#22c55e"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M20 6L9 17l-5-5" />
                                  </svg>
                                  <span className="text-[10px] text-green-600/60">Saved</span>
                                </div>
                                <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                                  {formatTime(msg.timestamp)}
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopyMessage(msg);
                                  }}
                                  title="Copy"
                                  className="p-0.5 rounded text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                                >
                                  {copiedMsgId === msg.id ? (
                                    <svg
                                      width="16"
                                      height="16"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="#22c55e"
                                      strokeWidth="2.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <path d="M20 6L9 17l-5-5" />
                                    </svg>
                                  ) : (
                                    <svg
                                      width="16"
                                      height="16"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <rect x="9" y="9" width="12" height="12" rx="2" ry="2" />
                                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                    </svg>
                                  )}
                                </button>
                              </div>
                            </div>
                            {expandedCards.has(msg.id) && <div className="px-4 pb-3">{renderMarkdown(body)}</div>}
                          </>
                        ) : (
                          <>
                            {/* Content */}
                            {renderMarkdown(body)}

                            {/* Actions — timestamp, copy, add as card */}
                            <div className="flex items-center gap-2.5 mt-2">
                              <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                                {formatTime(msg.timestamp)}
                              </span>
                              <button
                                onClick={() => handleCopyMessage(msg)}
                                title="Copy"
                                className="p-1 rounded text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                              >
                                {copiedMsgId === msg.id ? (
                                  <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="#22c55e"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M20 6L9 17l-5-5" />
                                  </svg>
                                ) : (
                                  <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <rect x="9" y="9" width="12" height="12" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                  </svg>
                                )}
                              </button>
                              {/* Save as card */}
                              {!msg.savedAsCardId ? (
                                <button
                                  onClick={() => handleSaveCard(msg)}
                                  title="Add as card"
                                  className="p-1 rounded text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                                >
                                  <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <rect width="16" height="16" x="3" y="3" rx="2" />
                                    <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2" />
                                    <path d="M3 11h3c.8 0 1.6.3 2.1.9l1.1.9c1.6 1.6 4.1 1.6 5.7 0l1.1-.9c.5-.5 1.3-.9 2.1-.9H21" />
                                  </svg>
                                </button>
                              ) : (
                                <div className="flex items-center gap-1.5 px-0.5" title="Saved as card">
                                  <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="#22c55e"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M20 6L9 17l-5-5" />
                                  </svg>
                                  <span className="text-[10px] text-green-600/60">Saved</span>
                                </div>
                              )}
                            </div>

                            {/* Quality warning — UI-only, not part of message content */}
                            {qualityStatus === 'red' && (
                              <p style={{ color: '#dc2626', fontStyle: 'italic', fontSize: '12px', marginTop: '8px' }}>
                                There are issues identified in the documents used in this chat, revising the sources is recommended
                              </p>
                            )}

                            {/* Suggestion prompts — clickable buttons */}
                            {suggestions.length > 0 && (
                              <div className="flex flex-col gap-1.5 mt-3">
                                {suggestions.map((suggestion, sIdx) => (
                                  <button
                                    key={sIdx}
                                    onClick={() => {
                                      setInputText(suggestion);
                                      textareaRef.current?.focus();
                                    }}
                                    className="text-left text-[11px] px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors leading-snug"
                                  >
                                    {suggestion}
                                  </button>
                                ))}
                              </div>
                            )}

                          </>
                        )}
                      </div>
                      {/* Suggestion prompts after card generation — outside card body */}
                      {msg.isCardContent && suggestions.length > 0 && (
                        <div className="flex flex-col gap-1.5 mt-3 max-w-[95%]">
                          {suggestions.map((suggestion, sIdx) => (
                            <button
                              key={sIdx}
                              onClick={() => {
                                setInputText(suggestion);
                                textareaRef.current?.focus();
                              }}
                              className="text-left text-[11px] px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors leading-snug"
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                <div ref={messagesEndRef} />
              </div>

              {/* Input area */}
              <div className="shrink-0 px-4 py-3 max-w-2xl mx-auto w-full">
                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 transition-shadow">
                  <textarea
                    ref={textareaRef}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about your documents..."
                    aria-label="Chat message"
                    disabled={isLoading}
                    rows={2}
                    className="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none disabled:opacity-50 placeholder:text-zinc-500"
                  />
                  <div className="flex items-center justify-between px-2 pb-2">
                    {/* Left actions */}
                    <div className="flex items-center gap-1.5">
                      {/* Copy chat as markdown */}
                      {messages.length > 0 && (
                        <button
                          onClick={handleCopyChatMarkdown}
                          title="Copy chat as Markdown"
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                        >
                          {copied ? (
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#22c55e"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <rect width="16" height="16" x="8" y="8" rx="2" ry="2" />
                              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                            </svg>
                          )}
                        </button>
                      )}
                      {/* Clear chat */}
                      {messages.length > 0 && (
                        <button
                          onClick={onClearChat}
                          title="Clear chat"
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M3 6h18" />
                            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          </svg>
                        </button>
                      )}
                    </div>

                    {/* Send / Stop */}
                    {isLoading ? (
                      <button
                        onClick={onStop}
                        title="Stop response"
                        className="w-8 h-8 rounded-lg bg-zinc-900 text-white flex items-center justify-center hover:bg-zinc-700 transition-colors animate-pulse"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="animate-[spin_3s_linear_infinite]"
                        >
                          <circle
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeDasharray="20 43"
                          />
                          <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" />
                        </svg>
                      </button>
                    ) : (
                      <div ref={sendBtnRef}>
                        <button
                          onClick={() => {
                            if (!showSendMenu && sendBtnRef.current) {
                              const rect = sendBtnRef.current.getBoundingClientRect();
                              setSendMenuPos({ x: rect.right, y: rect.top });
                            }
                            setShowSendMenu((prev) => !prev);
                            setShowCardSubmenu(false);
                          }}
                          onMouseEnter={() => {
                            if (!showSendMenu && inputText.trim() && sendBtnRef.current) {
                              const rect = sendBtnRef.current.getBoundingClientRect();
                              setSendMenuPos({ x: rect.right, y: rect.top });
                              setShowSendMenu(true);
                              setShowCardSubmenu(false);
                            }
                          }}
                          disabled={!inputText.trim()}
                          title="Send options"
                          className="w-8 h-8 rounded-lg bg-zinc-900 text-white flex items-center justify-center hover:bg-zinc-800 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M6 12L3.269 3.126A59.768 59.768 0 0 1 21.485 12 59.77 59.77 0 0 1 3.27 20.876L5.999 12Zm0 0h7.5" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Document change notice */}
              {showDocChangeNotice && pendingDocChanges && pendingDocChanges.length > 0 && (
                <DocumentChangeNotice
                  changes={pendingDocChanges}
                  onContinue={() => {
                    setShowDocChangeNotice(false);
                    onDocChangeContinue?.(pendingSendText, pendingSendIsCard, pendingSendLevel);
                    setInputText('');
                  }}
                  onStartFresh={() => {
                    setShowDocChangeNotice(false);
                    onDocChangeStartFresh?.();
                  }}
                  onCancel={() => setShowDocChangeNotice(false)}
                  onViewLog={onViewLog}
                />
              )}

              {/* Send menu — rendered as portal to escape overflow clipping */}
              {showSendMenu &&
                createPortal(
                  <div
                    ref={sendMenuRef}
                    className="fixed min-w-[180px] bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 py-1 z-[200]"
                    style={{
                      right: Math.max(8, window.innerWidth - sendMenuPos.x),
                      bottom: Math.max(8, window.innerHeight - sendMenuPos.y + 6),
                    }}
                  >
                    {/* Send Message option */}
                    <button
                      onClick={() => {
                        setShowSendMenu(false);
                        setShowCardSubmenu(false);
                        handleSend();
                      }}
                      className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center gap-2"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-zinc-500"
                      >
                        <path d="M6 12L3.269 3.126A59.768 59.768 0 0 1 21.485 12 59.77 59.77 0 0 1 3.27 20.876L5.999 12Zm0 0h7.5" />
                      </svg>
                      Send Message
                    </button>

                    <div className="h-px bg-zinc-100 dark:bg-zinc-700 my-1" />

                    {/* Generate Card — with submenu */}
                    <div
                      className="relative"
                      onMouseEnter={() => setShowCardSubmenu(true)}
                      onMouseLeave={() => setShowCardSubmenu(false)}
                    >
                      <button className="w-full text-left px-3 py-2 text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="text-zinc-500"
                          >
                            <rect x="3" y="3" width="16" height="16" rx="2" />
                            <path d="M12 8v8" />
                            <path d="M8 12h8" />
                          </svg>
                          Generate Card
                        </span>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-zinc-500 dark:text-zinc-400"
                        >
                          <polyline points="15 18 9 12 15 6" />
                        </svg>
                      </button>

                      {/* Detail level submenu */}
                      {showCardSubmenu && (
                        <div className="absolute right-full bottom-0 mr-1 min-w-[160px] bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 py-1 z-[201]">
                          {[
                            { level: 'Executive' as DetailLevel, label: 'Executive', desc: '50-70 words' },
                            { level: 'Standard' as DetailLevel, label: 'Standard', desc: '120-150 words' },
                            { level: 'Detailed' as DetailLevel, label: 'Detailed', desc: '250-300 words' },
                          ].map((opt) => (
                            <button
                              key={opt.level}
                              onClick={() => handleSendAsCard(opt.level)}
                              className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center justify-between gap-3"
                            >
                              <span className="font-medium">{opt.label}</span>
                              <span className="text-[9px] text-zinc-500 dark:text-zinc-400">{opt.desc}</span>
                            </button>
                          ))}

                          {/* Divider */}
                          <div className="h-px bg-zinc-100 dark:bg-zinc-700 my-1" />

                          {/* Takeaway card option */}
                          {[
                            {
                              level: 'TakeawayCard' as DetailLevel,
                              label: 'Takeaway Card',
                              desc: 'Title + Key Takeaways',
                            },
                          ].map((opt) => (
                            <button
                              key={opt.level}
                              onClick={() => handleSendAsCard(opt.level)}
                              className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center justify-between gap-3"
                            >
                              <span className="font-medium text-violet-600">{opt.label}</span>
                              <span className="text-[9px] text-zinc-500 dark:text-zinc-400">{opt.desc}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>,
                  document.body,
                )}
          </div>
          </>,
          document.body,
        )}
    </>
  );
};

export default React.memo(ChatPanel);
