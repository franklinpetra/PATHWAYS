"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
}

export function SignInForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessCode: code }),
    });
    if (res.ok) {
      router.replace(safeNext(next));
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Something went wrong. Please try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-3">
      <label htmlFor="access-code" className="block text-sm font-medium">
        Access code
      </label>
      <input
        id="access-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        required
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "access-code-error" : undefined}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 tracking-wider focus:border-primary/60 focus:outline-none"
      />
      {error && (
        <p id="access-code-error" role="alert" className="text-sm text-muted-foreground">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || !code.trim()}
        className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground transition-opacity disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Continue"}
      </button>
    </form>
  );
}
