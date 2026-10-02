"use client";

export function SignOutButton() {
  async function signOut() {
    await fetch("/api/session", { method: "DELETE" });
    window.location.assign("/");
  }
  return (
    <button type="button" onClick={signOut} className="text-sm text-muted-foreground hover:text-foreground">
      Sign out
    </button>
  );
}
