import {
  ContentRecommendation,
  ContentRecommendationsResult,
  ContentRecommendationTarget,
  Deadline,
  LectureEvent,
  Priority,
  YouTubeData,
  XData
} from "./types.js";

export interface GenerateContentRecommendationsOptions {
  now?: Date;
  horizonDays?: number;
  limit?: number;
}

interface RecommendationTargetContext {
  target: ContentRecommendationTarget;
  keywords: string[];
  urgencyMultiplier: number;
  dat560BoostEnabled: boolean;
}

interface ContentCandidate {
  platform: "youtube" | "x";
  id: string;
  title: string;
  description: string;
  author: string;
  publishedAt: string;
  url: string;
  engagement: number;
  textBlobLower: string;
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "your",
  "you",
  "are",
  "was",
  "were",
  "have",
  "has",
  "about",
  "into",
  "due",
  "assignment",
  "lecture",
  "course",
  "week",
  "next",
  "today",
  "tomorrow"
]);

const COURSE_KEYWORD_BOOSTS: Record<string, string[]> = {
  DAT560: [
    "machine learning",
    "deep learning",
    "neural network",
    "transformer",
    "llm",
    "vae",
    "diffusion",
    "ml"
  ],
  DAT520: [
    "distributed systems",
    "raft",
    "consensus",
    "gossip",
    "grpc",
    "replication",
    "fault tolerance"
  ]
};

const DAT560_ML_KEYWORDS = COURSE_KEYWORD_BOOSTS.DAT560 ?? [];

function normalizeOptions(options: GenerateContentRecommendationsOptions): Required<GenerateContentRecommendationsOptions> {
  return {
    now: options.now ?? new Date(),
    horizonDays: options.horizonDays ?? 7,
    limit: options.limit ?? 10
  };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !STOP_WORDS.has(part));
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

function extractCourseCode(text: string): string | null {
  const match = text.toUpperCase().match(/\b[A-Z]{3}\d{3}\b/);
  return match ? match[0] : null;
}

function extractKeywords(course: string, title: string): string[] {
  const courseCode = course.toUpperCase().trim();
  const baseTokens = tokenize(`${course} ${title}`);
  const boosted = COURSE_KEYWORD_BOOSTS[courseCode] ?? [];
  return unique([...baseTokens, ...boosted, courseCode.toLowerCase()]);
}

function priorityWeight(priority: Priority): number {
  switch (priority) {
    case "critical":
      return 1.45;
    case "high":
      return 1.3;
    case "medium":
      return 1.15;
    case "low":
      return 1;
  }
}

function recencyScore(isoTimestamp: string, now: Date): number {
  const publishedAt = new Date(isoTimestamp);
  if (Number.isNaN(publishedAt.getTime())) {
    return 0;
  }

  const ageHours = Math.max(0, (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60));
  if (ageHours >= 14 * 24) {
    return 0;
  }
  return Math.max(0, 30 - ageHours / 8);
}

function engagementScore(engagement: number): number {
  if (!Number.isFinite(engagement) || engagement <= 0) {
    return 0;
  }
  return Math.min(25, Math.log10(engagement + 1) * 8);
}

function buildDeadlineTargets(
  deadlines: Deadline[],
  now: Date,
  windowEnd: Date
): RecommendationTargetContext[] {
  return deadlines
    .filter((deadline) => !deadline.completed)
    .map((deadline) => {
      const dueDate = new Date(deadline.dueDate);
      return { deadline, dueDate };
    })
    .filter(({ dueDate }) => !Number.isNaN(dueDate.getTime()) && dueDate.getTime() <= windowEnd.getTime())
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
    .map(({ deadline, dueDate }) => {
      const hoursUntilDue = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);
      const urgencyMultiplier = hoursUntilDue <= 24 ? 1.35 : hoursUntilDue <= 72 ? 1.2 : 1.05;
      const courseCode = deadline.course.toUpperCase();
      return {
        target: {
          type: "deadline",
          id: deadline.id,
          course: deadline.course,
          title: deadline.task,
          dueDate: deadline.dueDate,
          priority: deadline.priority
        },
        keywords: extractKeywords(deadline.course, deadline.task),
        urgencyMultiplier: urgencyMultiplier * priorityWeight(deadline.priority),
        dat560BoostEnabled: courseCode.includes("DAT560")
      };
    });
}

function buildLectureTargets(
  scheduleEvents: LectureEvent[],
  now: Date,
  windowEnd: Date
): RecommendationTargetContext[] {
  return scheduleEvents
    .map((lecture) => {
      const start = new Date(lecture.startTime);
      return { lecture, start };
    })
    .filter(({ start }) => !Number.isNaN(start.getTime()) && start.getTime() >= now.getTime() && start.getTime() <= windowEnd.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map(({ lecture, start }) => {
      const courseCode = extractCourseCode(lecture.title) ?? "COURSE";
      const hoursUntilStart = (start.getTime() - now.getTime()) / (1000 * 60 * 60);
      const urgencyMultiplier = hoursUntilStart <= 24 ? 1.15 : 1.05;
      return {
        target: {
          type: "lecture",
          id: lecture.id,
          course: courseCode,
          title: lecture.title,
          startTime: lecture.startTime
        },
        keywords: extractKeywords(courseCode, lecture.title),
        urgencyMultiplier,
        dat560BoostEnabled: courseCode === "DAT560"
      };
    });
}

function buildCandidates(youtubeData: YouTubeData | null, xData: XData | null): ContentCandidate[] {
  const youtubeCandidates: ContentCandidate[] = (youtubeData?.videos ?? []).map((video) => {
    const textBlob = `${video.title} ${video.description} ${video.channelTitle}`.toLowerCase();
    const engagement = video.viewCount + video.likeCount * 8 + video.commentCount * 12;
    return {
      platform: "youtube",
      id: video.id,
      title: video.title,
      description: video.description,
      author: video.channelTitle,
      publishedAt: video.publishedAt,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      engagement,
      textBlobLower: textBlob
    };
  });

  const xCandidates: ContentCandidate[] = (xData?.tweets ?? []).map((tweet) => {
    const textBlob = `${tweet.text} ${tweet.authorUsername} ${tweet.authorName}`.toLowerCase();
    const engagement = tweet.likeCount * 3 + tweet.retweetCount * 5 + tweet.replyCount * 2;
    return {
      platform: "x",
      id: tweet.id,
      title: tweet.text.slice(0, 120),
      description: tweet.text,
      author: `@${tweet.authorUsername}`,
      publishedAt: tweet.createdAt,
      url: `https://x.com/${tweet.authorUsername}/status/${tweet.id}`,
      engagement,
      textBlobLower: textBlob
    };
  });

  return [...youtubeCandidates, ...xCandidates];
}

function matchKeywords(textBlobLower: string, keywords: string[]): string[] {
  const matches = keywords.filter((keyword) => textBlobLower.includes(keyword.toLowerCase()));
  return unique(matches);
}

function buildReason(
  target: ContentRecommendationTarget,
  matchedKeywords: string[],
  dat560Boost: number,
  candidate: ContentCandidate,
  now: Date
): string {
  const publishedAt = new Date(candidate.publishedAt);
  const ageHours = Number.isNaN(publishedAt.getTime())
    ? null
    : Math.max(0, Math.round((now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60)));
  const topKeywords = matchedKeywords.slice(0, 3).join(", ");

  const reasons: string[] = [];
  reasons.push(`Matched ${target.course} context via ${topKeywords || "topic similarity"}.`);
  if (ageHours !== null) {
    reasons.push(ageHours <= 24 ? "Fresh content from the last 24h." : `Recent content (${ageHours}h old).`);
  }
  if (dat560Boost > 0) {
    reasons.push("Boosted for DAT560 ML relevance.");
  }

  return reasons.join(" ");
}

export function generateContentRecommendations(
  deadlines: Deadline[],
  scheduleEvents: LectureEvent[],
  youtubeData: YouTubeData | null,
  xData: XData | null,
  options: GenerateContentRecommendationsOptions = {}
): ContentRecommendationsResult {
  const opts = normalizeOptions(options);
  const now = opts.now;
  const windowEnd = new Date(now.getTime() + opts.horizonDays * 24 * 60 * 60 * 1000);

  const targets = [
    ...buildDeadlineTargets(deadlines, now, windowEnd),
    ...buildLectureTargets(scheduleEvents, now, windowEnd)
  ];

  const candidates = buildCandidates(youtubeData, xData);

  if (targets.length === 0 || candidates.length === 0) {
    return {
      generatedAt: now.toISOString(),
      horizonDays: opts.horizonDays,
      summary: {
        targetsConsidered: targets.length,
        candidatesConsidered: candidates.length,
        recommendationsReturned: 0
      },
      recommendations: []
    };
  }

  const perTargetLimit = Math.min(3, opts.limit);
  const scored: ContentRecommendation[] = [];

  for (const targetContext of targets) {
    const rankedForTarget = candidates
      .map((candidate) => {
        const keywordMatches = matchKeywords(candidate.textBlobLower, targetContext.keywords);
        const mlMatches = targetContext.dat560BoostEnabled
          ? matchKeywords(candidate.textBlobLower, DAT560_ML_KEYWORDS)
          : [];
        const dat560Boost = mlMatches.length * 16;
        const relevanceScore = keywordMatches.length * 22;
        const freshness = recencyScore(candidate.publishedAt, now);
        const popularity = engagementScore(candidate.engagement);
        const totalScore = (relevanceScore + freshness + popularity + dat560Boost) * targetContext.urgencyMultiplier;

        return {
          candidate,
          keywordMatches,
          totalScore,
          dat560Boost
        };
      })
      .filter((entry) => entry.totalScore >= 20)
      .sort((a, b) => b.totalScore - a.totalScore || a.candidate.id.localeCompare(b.candidate.id))
      .slice(0, perTargetLimit);

    for (const entry of rankedForTarget) {
      scored.push({
        id: `recommendation-${targetContext.target.type}-${targetContext.target.id}-${entry.candidate.platform}-${entry.candidate.id}`,
        target: targetContext.target,
        content: {
          platform: entry.candidate.platform,
          id: entry.candidate.id,
          title: entry.candidate.title,
          description: entry.candidate.description,
          author: entry.candidate.author,
          url: entry.candidate.url,
          publishedAt: entry.candidate.publishedAt,
          engagement: entry.candidate.engagement
        },
        score: Number(entry.totalScore.toFixed(2)),
        matchedKeywords: entry.keywordMatches,
        reason: buildReason(targetContext.target, entry.keywordMatches, entry.dat560Boost, entry.candidate, now)
      });
    }
  }

  const recommendations = scored
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, opts.limit);

  return {
    generatedAt: now.toISOString(),
    horizonDays: opts.horizonDays,
    summary: {
      targetsConsidered: targets.length,
      candidatesConsidered: candidates.length,
      recommendationsReturned: recommendations.length
    },
    recommendations
  };
}
