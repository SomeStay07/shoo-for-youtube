export const TEST_HOOK = "shoo:stats";

export function stripTestHooks(text) {
  return text
    .split("\n")
    .filter((line) => !line.includes(`"${TEST_HOOK}"`))
    .join("\n");
}
