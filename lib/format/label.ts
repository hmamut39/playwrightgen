/**
 * A database value, written the way a person would say it.
 *
 * Enum values reached the page as stored -- "ACTIVE", "PROJECT_LEAD",
 * "IN_REVIEW" -- which reads like an error code to someone who has never seen
 * the schema. "Project lead" and "In review" say the same thing in words.
 */
export function humanLabel(value: string): string {
  const words = value.toLowerCase().replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : value;
}
