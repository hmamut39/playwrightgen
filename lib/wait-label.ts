/**
 * How long until something works again, in words a person reads once.
 *
 * "Try again later" is the sentence that wastes somebody's afternoon: they
 * try again, it fails the same way, and they conclude the product is broken.
 * The wait is known whenever a limit is hit, so it is said.
 */
export function waitLabel(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.max(1, Math.round((seconds % 3600) / 60));
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes} min`;
}
