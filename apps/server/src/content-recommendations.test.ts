import { describe, expect, it } from "vitest";
import { generateContentRecommendations } from "./content-recommendations.js";
import { Deadline, LectureEvent, XData, YouTubeData } from "./types.js";

function makeDeadline(overrides: Partial<Deadline>): Deadline {
  return {
    id: overrides.id ?? "deadline-1",
    course: overrides.course ?? "DAT560",
    task: overrides.task ?? "Assignment",
    dueDate: overrides.dueDate ?? "2026-02-20T23:59:00.000Z",
    priority: overrides.priority ?? "high",
    completed: overrides.completed ?? false,
    canvasAssignmentId: overrides.canvasAssignmentId
  };
}

function makeLecture(overrides: Partial<LectureEvent>): LectureEvent {
  return {
    id: overrides.id ?? "lecture-1",
    title: overrides.title ?? "DAT560 Lecture",
    startTime: overrides.startTime ?? "2026-02-18T10:00:00.000Z",
    durationMinutes: overrides.durationMinutes ?? 90,
    workload: overrides.workload ?? "medium",
    recurrence: overrides.recurrence,
    recurrenceParentId: overrides.recurrenceParentId
  };
}

function makeYouTubeData(videos: YouTubeData["videos"]): YouTubeData {
  return {
    channels: [
      {
        id: "channel-1",
        title: "ML Academy",
        description: "Tutorials",
        thumbnailUrl: "https://example.com/channel.jpg",
        subscriberCount: 120000
      }
    ],
    videos,
    lastSyncedAt: "2026-02-17T08:00:00.000Z"
  };
}

function makeXData(tweets: XData["tweets"]): XData {
  return {
    tweets,
    lastSyncedAt: "2026-02-17T08:00:00.000Z"
  };
}

describe("generateContentRecommendations", () => {
  it("boosts ML-heavy content for DAT560 deadlines", () => {
    const now = new Date("2026-02-17T09:00:00.000Z");
    const deadlines = [
      makeDeadline({
        id: "dat560-a2",
        course: "DAT560",
        task: "Train VAE for assignment 2",
        dueDate: "2026-02-19T23:00:00.000Z",
        priority: "high"
      })
    ];

    const youtubeData = makeYouTubeData([
      {
        id: "ml-video",
        channelId: "channel-1",
        channelTitle: "ML Academy",
        title: "Transformer and VAE tutorial for machine learning assignments",
        description: "Practical deep learning walkthrough for students.",
        publishedAt: "2026-02-17T06:00:00.000Z",
        thumbnailUrl: "https://example.com/ml.jpg",
        duration: "PT15M",
        viewCount: 42000,
        likeCount: 3200,
        commentCount: 450
      },
      {
        id: "generic-video",
        channelId: "channel-1",
        channelTitle: "ML Academy",
        title: "iPhone productivity tips",
        description: "General productivity advice.",
        publishedAt: "2026-02-17T07:00:00.000Z",
        thumbnailUrl: "https://example.com/generic.jpg",
        duration: "PT9M",
        viewCount: 80000,
        likeCount: 6000,
        commentCount: 120
      }
    ]);

    const xData = makeXData([
      {
        id: "tweet-1",
        text: "Quick guide: tuning a VAE and transformer for ML coursework.",
        authorId: "1",
        authorUsername: "mlthreads",
        authorName: "ML Threads",
        createdAt: "2026-02-17T04:00:00.000Z",
        likeCount: 220,
        retweetCount: 70,
        replyCount: 14,
        conversationId: "conv-1"
      }
    ]);

    const result = generateContentRecommendations(deadlines, [], youtubeData, xData, {
      now,
      horizonDays: 7,
      limit: 3
    });

    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations[0]?.target.course).toBe("DAT560");
    expect(result.recommendations[0]?.reason).toContain("DAT560 ML relevance");
    expect(
      result.recommendations.some((rec) =>
        rec.content.title.toLowerCase().includes("vae") || rec.content.title.toLowerCase().includes("transformer")
      )
    ).toBe(true);
  });

  it("returns recommendations for mixed course contexts", () => {
    const now = new Date("2026-02-17T09:00:00.000Z");
    const deadlines = [
      makeDeadline({
        id: "dat520-lab",
        course: "DAT520",
        task: "Raft consensus lab",
        dueDate: "2026-02-20T23:00:00.000Z",
        priority: "high"
      }),
      makeDeadline({
        id: "dat560-a3",
        course: "DAT560",
        task: "VAE analysis assignment",
        dueDate: "2026-02-21T20:00:00.000Z",
        priority: "high"
      })
    ];

    const schedule = [
      makeLecture({
        id: "lecture-dat520",
        title: "DAT520 Distributed Systems Lecture",
        startTime: "2026-02-18T10:00:00.000Z"
      }),
      makeLecture({
        id: "lecture-dat560",
        title: "DAT560 Generative Models Lecture",
        startTime: "2026-02-18T13:00:00.000Z"
      })
    ];

    const youtubeData = makeYouTubeData([
      {
        id: "raft-video",
        channelId: "channel-1",
        channelTitle: "Systems Explained",
        title: "Raft consensus and replication explained",
        description: "Distributed systems deep dive",
        publishedAt: "2026-02-17T05:00:00.000Z",
        thumbnailUrl: "https://example.com/raft.jpg",
        duration: "PT20M",
        viewCount: 18000,
        likeCount: 1400,
        commentCount: 180
      },
      {
        id: "vae-video",
        channelId: "channel-2",
        channelTitle: "GenAI Lab",
        title: "VAE tutorial for machine learning students",
        description: "Hands-on variational autoencoder session",
        publishedAt: "2026-02-17T06:30:00.000Z",
        thumbnailUrl: "https://example.com/vae.jpg",
        duration: "PT18M",
        viewCount: 24000,
        likeCount: 2100,
        commentCount: 250
      }
    ]);

    const xData = makeXData([
      {
        id: "raft-tweet",
        text: "New thread on Raft and fault tolerance in distributed systems.",
        authorId: "2",
        authorUsername: "distnotes",
        authorName: "Dist Notes",
        createdAt: "2026-02-17T02:00:00.000Z",
        likeCount: 140,
        retweetCount: 65,
        replyCount: 10,
        conversationId: "conv-raft"
      }
    ]);

    const result = generateContentRecommendations(deadlines, schedule, youtubeData, xData, {
      now,
      horizonDays: 7,
      limit: 8
    });

    expect(result.recommendations.length).toBeGreaterThan(1);
    expect(
      result.recommendations.some((rec) => rec.target.course === "DAT520" && rec.content.title.toLowerCase().includes("raft"))
    ).toBe(true);
    expect(
      result.recommendations.some((rec) => rec.target.course === "DAT560" && rec.content.title.toLowerCase().includes("vae"))
    ).toBe(true);
  });

  it("handles missing social data gracefully", () => {
    const now = new Date("2026-02-17T09:00:00.000Z");
    const deadlines = [
      makeDeadline({
        id: "dat560-empty",
        course: "DAT560",
        task: "Assignment 4",
        dueDate: "2026-02-22T20:00:00.000Z"
      })
    ];

    const result = generateContentRecommendations(deadlines, [], null, null, {
      now,
      horizonDays: 7,
      limit: 5
    });

    expect(result.summary.candidatesConsidered).toBe(0);
    expect(result.summary.targetsConsidered).toBe(1);
    expect(result.recommendations).toHaveLength(0);
  });
});
