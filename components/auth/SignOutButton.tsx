"use client";

export function SignOutButton() {
  async function signOut() {
    await fetch("/api/session", { method: "DELETE" });
    window.location.assign("/");
  }
  return (
    <button type="button" onClick={signOut} className="btn btn-ghost btn-sm text-sm">
      Sign out
    </button>
  );
}
