"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, MessageSquare, Search, ChevronLeft,
  Sparkles, ArrowUp, CheckCircle2, Circle, Zap, Square
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = { id: string; role: "user" | "ai"; content: string; };
type Conversation = { id: string; title: string; };
type AgentName = "Clarity" | "Research" | "Validator" | "Synthesis";

const AGENT_FALLBACK_LABELS: Record<string, string> = {
  clarity:   "Locking onto your target…",
  research:  "Hunting live intelligence…",
  validator: "Stress-testing the data…",
  synthesis: "Forging your final report…",
};

const ALL_AGENTS: AgentName[] = ["Clarity", "Research", "Validator", "Synthesis"];
const AGENT_INDEX: Record<string, number> = { clarity: 0, research: 1, validator: 2, synthesis: 3 };

const SUGGESTIONS = [
  "Analyze Nvidia Q4 earnings", "Research Apple supply chain",
  "Compare OpenAI vs Anthropic", "Tesla 2025 market outlook",
];

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// ─── AI Avatar — neural spark orb ────────────────────────────────────────────
const AIAvatar = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="14" cy="14" r="14" fill="#7c3aed"/>
    {/* Outer ring arcs */}
    <circle cx="14" cy="14" r="9" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" fill="none"/>
    {/* Central diamond */}
    <path d="M14 8.5L16.5 14L14 19.5L11.5 14Z" fill="white" fillOpacity="0.9"/>
    <path d="M8.5 14L14 11.5L19.5 14L14 16.5Z" fill="white" fillOpacity="0.55"/>
    {/* Corner spark dots */}
    <circle cx="14" cy="5.5" r="1.2" fill="white" fillOpacity="0.7"/>
    <circle cx="22.5" cy="14" r="1.2" fill="white" fillOpacity="0.7"/>
    <circle cx="14" cy="22.5" r="1.2" fill="white" fillOpacity="0.7"/>
    <circle cx="5.5" cy="14" r="1.2" fill="white" fillOpacity="0.7"/>
    {/* Tiny diagonal sparks */}
    <circle cx="19.8" cy="8.2" r="0.8" fill="white" fillOpacity="0.45"/>
    <circle cx="19.8" cy="19.8" r="0.8" fill="white" fillOpacity="0.45"/>
    <circle cx="8.2" cy="19.8" r="0.8" fill="white" fillOpacity="0.45"/>
    <circle cx="8.2" cy="8.2" r="0.8" fill="white" fillOpacity="0.45"/>
  </svg>
);

// ─── User Avatar — geometric initials shield ──────────────────────────────────
const UserAvatar = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    {/* Hexagonal background */}
    <path d="M14 1.5L25.3 8V20L14 26.5L2.7 20V8Z" fill="#e4e4e7" stroke="#d4d4d8" strokeWidth="0.6"/>
    {/* Head circle */}
    <circle cx="14" cy="11" r="4" fill="#a1a1aa"/>
    {/* Shoulders arc */}
    <path d="M6.5 23C6.5 18.5 9.8 15.5 14 15.5C18.2 15.5 21.5 18.5 21.5 23" fill="#a1a1aa"/>
  </svg>
);

// ─── Plain markdown renderer for finished messages ────────────────────────────
const MarkdownBody = ({ content }: { content: string }) => (
  <div className="markdown-body">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  </div>
);

// ─── ThinkingIndicator ────────────────────────────────────────────────────────
const ThinkingIndicator = ({ label }: { label: string }) => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -4 }}
    className="flex items-start gap-3"
  >
    <div className="flex-shrink-0 mt-0.5">
      <AIAvatar size={28} />
    </div>
    <div className="flex items-center gap-3 bg-zinc-50 border border-zinc-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
      <div className="w-3.5 h-3.5 rounded-full border-2 border-zinc-200 border-t-violet-500 animate-spin flex-shrink-0" />
      <AnimatePresence mode="wait">
        <motion.span
          key={label}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.2 }}
          className="text-sm text-zinc-500"
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </div>
  </motion.div>
);

// ─── TypewriterText ───────────────────────────────────────────────────────────
// Receives an external queue ref that the parent fills with new chunks.
// Independently drains it letter-by-letter on a fast timer, completely
// decoupled from React render cycles / network batch timing.
const CHARS_PER_TICK = 4;  // characters printed per tick  — raise to go faster
const TICK_MS        = 14; // ms between ticks             — lower to go faster

function TypewriterText({
  queueRef,
  onHasContent,
}: {
  queueRef: React.MutableRefObject<string>;
  onHasContent: () => void;
}) {
  const [displayed, setDisplayed] = useState("");
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasCalledRef = useRef(false);

  // Start the drain loop once on mount; it keeps itself alive via recursion.
  useEffect(() => {
    const tick = () => {
      if (queueRef.current.length > 0) {
        const take  = Math.min(CHARS_PER_TICK, queueRef.current.length);
        const chars = queueRef.current.slice(0, take);
        queueRef.current = queueRef.current.slice(take);

        setDisplayed((prev) => prev + chars);

        // Signal parent that we have visible content (once only)
        if (!hasCalledRef.current) {
          hasCalledRef.current = true;
          onHasContent();
        }
      }
      timerRef.current = setTimeout(tick, TICK_MS);
    };

    timerRef.current = setTimeout(tick, TICK_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayed}</ReactMarkdown>
    </div>
  );
}

// ─── MessageBubble ────────────────────────────────────────────────────────────
function MessageBubble({
  msg,
  typewriterQueue,
  onTypewriterHasContent,
}: {
  msg: Message;
  // If non-null this message is actively streaming and should use the typewriter
  typewriterQueue: React.MutableRefObject<string> | null;
  onTypewriterHasContent: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (msg.role === "user") {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
        <div className="flex items-end gap-2.5 max-w-[78%]">
          <div className="bg-violet-600 text-white rounded-2xl rounded-br-sm px-4 py-3 text-sm leading-relaxed shadow-sm">
            {msg.content}
          </div>
          <div className="flex-shrink-0 mb-0.5">
            <UserAvatar size={28} />
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-3">
      <div className="flex-shrink-0 mt-1">
        <AIAvatar size={28} />
      </div>
      <div className="flex-1 min-w-0 max-w-[95%] bg-white border border-zinc-100 rounded-2xl rounded-tl-sm px-6 py-5 shadow-sm">
        {typewriterQueue ? (
          <TypewriterText queueRef={typewriterQueue} onHasContent={onTypewriterHasContent} />
        ) : (
          <MarkdownBody content={msg.content} />
        )}
        {!typewriterQueue && msg.content.trim() && (
          <div className="flex justify-end mt-3 pt-3 border-t border-zinc-50">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 transition-all"
              aria-label="Copy response"
            >
              {copied ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                    <path d="M2 7L5 10L11 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="text-emerald-500 font-medium">Copied</span>
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                    <rect x="4.5" y="1" width="7.5" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                    <path d="M1 4.5H3.5V12H9V11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
                  </svg>
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
type SidebarProps = {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  isOpen: boolean;
  activeAgentIndex: number;
};

const Sidebar = ({ conversations, activeId, onSelect, onNew, isOpen, activeAgentIndex }: SidebarProps) => (
  <motion.aside
    initial={false}
    animate={{ width: isOpen ? 240 : 0 }}
    transition={{ type: "spring", stiffness: 340, damping: 34 }}
    className="relative flex-shrink-0 overflow-hidden border-r border-zinc-100 bg-zinc-50"
  >
    <div className="flex flex-col h-full w-[240px]">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-zinc-100">
        <div className="flex-shrink-0">
          <AIAvatar size={32} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-800 leading-tight truncate">Research Agent</p>
          <p className="text-[11px] text-zinc-400 leading-tight">Multi-agent system</p>
        </div>
      </div>
      <div className="px-3 pt-3">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4 flex-shrink-0" /> New research
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        {conversations.length > 0 && (
          <p className="text-[10px] uppercase tracking-widest text-zinc-400 font-medium px-2 pb-2">Current Session</p>
        )}
        {conversations.map((conv) => (
          <button
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
              activeId === conv.id ? "bg-white shadow-sm text-zinc-800" : "hover:bg-zinc-100 text-zinc-500"
            }`}
          >
            <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 ${activeId === conv.id ? "text-violet-500" : "text-zinc-400"}`} />
            <p className="text-xs font-medium truncate">{conv.title}</p>
          </button>
        ))}
      </div>
      <div className="px-3 pb-4 pt-3 border-t border-zinc-100 space-y-1">
        <p className="text-[10px] uppercase tracking-widest text-zinc-400 font-medium px-2 pb-1">Agent pipeline</p>
        {ALL_AGENTS.map((agent, idx) => {
          const isActive = activeAgentIndex >= 0 && AGENT_INDEX[agent.toLowerCase()] === activeAgentIndex;
          const isDone   = activeAgentIndex >= 0 && idx < activeAgentIndex;
          return (
            <div key={agent} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg">
              {isDone ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
              ) : isActive ? (
                <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1.2 }}>
                  <Zap className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
                </motion.div>
              ) : (
                <Circle className="w-3.5 h-3.5 text-zinc-300 flex-shrink-0" />
              )}
              <span className={`text-xs ${isActive ? "text-violet-600 font-medium" : isDone ? "text-zinc-600" : "text-zinc-400"}`}>
                {agent} agent
              </span>
            </div>
          );
        })}
      </div>
    </div>
  </motion.aside>
);

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ModernChatDashboard() {
  const [chatHistory,    setChatHistory]    = useState<Record<string, Message[]>>({});
  const [input,          setInput]          = useState("");
  const [isLoading,      setIsLoading]      = useState(false);   // agents running, no text yet
  const [isStreaming,    setIsStreaming]     = useState(false);   // synthesis text arriving
  const [activeAgentIndex, setActiveAgentIndex] = useState(-1);
  const [currentLabel,   setCurrentLabel]   = useState("Initializing agents…");
  // Once the typewriter has printed its first character we hide the thinking indicator
  const [typewriterStarted, setTypewriterStarted] = useState(false);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [sidebarOpen,    setSidebarOpen]    = useState(true);
  const [conversations,  setConversations]  = useState<Conversation[]>([]);
  const [activeConvId,   setActiveConvId]   = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef      = useRef<HTMLDivElement>(null);
  const inputRef            = useRef<HTMLTextAreaElement>(null);
  const currentQueryRef     = useRef<string>("");
  const labelCacheRef       = useRef<Record<string, string>>({});

  // Auto-resize textarea up to ~5 lines (160px), then scroll inside
  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, []);

  // THE KEY FIX: the typewriter queue lives as a ref, not state.
  // The network loop writes to it; the TypewriterText component drains it.
  // Zero React re-renders involved in the data transfer between them.
  const typewriterQueueRef = useRef<string>("");

  const currentMessages = activeConvId ? (chatHistory[activeConvId] || []) : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentMessages, isLoading, isStreaming, typewriterStarted]);

  // ── Fetch dynamic label from /api/label ────────────────────────────────────
  const fetchAgentLabel = useCallback(async (agentKey: string, query: string) => {
    const cacheKey = `${agentKey}::${query}`;
    if (labelCacheRef.current[cacheKey]) return labelCacheRef.current[cacheKey];
    try {
      const res = await fetch("/api/label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: agentKey, query }),
      });
      if (!res.ok) throw new Error("label fetch failed");
      const data = await res.json();
      const label: string = data.label ?? AGENT_FALLBACK_LABELS[agentKey] ?? "Working…";
      labelCacheRef.current[cacheKey] = label;
      return label;
    } catch {
      return AGENT_FALLBACK_LABELS[agentKey] ?? "Working…";
    }
  }, []);

  const handleAgentChange = useCallback(async (agentKey: string) => {
    const query    = currentQueryRef.current;
    const fallback = AGENT_FALLBACK_LABELS[agentKey] ?? "Working…";
    setCurrentLabel(fallback);
    const aiLabel = await fetchAgentLabel(agentKey, query);
    setCurrentLabel(aiLabel);
  }, [fetchAgentLabel]);

  const handleNewChat = useCallback(() => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const newId = uid();
    setActiveConvId(newId);
    setChatHistory((prev) => ({ ...prev, [newId]: [] }));
    setInput("");
    setStreamingMsgId(null);
    typewriterQueueRef.current = "";
    labelCacheRef.current = {};
    inputRef.current?.focus();
  }, []);

  const handleSelectConversation = useCallback((id: string) => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    setActiveConvId(id);
    setStreamingMsgId(null);
    typewriterQueueRef.current = "";
  }, []);

  const handleStop = (e?: React.MouseEvent) => {
    e?.preventDefault();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
      setIsStreaming(false);
      setActiveAgentIndex(-1);
      setStreamingMsgId(null);
      typewriterQueueRef.current = "";
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading || isStreaming) return;

    const userText = input.trim();
    currentQueryRef.current = userText;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";

    labelCacheRef.current     = {};
    typewriterQueueRef.current = "";
    setTypewriterStarted(false);

    let currentThreadId = activeConvId;
    if (!currentThreadId) {
      currentThreadId = uid();
      setActiveConvId(currentThreadId);
      setConversations((prev) => [
        { id: currentThreadId as string, title: userText.length > 42 ? userText.slice(0, 42) + "…" : userText },
        ...prev,
      ]);
    }

    const aiMessageId = uid();
    setStreamingMsgId(aiMessageId);

    setChatHistory((prev) => ({
      ...prev,
      [currentThreadId as string]: [
        ...(prev[currentThreadId as string] || []),
        { id: uid(), role: "user",  content: userText },
        { id: aiMessageId, role: "ai", content: "" },
      ],
    }));

    setIsLoading(true);
    setActiveAgentIndex(0);

    // Pre-fetch all labels in parallel
    Object.keys(AGENT_FALLBACK_LABELS).forEach((key) => fetchAgentLabel(key, userText));

    handleAgentChange("clarity");

    abortControllerRef.current = new AbortController();

    try {
      const res = await fetch("/api/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ threadId: currentThreadId, message: userText }),
        signal:  abortControllerRef.current.signal,
      });

      if (!res.ok)    throw new Error("Failed to connect to backend");
      if (!res.body)  throw new Error("No readable stream available");

      setIsLoading(false);
      setIsStreaming(true);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let done   = false;
      let buffer = "";

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        const chunkValue = decoder.decode(value, { stream: true });
        if (!chunkValue && done) break;
        buffer += chunkValue;

        // Extract and handle control tags
        let tagMatch;
        while ((tagMatch = buffer.match(/\[\[(.*?)\]\]/))) {
          const fullTag  = tagMatch[0];
          const innerTag = tagMatch[1];

          if (innerTag === "DONE") {
            done = true;
          } else if (innerTag.startsWith("AGENT:")) {
            const agentKey = innerTag.split(":")[1].toLowerCase();
            const idx      = AGENT_INDEX[agentKey];
            if (idx !== undefined) {
              setActiveAgentIndex(idx);
              const cacheKey = `${agentKey}::${userText}`;
              const cached   = labelCacheRef.current[cacheKey];
              if (cached) setCurrentLabel(cached);
              else        handleAgentChange(agentKey);
            }
          }
          buffer = buffer.replace(fullTag, "");
        }

        // Protect partial tags at the end of the buffer
        const lastBracket = buffer.lastIndexOf("[[");
        let textToFlush   = buffer;
        if (lastBracket !== -1 && !buffer.includes("]]", lastBracket)) {
          textToFlush = buffer.slice(0, lastBracket);
        }

        if (textToFlush) {
          // ── TYPEWRITER INTEGRATION ──────────────────────────────────────────
          // Write directly into the ref queue. The TypewriterText component's
          // internal timer drains this independently — no setState, no batching.
          typewriterQueueRef.current += textToFlush;
          buffer = buffer.slice(textToFlush.length);

          // Also keep chatHistory in sync (for when the message is "done" and
          // switches from TypewriterText back to plain MarkdownBody)
          setChatHistory((prev) => {
            const threadMsgs = prev[currentThreadId as string] || [];
            // Rebuild full content from scratch each time to keep it accurate
            const currentMsg = threadMsgs.find((m) => m.id === aiMessageId);
            const newContent = (currentMsg?.content ?? "") + textToFlush;
            return {
              ...prev,
              [currentThreadId as string]: threadMsgs.map((msg) =>
                msg.id === aiMessageId ? { ...msg, content: newContent } : msg
              ),
            };
          });
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.log("Stream aborted by user");
      } else {
        console.error("Chat error:", error);
        setChatHistory((prev) => {
          const threadMsgs = prev[currentThreadId as string] || [];
          return {
            ...prev,
            [currentThreadId as string]: threadMsgs.map((msg) =>
              msg.id === aiMessageId ? { ...msg, content: "**Error:** Network issue." } : msg
            ),
          };
        });
      }
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      setActiveAgentIndex(-1);
      // Don't clear streamingMsgId immediately — let the typewriter finish draining.
      // We clear it after a generous delay so the last characters get typed out.
      setTimeout(() => {
        setStreamingMsgId(null);
        typewriterQueueRef.current = "";
      }, 3000);
      abortControllerRef.current = null;
    }
  };

  const handleSuggestion = (text: string) => {
    setInput(text);
    setTimeout(() => {
      (document.getElementById("chat-form") as HTMLFormElement)?.requestSubmit();
    }, 0);
  };

  // Show the thinking indicator ONLY when:
  // - agents are actually running (isLoading) OR synthesis is streaming (isStreaming)
  // - AND the typewriter hasn't started printing yet
  // Once the first character appears on screen, the thinking bubble disappears.
  const showThinking = (isLoading || isStreaming) && activeAgentIndex >= 0 && !typewriterStarted;

  return (
    <div className="flex h-screen bg-zinc-50 font-sans text-zinc-900 overflow-hidden">
      <Sidebar
        conversations={conversations}
        activeId={activeConvId}
        onSelect={handleSelectConversation}
        onNew={handleNewChat}
        isOpen={sidebarOpen}
        activeAgentIndex={showThinking ? activeAgentIndex : -1}
      />
      <div className="flex flex-col flex-1 min-w-0">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200 bg-white z-10">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen((o) => !o)}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-zinc-100 text-zinc-500 transition-colors"
            >
              <ChevronLeft className={`w-4 h-4 transition-transform duration-300 ${sidebarOpen ? "" : "rotate-180"}`} />
            </button>
            <div>
              <h1 className="text-sm font-semibold text-zinc-800 leading-tight">
                {activeConvId
                  ? conversations.find((c) => c.id === activeConvId)?.title ?? "Research session"
                  : "Multi-Agent Researcher"}
              </h1>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-6 md:px-10 py-6">
          <div className="max-w-3xl mx-auto flex flex-col gap-5 min-h-full">
            {currentMessages.length === 0 && !isLoading && !isStreaming && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center flex-1 px-6 text-center mt-20"
              >
                <div className="w-14 h-14 rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center mb-5">
                  <Sparkles className="w-7 h-7 text-violet-500" />
                </div>
                <h2 className="text-xl font-semibold text-zinc-800 mb-2">What shall we research?</h2>
                <div className="flex flex-wrap gap-2 justify-center max-w-lg mt-6">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleSuggestion(s)}
                      className="text-xs px-4 py-2 rounded-full border border-zinc-200 bg-white hover:border-violet-300 hover:text-violet-600 text-zinc-600 transition-colors shadow-sm"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {currentMessages.map((msg) => {
              // Hide AI bubble while: it has no content AND agents are still running
              if (msg.role === "ai" && msg.content.trim() === "" && (isLoading || isStreaming)) {
                return null;
              }
              const isActiveStream = msg.id === streamingMsgId;
              return (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  typewriterQueue={isActiveStream ? typewriterQueueRef : null}
                  onTypewriterHasContent={() => setTypewriterStarted(true)}
                />
              );
            })}

            {/* Thinking indicator — disappears the moment typewriter starts printing */}
            <AnimatePresence>
              {showThinking && <ThinkingIndicator label={currentLabel} />}
            </AnimatePresence>

            <div ref={messagesEndRef} />
          </div>
        </main>

        <footer className="px-6 md:px-10 py-5 border-t border-zinc-200 bg-white">
          <div className="max-w-3xl mx-auto">
            <form
              id="chat-form"
              onSubmit={handleSubmit}
              className="flex items-start bg-zinc-50 border border-zinc-300 rounded-2xl px-4 py-3 gap-3 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100 transition-all shadow-sm"
            >
              <Search className="w-4 h-4 text-zinc-400 flex-shrink-0 mt-[11px]" />
              <textarea
                ref={inputRef}
                value={input}
                rows={2}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoResize();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    (document.getElementById("chat-form") as HTMLFormElement)?.requestSubmit();
                  }
                }}
                placeholder="Enter a company name or business question… "
                className="flex-1 bg-transparent text-sm text-zinc-800 placeholder:text-zinc-500 outline-none resize-none leading-relaxed overflow-y-auto"
                style={{ minHeight: "48px", maxHeight: "160px" }}
                disabled={isLoading || isStreaming}
                autoComplete="off"
              />
              {isLoading || isStreaming ? (
                <button
                  onClick={handleStop}
                  type="button"
                  className="w-8 h-8 rounded-xl bg-zinc-800 hover:bg-zinc-900 flex items-center justify-center transition-colors flex-shrink-0 group mt-[7px]"
                  aria-label="Stop Generation"
                >
                  <Square className="w-3.5 h-3.5 fill-white text-white group-hover:scale-95 transition-transform" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="w-8 h-8 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center transition-colors flex-shrink-0 mt-[7px]"
                  aria-label="Send"
                >
                  <ArrowUp className="w-4 h-4 text-white" />
                </button>
              )}
            </form>
          </div>
        </footer>
      </div>
    </div>
  );
}