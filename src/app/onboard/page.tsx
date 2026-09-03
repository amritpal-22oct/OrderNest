import { requirePlatformAdmin } from "@/lib/platform-admin";
import { OnboardForm } from "./OnboardForm";

// Onboarding is platform-admin-gated, not public self-serve — see CLAUDE.md.
export default async function OnboardPage() {
  await requirePlatformAdmin();
  return <OnboardForm />;
}
