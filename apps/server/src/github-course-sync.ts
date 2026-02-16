import { config } from "./config.js";
import { Deadline, Priority } from "./types.js";

export interface CourseRepo {
  owner: string;
  repo: string;
  paths: string[];
}

export interface ParsedDeadline {
  lab: string;
  deadline: string;
  course: string;
}

const COURSE_REPOS: CourseRepo[] = [
  {
    owner: "dat520-2026",
    repo: "assignments",
    paths: ["README.md"]
  },
  {
    owner: "dat560-2026",
    repo: "info",
    paths: ["README.md"]
  }
];

export async function fetchGitHubFile(owner: string, repo: string, path: string): Promise<string | null> {
  const token = config.COURSE_GITHUB_PAT;

  if (!token) {
    return null;
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3.raw",
        "User-Agent": "Companion-App"
      }
    });

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  }
}

export function parseDeadlineTable(markdown: string, courseName: string): ParsedDeadline[] {
  const deadlines: ParsedDeadline[] = [];
  const lines = markdown.split("\n");
  let inTable = false;
  let headerProcessed = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed.includes("|")) {
      if (inTable) {
        inTable = false;
        headerProcessed = false;
      }
      continue;
    }

    if (!inTable) {
      const lower = trimmed.toLowerCase();
      if (lower.includes("lab") && lower.includes("deadline")) {
        inTable = true;
        continue;
      }
    }

    if (!inTable) {
      continue;
    }

    if (trimmed.startsWith("|") && trimmed.includes("---")) {
      headerProcessed = true;
      continue;
    }

    if (!headerProcessed) {
      continue;
    }

    const cells = trimmed
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);

    if (cells.length < 2) {
      continue;
    }

    const lab = cells[0];
    const deadline = cells[1];

    if (!lab || !deadline) {
      continue;
    }

    if (lab.toLowerCase().includes("lab") || lab.toLowerCase().includes("assignment")) {
      const parsed = parseDeadlineDate(deadline);
      if (parsed) {
        deadlines.push({
          lab,
          deadline: parsed,
          course: courseName
        });
      }
    }
  }

  return deadlines;
}

export function parseDeadlineDate(dateString: string): string | null {
  const cleaned = dateString.replace(/\*\*/g, "").trim();

  const isoMatch = /(\d{4}-\d{2}-\d{2})/.exec(cleaned);
  if (isoMatch) {
    return `${isoMatch[1]}T23:59:59.000Z`;
  }

  const shortMatch = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(cleaned);
  if (shortMatch) {
    const month = shortMatch[1]!.padStart(2, "0");
    const day = shortMatch[2]!.padStart(2, "0");
    const year = shortMatch[3];
    return `${year}-${month}-${day}T23:59:59.000Z`;
  }

  const monthDayMatch = /(\w+)\s+(\d{1,2}),?\s+(\d{4})/.exec(cleaned);
  if (monthDayMatch) {
    const monthStr = monthDayMatch[1]!.toLowerCase();
    const day = monthDayMatch[2]!.padStart(2, "0");
    const year = monthDayMatch[3];
    const monthMap: Record<string, string> = {
      january: "01",
      february: "02",
      march: "03",
      april: "04",
      may: "05",
      june: "06",
      july: "07",
      august: "08",
      september: "09",
      october: "10",
      november: "11",
      december: "12",
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12"
    };

    const month = monthMap[monthStr];
    if (month) {
      return `${year}-${month}-${day}T23:59:59.000Z`;
    }
  }

  return null;
}

export function inferPriorityFromLab(lab: string): Priority {
  const lower = lab.toLowerCase();

  if (lower.includes("final") || lower.includes("exam")) {
    return "critical";
  }

  if (lower.includes("project")) {
    return "high";
  }

  return "medium";
}

export function toDeadline(parsed: ParsedDeadline): Omit<Deadline, "id"> {
  return {
    course: parsed.course,
    task: parsed.lab,
    dueDate: parsed.deadline,
    priority: inferPriorityFromLab(parsed.lab),
    completed: false
  };
}

export async function syncCourseDeadlines(): Promise<Array<Omit<Deadline, "id">>> {
  const allDeadlines: Array<Omit<Deadline, "id">> = [];

  for (const repo of COURSE_REPOS) {
    for (const path of repo.paths) {
      const content = await fetchGitHubFile(repo.owner, repo.repo, path);

      if (!content) {
        continue;
      }

      const courseName = repo.owner;
      const parsed = parseDeadlineTable(content, courseName);

      for (const deadline of parsed) {
        allDeadlines.push(toDeadline(deadline));
      }
    }
  }

  return allDeadlines;
}
