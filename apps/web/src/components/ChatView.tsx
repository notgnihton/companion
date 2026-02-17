import { Fragment, ReactNode, useEffect, useRef, useState } from "react";
import { sendChatMessage, getChatHistory, submitJournalEntry } from "../lib/api";
import { ChatCitation, ChatMessage } from "../types";
import { loadTalkModeEnabled, saveTalkModeEnabled } from "../lib/storage";

function getSpeechRecognitionCtor(): (new () => SpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & { webkitSpeechRecognition?: typeof SpeechRecognition };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function latestAssistantMessage(messages: ChatMessage[]): ChatMessage | null {
  const assistantMessages = messages.filter((message) => message.role === "assistant" && !message.streaming && message.content);
  if (assistantMessages.length === 0) {
    return null;
  }

  return assistantMessages.reduce((latest, current) => {
    return new Date(current.timestamp).getTime() > new Date(latest.timestamp).getTime() ? current : latest;
  });
}

interface CitationLinkTarget {
  tab: "schedule" | "journal" | "social" | "settings";
  deadlineId?: string;
  lectureId?: string;
  journalId?: string;
  section?: string;
}

function toCitationTarget(citation: ChatCitation): CitationLinkTarget {
  switch (citation.type) {
    case "deadline":
      return { tab: "schedule", deadlineId: citation.id };
    case "schedule":
      return { tab: "schedule", lectureId: citation.id };
    case "journal":
      return { tab: "journal", journalId: citation.id };
    case "email":
      return { tab: "settings", section: "integrations" };
    case "social-youtube":
    case "social-x":
      return { tab: "social" };
    case "github-course-doc":
      return { tab: "settings", section: "integrations" };
    default:
      return { tab: "settings", section: "integrations" };
  }
}

function formatCitationChipLabel(citation: ChatCitation): string {
  const label = citation.label.trim();
  return label.length > 56 ? `${label.slice(0, 56)}...` : label;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenPattern = /(\*\*[^*\n]+?\*\*|\*[^*\n]+?\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(<Fragment key={`plain-${key++}`}>{text.slice(cursor, match.index)}</Fragment>);
    }

    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={`strong-${key++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(<em key={`em-${key++}`}>{token.slice(1, -1)}</em>);
    } else {
      nodes.push(<Fragment key={`token-${key++}`}>{token}</Fragment>);
    }

    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    nodes.push(<Fragment key={`tail-${key++}`}>{text.slice(cursor)}</Fragment>);
  }

  if (nodes.length === 0) {
    return [text];
  }

  return nodes;
}

function renderAssistantContent(content: string): ReactNode {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    if (lines[index].trim().length === 0) {
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(lines[index])) {
      const listItems: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        listItems.push(lines[index].replace(/^[-*]\s+/, ""));
        index += 1;
      }

      blocks.push(
        <ul key={`list-${key++}`} className="chat-markdown-list">
          {listItems.map((item, itemIndex) => (
            <li key={`item-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim().length > 0 && !/^[-*]\s+/.test(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    blocks.push(
      <p key={`paragraph-${key++}`} className="chat-markdown-paragraph">
        {paragraphLines.map((line, lineIndex) => (
          <Fragment key={`line-${lineIndex}`}>
            {lineIndex > 0 ? <br /> : null}
            {renderInlineMarkdown(line)}
          </Fragment>
        ))}
      </p>
    );
  }

  if (blocks.length === 0) {
    return content;
  }

  return blocks;
}

export function ChatView(): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessageIds, setSavedMessageIds] = useState<Set<string>>(new Set());
  const [savingMessageId, setSavingMessageId] = useState<string | null>(null);
  const [talkModeEnabled, setTalkModeEnabled] = useState<boolean>(() => loadTalkModeEnabled());
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const lastSpokenAssistantIdRef = useRef<string | null>(null);

  const recognitionCtor = getSpeechRecognitionCtor();
  const speechRecognitionSupported = Boolean(recognitionCtor);
  const speechSynthesisSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  // Scroll to bottom when new messages arrive
  const scrollToBottom = (): void => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load chat history on mount
  useEffect(() => {
    const loadHistory = async (): Promise<void> => {
      try {
        const response = await getChatHistory();
        setMessages(response.history.messages);
        const latestAssistant = latestAssistantMessage(response.history.messages);
        lastSpokenAssistantIdRef.current = latestAssistant?.id ?? null;
      } catch (err) {
        setError("Failed to load chat history");
        console.error(err);
      }
    };

    void loadHistory();
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      if (speechSynthesisSupported) {
        window.speechSynthesis.cancel();
      }
    };
  }, [speechSynthesisSupported]);

  useEffect(() => {
    if (!talkModeEnabled || !speechSynthesisSupported) {
      return;
    }

    const latestAssistant = latestAssistantMessage(messages);
    if (!latestAssistant || latestAssistant.id === lastSpokenAssistantIdRef.current) {
      return;
    }

    lastSpokenAssistantIdRef.current = latestAssistant.id;
    const utterance = new SpeechSynthesisUtterance(latestAssistant.content);
    utterance.lang = "en-US";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [messages, talkModeEnabled, speechSynthesisSupported]);

  const startListening = (): void => {
    if (!recognitionCtor) {
      setError("Voice input is not supported in this browser.");
      return;
    }

    const recognition = new recognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setError(null);
      setIsListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      setInputText(transcript.trim());
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setIsListening(false);
      if (event.error === "not-allowed") {
        setError("Microphone permission denied.");
      } else if (event.error === "no-speech") {
        setError("No speech detected. Try again.");
      } else {
        setError("Voice input failed. Try again.");
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopListening = (): void => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  };

  const toggleVoiceInput = (): void => {
    if (isListening) {
      stopListening();
      return;
    }
    startListening();
  };

  const toggleTalkMode = (): void => {
    const next = !talkModeEnabled;
    setTalkModeEnabled(next);
    saveTalkModeEnabled(next);

    if (!next) {
      stopListening();
      if (speechSynthesisSupported) {
        window.speechSynthesis.cancel();
      }
      setIsSpeaking(false);
    }
  };

  const handleSend = async (): Promise<void> => {
    const trimmedText = inputText.trim();
    if (!trimmedText || isSending) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmedText,
      timestamp: new Date().toISOString()
    };

    // Add user message immediately
    setMessages((prev) => [...prev, userMessage]);
    setInputText("");
    setIsSending(true);
    setError(null);

    // Add a placeholder for streaming assistant response
    const assistantPlaceholder: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      streaming: true
    };
    setMessages((prev) => [...prev, assistantPlaceholder]);

    try {
      const response = await sendChatMessage(trimmedText);
      // Replace placeholder with actual response
      setMessages((prev) =>
        prev.map((msg) =>
          msg.streaming ? { ...response, streaming: false } : msg
        )
      );
    } catch (err) {
      setError("Failed to send message. Please try again.");
      console.error(err);
      // Remove placeholder on error
      setMessages((prev) => prev.filter((msg) => !msg.streaming));
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleQuickAction = (prompt: string): void => {
    setInputText(prompt);
    inputRef.current?.focus();
  };

  const handleCitationClick = (citation: ChatCitation): void => {
    const target = toCitationTarget(citation);
    const params = new URLSearchParams();
    params.set("tab", target.tab);
    if (target.deadlineId) {
      params.set("deadlineId", target.deadlineId);
    }
    if (target.lectureId) {
      params.set("lectureId", target.lectureId);
    }
    if (target.journalId) {
      params.set("journalId", target.journalId);
    }
    if (target.section) {
      params.set("section", target.section);
    }

    const nextUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.pushState({}, "", nextUrl);
    window.dispatchEvent(new Event("popstate"));
  };

  const handleSaveToJournal = async (message: ChatMessage): Promise<void> => {
    if (savedMessageIds.has(message.id) || savingMessageId === message.id) return;

    setSavingMessageId(message.id);
    try {
      const submitted = await submitJournalEntry(message.content, crypto.randomUUID());

      if (!submitted) {
        throw new Error("Unable to save journal entry on server.");
      }

      // Create a new Set to trigger React re-render
      setSavedMessageIds((prev) => new Set([...prev, message.id]));
    } catch (err) {
      console.error("Failed to save to journal:", err);
      setError("Failed to save to journal. Please try again.");
      setTimeout(() => setError(null), 3000);
    } finally {
      setSavingMessageId(null);
    }
  };

  const quickActions = [
    { label: "What's next?", prompt: "What's next on my schedule today?" },
    { label: "How's my week?", prompt: "How is my week looking? Any deadlines coming up?" },
    { label: "Study tips", prompt: "Any tips for staying on top of my studies?" }
  ];

  return (
    <div className="chat-view">
      <div className="chat-toolbar">
        <button
          type="button"
          className={`chat-talk-mode-btn ${talkModeEnabled ? "chat-talk-mode-btn-on" : ""}`}
          onClick={toggleTalkMode}
        >
          Talk mode: {talkModeEnabled ? "On" : "Off"}
        </button>

        {talkModeEnabled && (
          <div className="chat-talk-wave" aria-live="polite" aria-label={isListening ? "Listening" : isSpeaking ? "Speaking" : "Idle"}>
            <span className={isListening ? "listening" : isSpeaking ? "speaking" : ""}></span>
            <span className={isListening ? "listening" : isSpeaking ? "speaking" : ""}></span>
            <span className={isListening ? "listening" : isSpeaking ? "speaking" : ""}></span>
          </div>
        )}
      </div>

      {talkModeEnabled && (!speechRecognitionSupported || !speechSynthesisSupported) && (
        <div className="chat-error">Talk mode has limited support in this browser.</div>
      )}

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <h2>👋 Hi there!</h2>
            <p>I'm your personal AI companion. I know your schedule, deadlines, and journal history.</p>
            <p>Ask me anything about your academic life!</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`chat-bubble chat-bubble-${msg.role}`}>
            <div className="chat-bubble-content">
              {msg.streaming && msg.content === "" ? (
                <div className="chat-typing">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              ) : (
                msg.role === "assistant" ? renderAssistantContent(msg.content) : msg.content
              )}
            </div>
            {msg.role === "assistant" && !msg.streaming && (msg.metadata?.citations?.length ?? 0) > 0 && (
              <div className="chat-citation-list" role="list" aria-label="Message citations">
                {(msg.metadata?.citations ?? []).map((citation) => (
                  <button
                    key={`${citation.type}-${citation.id}`}
                    type="button"
                    className="chat-citation-chip"
                    onClick={() => handleCitationClick(citation)}
                    title={citation.label}
                  >
                    {formatCitationChipLabel(citation)}
                  </button>
                ))}
              </div>
            )}
            <div className="chat-bubble-footer">
              <div className="chat-bubble-timestamp">
                {new Date(msg.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </div>
              {msg.role === "assistant" && !msg.streaming && (
                <button
                  type="button"
                  className="chat-save-to-journal-btn"
                  onClick={() => handleSaveToJournal(msg)}
                  disabled={savedMessageIds.has(msg.id) || savingMessageId === msg.id}
                  title={savedMessageIds.has(msg.id) ? "Saved to journal" : "Save to journal"}
                >
                  {savingMessageId === msg.id
                    ? "💾..."
                    : savedMessageIds.has(msg.id)
                    ? "✓ Saved"
                    : "📔 Save to journal"}
                </button>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {messages.length === 0 && (
        <div className="chat-quick-actions">
          {quickActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="chat-quick-action-chip"
              onClick={() => handleQuickAction(action.prompt)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {error && <div className="chat-error">{error}</div>}

      <div className="chat-input-container">
        <button
          type="button"
          className={`chat-voice-button ${isListening ? "chat-voice-button-listening" : ""}`}
          onClick={toggleVoiceInput}
          disabled={isSending || !speechRecognitionSupported}
          aria-label={isListening ? "Stop voice input" : "Start voice input"}
          title={isListening ? "Stop voice input" : "Start voice input"}
        >
          🎤
        </button>
        <input
          ref={inputRef}
          type="text"
          className="chat-input"
          placeholder="Ask me anything..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyPress={handleKeyPress}
          disabled={isSending}
        />
        <button
          type="button"
          className="chat-send-button"
          onClick={() => void handleSend()}
          disabled={isSending || !inputText.trim()}
        >
          {isSending ? "..." : "➤"}
        </button>
      </div>
    </div>
  );
}
