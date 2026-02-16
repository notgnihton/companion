import { GeminiClient, GeminiMessage } from "./gemini.js";
import { YouTubeData } from "./types.js";

export interface DigestConfig {
  platforms?: string[];
  hours?: number;
  summaryLength?: "brief" | "standard" | "detailed";
  focusAreas?: string[];
}

export interface DigestItem {
  type: string;
  platform: string;
  title: string;
  author?: string;
  publishedAt: string;
  url?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface DigestSection {
  topic: string;
  items: DigestItem[];
}

export interface SocialDigest {
  generatedAt: string;
  period: {
    from: string;
    to: string;
  };
  digest: string;
  sections: DigestSection[];
}

export class SocialDigestService {
  private readonly geminiClient: GeminiClient;

  constructor(geminiClient: GeminiClient) {
    this.geminiClient = geminiClient;
  }

  /**
   * Generate an AI-powered social media digest from YouTube and X data
   */
  async generateDigest(
    youtubeData: YouTubeData | null,
    config: DigestConfig = {}
  ): Promise<SocialDigest> {
    const hours = config.hours ?? 24;
    const summaryLength = config.summaryLength ?? "standard";
    const focusAreas = config.focusAreas ?? ["AI news", "tech", "entertainment"];
    const platforms = config.platforms ?? ["youtube"];

    const now = new Date();
    const fromDate = new Date(now.getTime() - hours * 60 * 60 * 1000);

    // Filter YouTube videos by time range
    const recentVideos = youtubeData?.videos?.filter((video) => {
      const publishedAt = new Date(video.publishedAt);
      return publishedAt >= fromDate && publishedAt <= now;
    }) ?? [];

    // Build sections from raw data
    const sections: DigestSection[] = [];

    if (platforms.includes("youtube") && recentVideos.length > 0) {
      const youtubeItems: DigestItem[] = recentVideos.map((video) => ({
        type: "video",
        platform: "youtube",
        title: video.title,
        author: video.channelTitle,
        publishedAt: video.publishedAt,
        url: `https://youtube.com/watch?v=${video.id}`,
        metadata: {
          videoId: video.id,
          channelId: video.channelId,
          duration: video.duration,
          viewCount: video.viewCount,
          likeCount: video.likeCount,
          thumbnailUrl: video.thumbnailUrl
        }
      }));

      // Group by topic using simple categorization
      const categorized = this.categorizeItems(youtubeItems, focusAreas);
      sections.push(...categorized);
    }

    // Generate AI summary using Gemini
    const digestText = await this.generateAISummary(sections, summaryLength, focusAreas);

    return {
      generatedAt: now.toISOString(),
      period: {
        from: fromDate.toISOString(),
        to: now.toISOString()
      },
      digest: digestText,
      sections
    };
  }

  /**
   * Categorize items by topic based on title and content
   */
  private categorizeItems(items: DigestItem[], focusAreas: string[]): DigestSection[] {
    const sections: DigestSection[] = focusAreas.map((topic) => ({
      topic,
      items: []
    }));

    // Add "Other" category for uncategorized content
    sections.push({ topic: "Other", items: [] });

    // Simple keyword-based categorization
    const topicKeywords: Record<string, string[]> = {
      "AI news": ["ai", "llm", "gpt", "gemini", "claude", "openai", "anthropic", "machine learning", "ml", "neural"],
      "tech": ["programming", "code", "software", "javascript", "python", "react", "rust", "go", "development", "api"],
      "entertainment": ["gaming", "game", "music", "movie", "tv", "show", "stream", "twitch"]
    };

    for (const item of items) {
      const titleLower = item.title.toLowerCase();
      let categorized = false;

      for (const [topic, keywords] of Object.entries(topicKeywords)) {
        if (keywords.some((keyword) => titleLower.includes(keyword))) {
          const section = sections.find((s) => s.topic === topic);
          if (section) {
            section.items.push(item);
            categorized = true;
            break;
          }
        }
      }

      // If not categorized, add to "Other"
      if (!categorized) {
        const otherSection = sections.find((s) => s.topic === "Other");
        if (otherSection) {
          otherSection.items.push(item);
        }
      }
    }

    // Remove empty sections
    return sections.filter((section) => section.items.length > 0);
  }

  /**
   * Generate AI summary using Gemini
   */
  private async generateAISummary(
    sections: DigestSection[],
    summaryLength: "brief" | "standard" | "detailed",
    focusAreas: string[]
  ): Promise<string> {
    if (sections.length === 0) {
      return "No new content in the specified time period.";
    }

    if (!this.geminiClient.isConfigured()) {
      // Fallback to simple text summary if Gemini is not configured
      return this.generateTextSummary(sections);
    }

    // Build content list for Gemini
    let contentList = "";
    for (const section of sections) {
      contentList += `\n## ${section.topic}\n`;
      for (const item of section.items) {
        contentList += `- **${item.title}** by ${item.author ?? "Unknown"} (${item.platform})\n`;
      }
    }

    const lengthInstructions = {
      brief: "Keep it very concise (2-3 sentences per topic).",
      standard: "Provide a balanced summary (1 short paragraph per topic).",
      detailed: "Provide a comprehensive summary with key highlights and context."
    };

    const systemPrompt = `You are a social media digest assistant. Your job is to create engaging, newsletter-style summaries of content grouped by topic.

Focus areas: ${focusAreas.join(", ")}
${lengthInstructions[summaryLength]}

Format the output as a readable digest with topic headers (use ## markdown headers) and bullet points. Be conversational and highlight what's interesting or important.`;

    const userPrompt = `Please create a social media digest from the following content:\n${contentList}`;

    try {
      const messages: GeminiMessage[] = [
        {
          role: "user",
          parts: [{ text: userPrompt }]
        }
      ];

      const response = await this.geminiClient.generateChatResponse({
        messages,
        systemInstruction: systemPrompt
      });

      return response.text;
    } catch (error) {
      console.error("Failed to generate AI summary:", error);
      // Fallback to simple text summary
      return this.generateTextSummary(sections);
    }
  }

  /**
   * Generate simple text summary without AI (fallback)
   */
  private generateTextSummary(sections: DigestSection[]): string {
    let summary = "## Social Media Digest\n\n";

    for (const section of sections) {
      summary += `### ${section.topic}\n`;
      for (const item of section.items.slice(0, 5)) {
        summary += `- **${item.title}** by ${item.author ?? "Unknown"}\n`;
      }
      if (section.items.length > 5) {
        summary += `- ... and ${section.items.length - 5} more\n`;
      }
      summary += "\n";
    }

    return summary;
  }
}
