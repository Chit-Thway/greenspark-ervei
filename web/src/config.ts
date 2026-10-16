// Integration boundary for the teammate-owned full profile. Set VITE_PROFILE_URL_TEMPLATE
// (e.g. "https://profiles.example/people/{personId}") to show a link; unset hides it.
const template = import.meta.env.VITE_PROFILE_URL_TEMPLATE as string | undefined;

export function profileUrl(personId: string): string | null {
  return template ? template.replace("{personId}", encodeURIComponent(personId)) : null;
}
