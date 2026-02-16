import { useEffect, useRef, useState } from "react";
import { sendChatMessage, getChatHistory, submitJournalEntry } from "../lib/api";
import { ChatMessage } from "../types";
import { addJournalEntry, enqueueJournalEntry } from "../lib/storage";

export function ChatView(): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessageIds, setSavedMessageIds] = useState<Set<string>>(new Set());
  const [savingMessageId, setSavingMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
        setMessages(response.messages);
      } catch (err) {
        setError("Failed to load chat history");
        console.error(err);
      }
    };

    void loadHistory();
  }, []);

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

  const handleSaveToJournal = async (message: ChatMessage): Promise<void> => {
    if (savedMessageIds.has(message.id) || savingMessageId === message.id) return;

    setSavingMessageId(message.id);
    try {
      const entry = addJournalEntry(message.content, ["chat-reflection"]);
      // addJournalEntry guarantees id and clientEntryId are set to the same value
      const entryId = entry.clientEntryId || entry.id;
      if (!entryId) {
        throw new Error("Failed to create journal entry: missing entry ID");
      }

      const submitted = await submitJournalEntry(
        message.content,
        entryId,
        ["chat-reflection"]
      );

      if (!submitted) {
        enqueueJournalEntry(entry);
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
                msg.content
              )}
            </div>
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
