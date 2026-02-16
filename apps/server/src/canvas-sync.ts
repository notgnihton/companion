import { config } from "./config.js";
import {
  CanvasAnnouncement,
  CanvasAssignment,
  CanvasCourse,
  CanvasData,
  CanvasModule
} from "./types.js";

interface CanvasAPIAssignment {
  id: number;
  name: string;
  due_at: string | null;
  points_possible: number;
  has_submitted_submissions?: boolean;
  workflow_state?: string;
  submission?: {
    workflow_state?: string;
    grade?: string;
    score?: number;
  };
}

interface CanvasAPICourse {
  id: number;
  name: string;
  course_code: string;
  enrollments?: Array<{ type: string }>;
}

interface CanvasAPIModule {
  id: number;
  name: string;
  position: number;
  items_count: number;
  state?: string;
  completed_at?: string | null;
}

interface CanvasAPIAnnouncement {
  id: number;
  title: string;
  message: string;
  posted_at: string;
  author?: {
    display_name?: string;
  };
}

export class CanvasSyncService {
  private readonly baseUrl: string | undefined;
  private readonly apiToken: string | undefined;

  constructor() {
    this.baseUrl = config.CANVAS_BASE_URL;
    this.apiToken = config.CANVAS_API_TOKEN;
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiToken);
  }

  async syncAll(): Promise<CanvasData> {
    if (!this.isConfigured()) {
      return {
        courses: [],
        assignments: [],
        modules: [],
        announcements: [],
        lastSync: null
      };
    }

    const courses = await this.fetchCourses();
    const assignments = await this.fetchAllAssignments(courses);
    const modules = await this.fetchAllModules(courses);
    const announcements = await this.fetchAllAnnouncements(courses);

    return {
      courses,
      assignments,
      modules,
      announcements,
      lastSync: new Date().toISOString()
    };
  }

  private async fetchCourses(): Promise<CanvasCourse[]> {
    const url = `${this.baseUrl}/api/v1/courses?enrollment_state=active&include[]=total_students`;
    const response = await this.canvasFetch(url);
    const data = (await response.json()) as CanvasAPICourse[];

    return data.map((course) => ({
      id: course.id,
      name: course.name,
      courseCode: course.course_code,
      enrollmentType: course.enrollments?.[0]?.type || "student"
    }));
  }

  private async fetchAllAssignments(courses: CanvasCourse[]): Promise<CanvasAssignment[]> {
    const allAssignments: CanvasAssignment[] = [];

    for (const course of courses) {
      const assignments = await this.fetchCourseAssignments(course.id);
      allAssignments.push(...assignments);
    }

    return allAssignments;
  }

  private async fetchCourseAssignments(courseId: number): Promise<CanvasAssignment[]> {
    const url = `${this.baseUrl}/api/v1/courses/${courseId}/assignments?include[]=submission`;
    const response = await this.canvasFetch(url);
    const data = (await response.json()) as CanvasAPIAssignment[];

    return data.map((assignment) => {
      let submissionStatus: CanvasAssignment["submissionStatus"] = null;

      if (assignment.submission) {
        const state = assignment.submission.workflow_state;
        if (state === "submitted" || state === "pending_review") {
          submissionStatus = state;
        } else if (state === "graded") {
          submissionStatus = "graded";
        } else {
          submissionStatus = "unsubmitted";
        }
      } else if (assignment.has_submitted_submissions) {
        submissionStatus = "submitted";
      } else {
        submissionStatus = "unsubmitted";
      }

      return {
        id: assignment.id,
        courseId,
        name: assignment.name,
        dueAt: assignment.due_at,
        pointsPossible: assignment.points_possible,
        submissionStatus,
        grade: assignment.submission?.grade || null,
        score: assignment.submission?.score || null
      };
    });
  }

  private async fetchAllModules(courses: CanvasCourse[]): Promise<CanvasModule[]> {
    const allModules: CanvasModule[] = [];

    for (const course of courses) {
      const modules = await this.fetchCourseModules(course.id);
      allModules.push(...modules);
    }

    return allModules;
  }

  private async fetchCourseModules(courseId: number): Promise<CanvasModule[]> {
    const url = `${this.baseUrl}/api/v1/courses/${courseId}/modules?include[]=items&per_page=100`;
    const response = await this.canvasFetch(url);
    const data = (await response.json()) as CanvasAPIModule[];

    return data.map((module) => ({
      id: module.id,
      courseId,
      name: module.name,
      position: module.position,
      itemsCount: module.items_count,
      completedCount: module.state === "completed" ? module.items_count : 0
    }));
  }

  private async fetchAllAnnouncements(courses: CanvasCourse[]): Promise<CanvasAnnouncement[]> {
    const allAnnouncements: CanvasAnnouncement[] = [];

    for (const course of courses) {
      const announcements = await this.fetchCourseAnnouncements(course.id);
      allAnnouncements.push(...announcements);
    }

    return allAnnouncements;
  }

  private async fetchCourseAnnouncements(courseId: number): Promise<CanvasAnnouncement[]> {
    const url = `${this.baseUrl}/api/v1/courses/${courseId}/discussion_topics?only_announcements=true&per_page=10`;
    const response = await this.canvasFetch(url);
    const data = (await response.json()) as CanvasAPIAnnouncement[];

    return data.map((announcement) => ({
      id: announcement.id,
      courseId,
      title: announcement.title,
      message: announcement.message,
      postedAt: announcement.posted_at,
      author: announcement.author?.display_name || "Unknown"
    }));
  }

  private async canvasFetch(url: string): Promise<Response> {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Canvas API error: ${response.status} ${response.statusText}`);
    }

    return response;
  }
}
