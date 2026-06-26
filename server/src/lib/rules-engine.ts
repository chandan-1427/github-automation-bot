export type RuleMatch = {
  field: "title" | "body" | "author" | "label";
  type: "contains" | "equals" | "regex";
  value: string;
};

export type RuleConditions = {
  eventTypes: string[]; // e.g. ["issues", "pull_request"]
  matches: RuleMatch[]; // ALL must match (AND) for the rule to fire
};

export type RuleActions = {
  addLabel?: string;
  comment?: string; // may contain {{title}} / {{author}} placeholders
  slackAlert?: boolean;
};

export type RuleEvent = {
  eventType: string;
  title: string;
  body: string;
  author: string;
  labels: string[];
};

function matchOne(match: RuleMatch, event: RuleEvent): boolean {
  let fieldValue: string;
  if (match.field === "label") {
    // For labels, "contains"/"equals" check against the list of labels.
    return match.type === "regex"
      ? event.labels.some((l) => safeRegexTest(match.value, l))
      : match.type === "equals"
        ? event.labels.includes(match.value)
        : event.labels.some((l) => l.toLowerCase().includes(match.value.toLowerCase()));
  }

  fieldValue = event[match.field] ?? "";

  switch (match.type) {
    case "equals":
      return fieldValue.toLowerCase() === match.value.toLowerCase();
    case "contains":
      return fieldValue.toLowerCase().includes(match.value.toLowerCase());
    case "regex":
      return safeRegexTest(match.value, fieldValue);
    default:
      return false;
  }
}

/** Regex matching guarded against malformed patterns a user might save. */
function safeRegexTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern, "i").test(value);
  } catch {
    return false;
  }
}

export function ruleMatches(
  conditions: RuleConditions,
  event: RuleEvent
): boolean {
  if (!conditions.eventTypes.includes(event.eventType)) return false;
  if (!conditions.matches || conditions.matches.length === 0) return true;
  return conditions.matches.every((m) => matchOne(m, event));
}

export function renderTemplate(template: string, event: RuleEvent): string {
  return template
    .replaceAll("{{title}}", event.title)
    .replaceAll("{{author}}", event.author);
}
