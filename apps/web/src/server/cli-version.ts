import { requiredCliVersion } from "@/generated/required-cli-version";

export { requiredCliVersion };

export function formatRequiredCliVersionError(actualVersion: string): string {
  return `Token Burn requires token-burn ${requiredCliVersion}. You have ${actualVersion}. Run npm install -g @blnayan/token-burn@latest.`;
}
