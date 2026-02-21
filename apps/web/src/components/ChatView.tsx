import { Fragment, ReactNode, useEffect, useRef, useState } from "react";
import { sendChatMessageStream, getChatHistory } from "../lib/api";
import { ChatCitation, ChatImageAttachment, ChatMessage, ChatMood, ChatPendingAction } from "../types";

const MOOD_PARTICLES: Record<Exclude<ChatMood, "neutral">, { emojis: string[]; count: number }> = {
  encouraging: { emojis: ["💪", "⭐", "🔥", "✨", "🚀"], count: 14 },
  focused: { emojis: ["🎯", "🧠", "💡", "⚡", "🔵"], count: 12 },
  celebratory: { emojis: ["🎉", "🥳", "🎊", "✨", "⭐", "🌟", "💫"], count: 20 },
  empathetic: { emojis: ["💜", "💛", "🤗", "🫂", "💗"], count: 12 },
  urgent: { emojis: ["⏰", "⚡", "🔴", "❗", "🏃"], count: 10 }
};

interface Particle {
  id: number;
  emoji: string;
  x: number;
  delay: number;
  duration: number;
  size: number;
  drift: number;
}

function MoodBurst({ mood }: { mood: ChatMood }): ReactNode {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (mood === "neutral") return;
    const config = MOOD_PARTICLES[mood];
    const spawned: Particle[] = Array.from({ length: config.count }, (_, i) => ({
      id: i,
      emoji: config.emojis[Math.floor(Math.random() * config.emojis.length)],
      x: Math.random() * 100,
      delay: Math.random() * 0.4,
      duration: 1.2 + Math.random() * 0.8,
      size: 16 + Math.random() * 14,
      drift: (Math.random() - 0.5) * 60
    }));
    setParticles(spawned);
    const timer = setTimeout(() => setParticles([]), 2400);
    return () => clearTimeout(timer);
  }, [mood]);

  if (particles.length === 0) return null;

  return (
    <div className="mood-burst-overlay" aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.id}
          className="mood-burst-particle"
          style={{
            left: `${p.x}%`,
            fontSize: `${p.size}px`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            "--drift": `${p.drift}px`
          } as React.CSSProperties}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & { webkitSpeechRecognition?: typeof SpeechRecognition };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

interface CitationLinkTarget {
  tab: "schedule" | "nutrition" | "habits" | "settings";
  deadlineId?: string;
  lectureId?: string;
  section?: string;
}

function toCitationTarget(citation: ChatCitation): CitationLinkTarget {
  switch (citation.type) {
    case "deadline":
      return { tab: "schedule", deadlineId: citation.id };
    case "schedule":
      return { tab: "schedule", lectureId: citation.id };
    case "habit":
    case "goal":
      return { tab: "habits" };
    case "nutrition-meal":
      return { tab: "nutrition" };
    case "withings-weight":
    case "withings-sleep":
      return { tab: "habits" };
    case "email":
      return { tab: "settings", section: "integrations" };
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

const MAX_ATTACHMENTS = 3;
const SUPPORTED_CHAT_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const CHAT_IMAGE_SERVER_HARD_LIMIT = 1_500_000;
const CHAT_IMAGE_TARGET_LIMIT = 850_000;
const CHAT_IMAGE_MAX_ACCEPTABLE_SIZE = 1_200_000;
const CHAT_IMAGE_MAX_DIMENSION = 1600;

async function toDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Invalid file result"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

function normalizeMimeType(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "image/jpg") {
    return "image/jpeg";
  }
  return normalized;
}

function mimeTypeFromDataUrl(dataUrl: string): string | null {
  const match = dataUrl.match(/^data:([^;]+);base64,/i);
  return normalizeMimeType(match?.[1]);
}

async function convertImageFileToJpegDataUrl(file: File): Promise<string | null> {
  if (typeof window === "undefined") {
    return null;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image();
      next.onload = () => resolve(next);
      next.onerror = () => reject(new Error("Image decode failed"));
      next.src = objectUrl;
    });

    const sourceWidth = Math.max(1, Math.round(image.naturalWidth || image.width));
    const sourceHeight = Math.max(1, Math.round(image.naturalHeight || image.height));
    const maxSide = Math.max(sourceWidth, sourceHeight);
    const scale = maxSide > CHAT_IMAGE_MAX_DIMENSION ? CHAT_IMAGE_MAX_DIMENSION / maxSide : 1;
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    context.drawImage(image, 0, 0, width, height);
    const qualitySteps = [0.9, 0.82, 0.74, 0.66, 0.58];
    const scaleSteps = [1, 0.88, 0.78, 0.68];
    let best: string | null = null;

    for (const sizeScale of scaleSteps) {
      const scaledWidth = Math.max(1, Math.round(width * sizeScale));
      const scaledHeight = Math.max(1, Math.round(height * sizeScale));
      canvas.width = scaledWidth;
      canvas.height = scaledHeight;
      context.clearRect(0, 0, scaledWidth, scaledHeight);
      context.drawImage(image, 0, 0, scaledWidth, scaledHeight);

      for (const quality of qualitySteps) {
        const candidate = canvas.toDataURL("image/jpeg", quality);
        if (best === null || candidate.length < best.length) {
          best = candidate;
        }
        if (candidate.length <= CHAT_IMAGE_TARGET_LIMIT) {
          return candidate;
        }
      }
    }

    if (best && best.length <= CHAT_IMAGE_SERVER_HARD_LIMIT) {
      return best;
    }

    return null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function buildChatImageAttachment(file: File): Promise<Omit<ChatImageAttachment, "id"> | null> {
  let dataUrl = await toDataUrl(file);
  let mimeType = normalizeMimeType(file.type) ?? mimeTypeFromDataUrl(dataUrl);

  const supportedOriginal = Boolean(mimeType && SUPPORTED_CHAT_IMAGE_MIME_TYPES.has(mimeType));
  if (supportedOriginal && dataUrl.length <= CHAT_IMAGE_MAX_ACCEPTABLE_SIZE) {
    return {
      dataUrl,
      mimeType: mimeType!,
      fileName: file.name || undefined
    };
  }

  const converted = await convertImageFileToJpegDataUrl(file);
  if (!converted) {
    if (supportedOriginal && dataUrl.length <= CHAT_IMAGE_SERVER_HARD_LIMIT) {
      return {
        dataUrl,
        mimeType: mimeType!,
        fileName: file.name || undefined
      };
    }
    return null;
  }

  dataUrl = converted;
  mimeType = "image/jpeg";
  if (dataUrl.length > CHAT_IMAGE_SERVER_HARD_LIMIT) {
    return null;
  }

  return {
    dataUrl,
    mimeType,
    fileName: file.name || undefined
  };
}

function renderMessageAttachments(attachments: ChatImageAttachment[]): ReactNode {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="chat-attachments">
      {attachments.map((attachment) => (
        <a
          key={attachment.id}
          href={attachment.dataUrl}
          target="_blank"
          rel="noreferrer"
          className="chat-attachment-link"
          title={attachment.fileName ?? "Open image"}
        >
          <img src={attachment.dataUrl} alt={attachment.fileName ?? "Chat attachment"} className="chat-attachment-image" />
        </a>
      ))}
    </div>
  );
}

interface ChatViewProps {
  mood: ChatMood;
  onMoodChange: (mood: ChatMood) => void;
}

export function ChatView({ mood, onMoodChange }: ChatViewProps): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<ChatImageAttachment[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [sendFlying, setSendFlying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedCitationMessageIds, setExpandedCitationMessageIds] = useState<Set<string>>(new Set());
  const [isListening, setIsListening] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const nextPageRef = useRef(2);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const pendingInitialScrollRef = useRef(false);
  const streamContentRef = useRef("");
  const streamRafRef = useRef<number | null>(null);
  const streamPlaceholderIdRef = useRef<string | null>(null);
  const streamBubbleRef = useRef<HTMLSpanElement | null>(null);

  const recognitionCtor = getSpeechRecognitionCtor();
  const speechRecognitionSupported = Boolean(recognitionCtor);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth"): void => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior });
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  const scheduleScrollToBottom = (behavior: ScrollBehavior = "auto"): void => {
    if (typeof window === "undefined") {
      return;
    }

    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollToBottom(behavior);
      scrollFrameRef.current = null;
    });
  };

  const loadOlderMessages = async (): Promise<void> => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const container = messagesContainerRef.current;
      const prevScrollHeight = container?.scrollHeight ?? 0;

      const response = await getChatHistory(nextPageRef.current, 50);
      const olderMessages = response.history.messages;
      if (olderMessages.length > 0) {
        setMessages((prev) => [...olderMessages, ...prev]);
        nextPageRef.current += 1;
        // Preserve scroll position after prepending
        requestAnimationFrame(() => {
          if (container) {
            container.scrollTop = container.scrollHeight - prevScrollHeight;
          }
        });
      }
      setHasMore(response.history.hasMore);
    } catch (err) {
      console.error("Failed to load older messages", err);
    } finally {
      setLoadingMore(false);
    }
  };

  // Load chat history on mount
  useEffect(() => {
    const loadHistory = async (): Promise<void> => {
      try {
        const response = await getChatHistory(1, 50);
        pendingInitialScrollRef.current = true;
        setMessages(response.history.messages);
        setHasMore(response.history.hasMore);
        nextPageRef.current = 2;
        // Restore mood from most recent assistant message
        const lastAssistant = [...response.history.messages].reverse().find((m) => m.role === "assistant");
        if (lastAssistant?.metadata?.mood) {
          onMoodChange(lastAssistant.metadata.mood);
        }
      } catch (err) {
        setError("Failed to load chat history");
        console.error(err);
      }
    };

    void loadHistory();
  }, []);

  useEffect(() => {
    if (!pendingInitialScrollRef.current) {
      return;
    }

    pendingInitialScrollRef.current = false;
    scheduleScrollToBottom("auto");
  }, [messages.length]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;

      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }

    };
  }, []);

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

  const dispatchMessage = async (
    messageText: string,
    attachmentsToSend: ChatImageAttachment[] = []
  ): Promise<void> => {
    const trimmedText = messageText.trim();
    if ((trimmedText.length === 0 && attachmentsToSend.length === 0) || isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmedText,
      timestamp: new Date().toISOString(),
      ...(attachmentsToSend.length > 0
        ? {
            metadata: {
              attachments: attachmentsToSend
            }
          }
        : {})
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsSending(true);
    setError(null);

    const assistantPlaceholder: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      streaming: true
    };
    setMessages((prev) => [...prev, assistantPlaceholder]);
    scheduleScrollToBottom("auto");
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches) {
      window.requestAnimationFrame(() => {
        inputRef.current?.blur();
        scheduleScrollToBottom("auto");
      });
    }

    try {
      streamContentRef.current = "";
      streamPlaceholderIdRef.current = assistantPlaceholder.id;
      streamBubbleRef.current = null;

      const response = await sendChatMessageStream(
        trimmedText,
        {
          onToken: (delta: string) => {
            if (delta.length === 0) {
              return;
            }
            streamContentRef.current += delta;
            // Use rAF for native-framerate updates (120Hz on ProMotion, 60Hz otherwise)
            if (streamRafRef.current === null) {
              streamRafRef.current = requestAnimationFrame(() => {
                streamRafRef.current = null;
                const bubble = streamBubbleRef.current;
                if (bubble) {
                  // Direct DOM update — bypasses React reconciliation entirely
                  bubble.textContent = streamContentRef.current;
                } else {
                  // First tokens: one React render to switch from typing dots to text
                  const content = streamContentRef.current;
                  const placeholderId = streamPlaceholderIdRef.current;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === placeholderId
                        ? { ...msg, content, streaming: true }
                        : msg
                    )
                  );
                }
                scheduleScrollToBottom("auto");
              });
            }
          }
        },
        attachmentsToSend
      );
      // Cancel any pending rAF before final commit
      if (streamRafRef.current !== null) {
        cancelAnimationFrame(streamRafRef.current);
        streamRafRef.current = null;
      }
      streamBubbleRef.current = null;
      if (response.metadata?.mood) {
        onMoodChange(response.metadata.mood);
      }
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantPlaceholder.id ? { ...response, streaming: false } : msg
        )
      );
    } catch (err) {
      const errorMessage =
        err instanceof Error && err.message.trim().length > 0 ? err.message : "Failed to send message. Please try again.";
      setError(errorMessage);
      console.error(err);
      setMessages((prev) => prev.filter((msg) => msg.id !== assistantPlaceholder.id));
    } finally {
      setIsSending(false);
    }
  };

  const handleSend = async (): Promise<void> => {
    const trimmedText = inputText.trim();
    const attachmentsToSend = pendingAttachments.slice(0, MAX_ATTACHMENTS);
    if ((trimmedText.length === 0 && attachmentsToSend.length === 0) || isSending) return;
    setSendFlying(true);
    setTimeout(() => setSendFlying(false), 400);
    setInputText("");
    setPendingAttachments([]);
    await dispatchMessage(trimmedText, attachmentsToSend);
  };

  const handlePendingActionCommand = (action: ChatPendingAction, type: "confirm" | "cancel"): void => {
    if (isSending) {
      return;
    }
    void dispatchMessage(`${type} ${action.id}`);
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleQuickAction = (prompt: string): void => {
    setInputText(prompt);
    inputRef.current?.focus();
  };

  const handleSelectAttachments = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    const availableSlots = Math.max(0, MAX_ATTACHMENTS - pendingAttachments.length);
    if (availableSlots === 0) {
      setError(`You can attach up to ${MAX_ATTACHMENTS} images.`);
      event.target.value = "";
      return;
    }

    const nextFiles = files.slice(0, availableSlots);
    try {
      const nextAttachments: ChatImageAttachment[] = [];
      const failedFiles: string[] = [];

      for (const file of nextFiles) {
        const preparedAttachment = await buildChatImageAttachment(file);
        if (!preparedAttachment) {
          failedFiles.push(file.name || "image");
          continue;
        }
        nextAttachments.push({
          id: crypto.randomUUID(),
          ...preparedAttachment
        });
      }

      if (nextAttachments.length === 0 && failedFiles.length > 0) {
        setError("One or more images were too large or unsupported. Try a smaller image.");
        return;
      }

      setPendingAttachments((prev) => [...prev, ...nextAttachments].slice(0, MAX_ATTACHMENTS));
      if (failedFiles.length > 0) {
        setError("Some selected images were skipped because they were too large or unsupported.");
      } else {
        setError(null);
      }
    } catch {
      setError("Could not attach one or more images.");
    } finally {
      event.target.value = "";
    }
  };

  const removePendingAttachment = (attachmentId: string): void => {
    setPendingAttachments((prev) => prev.filter((attachment) => attachment.id !== attachmentId));
  };

  const openAttachmentPicker = (): void => {
    fileInputRef.current?.click();
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
    if (target.section) {
      params.set("section", target.section);
    }

    const nextUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.pushState({}, "", nextUrl);
    window.dispatchEvent(new Event("popstate"));
  };

  const toggleCitationStack = (messageId: string): void => {
    setExpandedCitationMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const quickActions = [
    { label: "What's next?", prompt: "What's next on my schedule today?" },
    { label: "How's my week?", prompt: "How is my week looking? Any deadlines coming up?" },
    { label: "Study tips", prompt: "Any tips for staying on top of my studies?" }
  ];

  // Track mood changes to trigger burst only on transitions
  const prevMoodRef = useRef<ChatMood>(mood);
  const [burstMood, setBurstMood] = useState<ChatMood>("neutral");

  useEffect(() => {
    if (mood !== prevMoodRef.current && mood !== "neutral") {
      setBurstMood(mood);
    }
    prevMoodRef.current = mood;
  }, [mood]);

  return (
    <div className="chat-view">
      <MoodBurst mood={burstMood} />
      <div className="chat-messages" ref={messagesContainerRef}>
        {hasMore && (
          <div className="chat-load-more">
            <button
              type="button"
              className="chat-load-more-btn"
              onClick={() => void loadOlderMessages()}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Load older messages"}
            </button>
          </div>
        )}
        {messages.length === 0 && (
          <div className="chat-welcome">
            <h2>👋 Hi there!</h2>
            <p>I'm your personal AI companion. I know your schedule, deadlines, and food plan context.</p>
            <p>Ask me anything about your academic life!</p>
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
          </div>
        )}

        {messages.map((msg) => {
          const attachments = msg.metadata?.attachments ?? [];
          const hasAttachments = attachments.length > 0;
          const citations = msg.metadata?.citations ?? [];
          const pendingActions = msg.metadata?.pendingActions ?? [];

          return (
            <div key={msg.id} data-message-id={msg.id} className={`chat-bubble chat-bubble-${msg.role}${msg.streaming ? " streaming" : ""}`}>
              <div className="chat-bubble-content">
                {msg.streaming && msg.content === "" ? (
                  <div className="chat-typing">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                ) : msg.streaming ? (
                  <span ref={streamBubbleRef} className="chat-stream-text">{msg.content}</span>
                ) : msg.role === "assistant" ? (
                  renderAssistantContent(msg.content)
                ) : msg.content.trim().length > 0 ? (
                  msg.content
                ) : hasAttachments ? (
                  <em>Sent image</em>
                ) : (
                  ""
                )}
                {renderMessageAttachments(attachments)}
              </div>
              {msg.role === "assistant" && !msg.streaming && citations.length > 0 && (
                <div className="chat-citation-list" role="list" aria-label="Message citations">
                  {citations.length === 1 ? (
                    <button
                      key={`${citations[0]!.type}-${citations[0]!.id}`}
                      type="button"
                      className="chat-citation-chip"
                      onClick={() => handleCitationClick(citations[0]!)}
                      title={citations[0]!.label}
                    >
                      {formatCitationChipLabel(citations[0]!)}
                    </button>
                  ) : (
                    <div className="chat-citation-stack">
                      {!expandedCitationMessageIds.has(msg.id) && (
                        <button
                          type="button"
                          className="chat-citation-stack-chip"
                          onClick={() => toggleCitationStack(msg.id)}
                          title={citations.map((citation) => citation.label).join("\n")}
                          aria-expanded={false}
                          aria-label={`Show ${citations.length} citations`}
                        >
                          <span className="chat-citation-stack-layer chat-citation-stack-layer-back" aria-hidden="true" />
                          <span className="chat-citation-stack-layer chat-citation-stack-layer-mid" aria-hidden="true" />
                          <span className="chat-citation-stack-layer chat-citation-stack-layer-front">
                            {formatCitationChipLabel(citations[0]!)}
                          </span>
                          <span className="chat-citation-stack-count">+{citations.length - 1}</span>
                        </button>
                      )}
                      {expandedCitationMessageIds.has(msg.id) && (
                        <div className="chat-citation-stack-menu" role="list" aria-label="Expanded citations">
                          {citations.map((citation) => (
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
                          <button
                            type="button"
                            className="chat-citation-chip chat-citation-collapse"
                            onClick={() => toggleCitationStack(msg.id)}
                            aria-label="Collapse citations"
                          >
                            Collapse
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {msg.role === "assistant" && !msg.streaming && pendingActions.length > 0 && (
                <div className="chat-pending-action-list">
                  {pendingActions.map((action) => {
                    const rationale = typeof action.payload?.rationale === "string" ? action.payload.rationale : null;
                    return (
                      <div key={action.id} className="chat-pending-action-card">
                        <p className="chat-pending-action-summary">{action.summary}</p>
                        {rationale ? <p className="chat-pending-action-rationale">{rationale}</p> : null}
                        <div className="chat-pending-action-buttons">
                          <button
                            type="button"
                            className="chat-pending-action-confirm"
                            onClick={() => handlePendingActionCommand(action, "confirm")}
                            disabled={isSending}
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            className="chat-pending-action-cancel"
                            onClick={() => handlePendingActionCommand(action, "cancel")}
                            disabled={isSending}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="chat-bubble-footer">
                <div className="chat-bubble-timestamp">
                  {new Date(msg.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false
                  })}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {error && <div className="chat-error">{error}</div>}

      <div className="chat-input-container">
        {pendingAttachments.length > 0 && (
          <div className="chat-pending-attachments">
            {pendingAttachments.map((attachment) => (
              <div key={attachment.id} className="chat-pending-attachment">
                <img src={attachment.dataUrl} alt={attachment.fileName ?? "Pending image"} className="chat-pending-thumb" />
                <button
                  type="button"
                  className="chat-pending-remove"
                  onClick={() => removePendingAttachment(attachment.id)}
                  aria-label="Remove image attachment"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => void handleSelectAttachments(event)}
          className="chat-attach-input"
        />
        <div className="chat-input-row">
          <button
            type="button"
            className="chat-attach-button"
            onClick={openAttachmentPicker}
            disabled={isSending || pendingAttachments.length >= MAX_ATTACHMENTS}
            aria-label="Attach images"
            title={pendingAttachments.length >= MAX_ATTACHMENTS ? `Max ${MAX_ATTACHMENTS} images` : "Attach images"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
          </button>
          <button
            type="button"
            className={`chat-voice-button ${isListening ? "chat-voice-button-listening" : ""}`}
            onClick={toggleVoiceInput}
            disabled={isSending || !speechRecognitionSupported}
            aria-label={isListening ? "Stop voice input" : "Start voice input"}
            title={isListening ? "Stop voice input" : "Start voice input"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="1" width="6" height="11" rx="3" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
          </button>
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder="Ask me anything..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleComposerKeyDown}
            disabled={isSending}
            rows={1}
          />
          <button
            type="button"
            className={`chat-send-button${sendFlying ? " chat-send-flying" : ""}`}
            onClick={() => void handleSend()}
            disabled={isSending || (inputText.trim().length === 0 && pendingAttachments.length === 0)}
          >
            {isSending ? "..." : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>}
          </button>
        </div>
      </div>
    </div>
  );
}
