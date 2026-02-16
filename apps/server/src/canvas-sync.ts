import { config } from "./config.js";
import { CanvasCourse, CanvasAssignment, CanvasModule, CanvasAnnouncement } from "./types.js";

export interface CanvasSyncResult {
  success: boolean;
  coursesProcessed: number;
  assignmentsProcessed: number;
  modulesProcessed: number;
  announcementsProcessed: number;
  error?: string;
}

/**
 * Fetch courses from Canvas LMS
 */
export async function fetchCanvasCourses(): Promise<CanvasCourse[]> {
  const { CANVAS_API_TOKEN, CANVAS_BASE_URL } = config;

  if (!CANVAS_API_TOKEN) {
    throw new Error("CANVAS_API_TOKEN not configured");
  }

  const response = await fetch(`${CANVAS_BASE_URL}/api/v1/courses?enrollment_state=active&per_page=100`, {
    headers: {
      Authorization: `Bearer ${CANVAS_API_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Canvas courses: ${response.status} ${response.statusText}`);
  }

  const courses = await response.json() as Array<{
    id: number;
    name: string;
    course_code: string;
    enrollment_term_id?: number;
    start_at?: string | null;
    end_at?: string | null;
    created_at: string;
  }>;

  return courses.map((course) => ({
    id: String(course.id),
    name: course.name,
    courseCode: course.course_code,
    enrollmentTerm: course.enrollment_term_id ? String(course.enrollment_term_id) : undefined,
    startAt: course.start_at,
    endAt: course.end_at,
    createdAt: course.created_at,
  }));
}

/**
 * Fetch assignments for a specific course from Canvas LMS
 */
export async function fetchCanvasAssignments(courseId: string): Promise<CanvasAssignment[]> {
  const { CANVAS_API_TOKEN, CANVAS_BASE_URL } = config;

  if (!CANVAS_API_TOKEN) {
    throw new Error("CANVAS_API_TOKEN not configured");
  }

  const response = await fetch(`${CANVAS_BASE_URL}/api/v1/courses/${courseId}/assignments?per_page=100`, {
    headers: {
      Authorization: `Bearer ${CANVAS_API_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Canvas assignments for course ${courseId}: ${response.status} ${response.statusText}`);
  }

  const assignments = await response.json() as Array<{
    id: number;
    name: string;
    description?: string | null;
    due_at?: string | null;
    points_possible?: number | null;
    submission_types: string[];
    has_submitted_submissions: boolean;
    grading_type: string;
    created_at: string;
  }>;

  return assignments.map((assignment) => ({
    id: String(assignment.id),
    courseId,
    name: assignment.name,
    description: assignment.description,
    dueAt: assignment.due_at,
    pointsPossible: assignment.points_possible,
    submissionTypes: assignment.submission_types,
    hasSubmittedSubmissions: assignment.has_submitted_submissions,
    gradingType: assignment.grading_type,
    createdAt: assignment.created_at,
  }));
}

/**
 * Fetch modules for a specific course from Canvas LMS
 */
export async function fetchCanvasModules(courseId: string): Promise<CanvasModule[]> {
  const { CANVAS_API_TOKEN, CANVAS_BASE_URL } = config;

  if (!CANVAS_API_TOKEN) {
    throw new Error("CANVAS_API_TOKEN not configured");
  }

  const response = await fetch(`${CANVAS_BASE_URL}/api/v1/courses/${courseId}/modules?per_page=100`, {
    headers: {
      Authorization: `Bearer ${CANVAS_API_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Canvas modules for course ${courseId}: ${response.status} ${response.statusText}`);
  }

  const modules = await response.json() as Array<{
    id: number;
    name: string;
    position: number;
    unlock_at?: string | null;
    require_sequential_progress: boolean;
    state: string;
  }>;

  return modules.map((module) => ({
    id: String(module.id),
    courseId,
    name: module.name,
    position: module.position,
    unlockAt: module.unlock_at,
    requireSequentialProgress: module.require_sequential_progress,
    state: module.state,
    createdAt: new Date().toISOString(), // Canvas API doesn't provide created_at for modules
  }));
}

/**
 * Fetch announcements for a specific course from Canvas LMS
 */
export async function fetchCanvasAnnouncements(courseId: string): Promise<CanvasAnnouncement[]> {
  const { CANVAS_API_TOKEN, CANVAS_BASE_URL } = config;

  if (!CANVAS_API_TOKEN) {
    throw new Error("CANVAS_API_TOKEN not configured");
  }

  const response = await fetch(`${CANVAS_BASE_URL}/api/v1/announcements?context_codes[]=course_${courseId}&per_page=100`, {
    headers: {
      Authorization: `Bearer ${CANVAS_API_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Canvas announcements for course ${courseId}: ${response.status} ${response.statusText}`);
  }

  const announcements = await response.json() as Array<{
    id: number;
    title: string;
    message: string;
    posted_at: string;
    author?: { display_name: string };
    created_at: string;
  }>;

  return announcements.map((announcement) => ({
    id: String(announcement.id),
    courseId,
    title: announcement.title,
    message: announcement.message,
    postedAt: announcement.posted_at,
    author: announcement.author?.display_name,
    createdAt: announcement.created_at,
  }));
}

/**
 * Fetch all Canvas data (courses and their related data)
 */
export async function fetchAllCanvasData(): Promise<{
  courses: CanvasCourse[];
  assignments: CanvasAssignment[];
  modules: CanvasModule[];
  announcements: CanvasAnnouncement[];
}> {
  const courses = await fetchCanvasCourses();

  // Fetch assignments, modules, and announcements for each course in parallel
  const allAssignments: CanvasAssignment[] = [];
  const allModules: CanvasModule[] = [];
  const allAnnouncements: CanvasAnnouncement[] = [];

  await Promise.all(
    courses.map(async (course) => {
      try {
        const [assignments, modules, announcements] = await Promise.all([
          fetchCanvasAssignments(course.id),
          fetchCanvasModules(course.id),
          fetchCanvasAnnouncements(course.id),
        ]);

        allAssignments.push(...assignments);
        allModules.push(...modules);
        allAnnouncements.push(...announcements);
      } catch (error) {
        console.error(`Failed to fetch data for course ${course.id}:`, error);
      }
    })
  );

  return {
    courses,
    assignments: allAssignments,
    modules: allModules,
    announcements: allAnnouncements,
  };
}
